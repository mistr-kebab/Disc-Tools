const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';

const { discordFetch, apiCache } = require('../utils/discord');
const { hashIP, hashIPLegacy } = require('../utils/ip');
const db = require('../db');

async function refreshDiscordToken(refreshToken) {
    const r = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
    }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return r.data;
}

// --- User Guilds ---
router.get('/user/guilds', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        let accessToken = req.cookies.discord_at;
        if (!accessToken) {
            return res.status(401).json({ error: 'Session expired, please log in again' });
        }

        try {
            const guilds = await discordFetch('https://discord.com/api/v10/users/@me/guilds', accessToken, 'Bearer ');
            return res.json(guilds);
        } catch (fetchErr) {
            if (fetchErr.response?.status !== 401) throw fetchErr;

            const refreshToken = req.cookies.discord_refresh;
            if (!refreshToken) throw fetchErr;

            const fresh = await refreshDiscordToken(refreshToken);
            const cookieOptions = {
                httpOnly: true, secure: true, sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000
            };
            res.cookie('discord_at', fresh.access_token, cookieOptions);
            if (fresh.refresh_token) {
                res.cookie('discord_refresh', fresh.refresh_token, cookieOptions);
            }
            const guilds = await discordFetch('https://discord.com/api/v10/users/@me/guilds', fresh.access_token, 'Bearer ');
            res.json(guilds);
        }
    } catch (err) {
        res.status(err.response ? err.response.status : 500).json({ error: 'Internal Error' });
    }
});

// --- Guild Lookup ---
router.get('/guilds/:id', async (req, res) => {
    let guildId = req.params.id;

    // Input Validation
    if (!guildId || !/^\d{17,20}$/.test(guildId)) {
        return res.status(400).json({ error: 'Invalid Guild ID' });
    }

    if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'Guild lookup requires a bot token (not configured).' });
    }

    try {
        const guild = await discordFetch(`https://discord.com/api/v10/guilds/${guildId}?with_counts=true`, BOT_TOKEN, 'Bot ');
        res.json(guild);
    } catch (err) {
        const status = err.response ? err.response.status : 500;
        res.status(status).json({ error: 'Failed to fetch guild details.' });
    }
});

// --- User Lookup ---
router.get('/users/:id', async (req, res) => {
    const userId = req.params.id;

    if (!/^\d{17,20}$/.test(userId)) {
        return res.status(400).json({ error: 'Invalid User ID' });
    }

    if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'Bot token not configured' });
    }

    try {
        // NOTE: users/{id}/profile (which would return the full badge list incl. Nitro
        // tenure, boost, quest badges) is rejected for bot tokens ("Bots cannot use this
        // endpoint"). public_flags + clan from the base endpoint is all that's available
        // for anonymous lookups. Only when a logged-in user looks up their own ID can we
        // fetch the full badge list via their OAuth user token.
        const user = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
        const data = Object.assign({}, user);

        const at = req.cookies.discord_at;
        if (at) {
            try {
                const sessToken = req.cookies.token;
                if (sessToken) {
                    const decoded = jwt.verify(sessToken, JWT_SECRET, { algorithms: ['HS256'] });
                    if (decoded.id === userId) {
                        const profile = await discordFetch(
                            `https://discord.com/api/v10/users/${userId}/profile`, at, 'Bearer '
                        );
                        if (Array.isArray(profile.badges)) {
                            data.badges = profile.badges.map(b => ({
                                id: b.id || null,
                                description: b.description || null,
                                icon: b.icon || null
                            }));
                        }
                    }
                }
            } catch (_) {
                // profile endpoint rejects OAuth tokens with 401 — fall back to public flags
            }
        }

        // Server Booster badge: premium_since from guild member data (bot can see this
        // for members of its own guild). This is the only non-flag badge reachable
        // with a bot token.
        try {
            const member = await discordFetch(
                `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, BOT_TOKEN, 'Bot '
            );
            if (member && member.premium_since) {
                data.premium_since = member.premium_since;
            }
        } catch (_) {
            // user is not in the bot's guild — no booster data
        }

        res.json(data);
    } catch (err) {
        console.error(`[USER LOOKUP] Failed for ${userId}:`, err.message);
        res.status(err.response ? err.response.status : 500).json({ error: 'Failed to fetch user' });
    }
});

// --- VPN Check ---
router.get('/security/vpn-check', async (req, res) => {
    let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;

    // Sanitize IPv4 mapped IPv6
    if (ip.startsWith('::ffff:')) ip = ip.split(':').pop();

    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        return res.json({ isVpn: false, ip, type: 'Local' });
    }

    try {
        const response = await axios.get(`https://proxycheck.io/v2/${ip}?vpn=1&asn=1`, { timeout: 3000 });
        const data = response.data;

        if (data.status !== 'ok') {
            console.error(`[VPN CHECK] API Error for ${ip}:`, data.message || 'Unknown error');
            return res.json({ isVpn: false, ip, error: 'API Status Error' });
        }

        const ipData = data[ip];
        if (!ipData) {
            return res.json({ isVpn: false, ip, error: 'IP not found in response' });
        }

        const isVpn = ipData.proxy === 'yes' || ipData.type === 'VPN' || ipData.type === 'Proxy' || ipData.type === 'Hosting';

        res.json({
            isVpn,
            ip,
            type: ipData.type || 'Unknown',
            asn: ipData.asn || 'Unknown',
            provider: ipData.provider || 'Unknown'
        });
    } catch (err) {
        console.error(`[VPN CHECK] Failed for ${ip}:`, err.message);
        res.json({ isVpn: false, ip, error: 'Fetch failed' });
    }
});

// --- Ban Check ---
router.get('/security/ban-check', async (req, res) => {
    let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.split(':').pop();

    if (ip === '::1' || ip === '127.0.0.1') {
        return res.json({ isBanned: false });
    }

    try {
        const hmacHash = hashIP(ip);
        const legacyHash = hashIPLegacy(ip);
        const result = await db.query(
            'SELECT user_id FROM blocked_ips WHERE ip_hash IN ($1, $2) LIMIT 1',
            [hmacHash, legacyHash]
        );
        res.json({ isBanned: result.rows.length > 0 });
    } catch (err) {
        console.error('[BAN CHECK] Failed:', err.message);
        res.json({ isBanned: false, error: 'Check failed' });
    }
});

// --- Config ---
router.get('/config', (req, res) => {
    const DISCORD_INVITE = process.env.DISCORD_INVITE || null;
    res.json({ discordInvite: DISCORD_INVITE });
});

// --- Invite Bot Callback Proxy ---
router.post('/invite/bot/callback', async (req, res) => {
    try {
        const response = await axios.post('http://127.0.0.1:3005/api/invite/bot/callback', req.body, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('[API PROXY] Error forwarding callback to Disc-Tools bot:', error.message);
        if (error.code === 'ECONNREFUSED') {
            return res.status(502).json({
                success: false,
                error: 'The Disc-Tools bot service is currently offline or starting up.'
            });
        }
        res.status(error.response?.status || 500).json(error.response?.data || {
            success: false,
            error: 'Failed to process bot authorization'
        });
    }
});

module.exports = router;

