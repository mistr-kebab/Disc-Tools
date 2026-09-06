const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';

const db = require('../db');
const { discordFetch } = require('../utils/discord');
const { hashIP } = require('../utils/ip');

// --- OAuth2 Login Flow ---
router.get('/login', (req, res) => {
    let redirect = '/u/';
    if (req.query.redirect && req.query.redirect.startsWith('/') && !req.query.redirect.includes('//') && !req.query.redirect.includes(':')) {
        redirect = req.query.redirect;
    }
    res.cookie('redirect_to', redirect, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000
    });
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000
    });
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20email%20guilds%20guilds.join%20connections&prompt=consent&state=${state}`;
    res.redirect(url);
});

// --- OAuth2 Callback ---
async function handleAuthCallback(req, res) {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');

    const expectedState = req.cookies.oauth_state;
    const receivedState = req.query.state;
    if (!expectedState || !receivedState || expectedState !== receivedState) {
        return res.status(403).send('Invalid state parameter – possible CSRF attack.');
    }
    res.clearCookie('oauth_state');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;
        const refreshToken = tokenResponse.data.refresh_token;

        const userResponse = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const u = userResponse.data;

        // Auto-join user to guild if configured
        if (BOT_TOKEN) {
            try {
                await axios.get(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${u.id}`, {
                    headers: { Authorization: `Bot ${BOT_TOKEN}` }
                });
            } catch (joinCheckError) {
                if (joinCheckError.response && joinCheckError.response.status === 404) {
                    try {
                        await axios.put(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${u.id}`, {
                            access_token: accessToken
                        }, {
                            headers: {
                                Authorization: `Bot ${BOT_TOKEN}`,
                                'Content-Type': 'application/json'
                            }
                        });
                    } catch (joinError) {
                        console.error('[AUTH] Failed to auto-join user:', joinError.message);
                    }
                }
            }
        }

        const token = jwt.sign({
            id: u.id,
            username: u.username,
            global_name: u.global_name,
            avatar: u.avatar,
            discriminator: u.discriminator,
            public_flags: u.public_flags,
            email: u.email || null,
            verified: u.verified || false,
            banner: u.banner || null,
            accent_color: u.accent_color || null,
            avatar_decoration_data: u.avatar_decoration_data || null,
            premium_type: u.premium_type ?? 0,
            mfa_enabled: u.mfa_enabled ?? false
        }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

        const cookieOptions = {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        };
        const strictCookieOptions = {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        };

        res.cookie('token', token, strictCookieOptions);
        res.cookie('discord_at', accessToken, cookieOptions);
        res.cookie('discord_refresh', refreshToken, cookieOptions);

        // Track session
        const sessionId = crypto.randomUUID();
        const ip = (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip || '').replace(/^::ffff:/, '').split(',')[0].trim();
        const ipHash = hashIP(ip);
        try {
            await db.query(
                `INSERT INTO admin_sessions (user_id, username, global_name, avatar, session_id, user_agent, refresh_token, ip_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [u.id, u.username, u.global_name, u.avatar, sessionId, req.headers['user-agent'] || null, refreshToken, ipHash]
            );
            res.cookie('session_id', sessionId, strictCookieOptions);
        } catch (e) {
            console.error('[AUTH] Session tracking failed:', e.message);
        }
        const redirectTo = req.cookies.redirect_to || '/u/';
        res.clearCookie('redirect_to');
        res.redirect(redirectTo);
    } catch (error) {
        console.error('[AUTH] Callback failed:', error.message);
        res.status(500).send('Authentication failed.');
    }
}

router.get('/callback', handleAuthCallback);

// --- Get Current User ---
router.get('/me', (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ authenticated: false });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const { accessToken, ...safeUser } = decoded;
        res.json({ authenticated: true, user: safeUser });
    } catch (err) {
        res.json({ authenticated: false });
    }
});

// --- Fresh user data from Discord (Nitro detection etc.) ---
router.get('/me/refresh', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ authenticated: false });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const fresh = { ...decoded };
        const at = req.cookies.discord_at;

        if (at) {
            try {
                const userRes = await axios.get('https://discord.com/api/v10/users/@me', {
                    headers: { Authorization: `Bearer ${at}` },
                    timeout: 5000
                });
                const u = userRes.data;
                fresh.premium_type = u.premium_type ?? 0;
                fresh.mfa_enabled = u.mfa_enabled ?? false;
                fresh.public_flags = u.public_flags ?? 0;
                fresh.avatar = u.avatar ?? fresh.avatar;
                fresh.global_name = u.global_name ?? fresh.global_name;
                fresh.banner = u.banner ?? fresh.banner;
                fresh.accent_color = u.accent_color ?? fresh.accent_color;
                if ('email' in u) fresh.email = u.email;
                if ('verified' in u) fresh.verified = u.verified;
                if ('avatar_decoration_data' in u) {
                    fresh.avatar_decoration_data = u.avatar_decoration_data;
                }
            } catch (err) {
                console.warn('[AUTH] OAuth refresh failed:', err.message);
            }

            async function fetchProfile(token, type) {
                try {
                    const profileRes = await axios.get(`https://discord.com/api/v9/users/${fresh.id}/profile`, {
                        headers: { Authorization: `${type} ${token}` },
                        timeout: 5000
                    });
                    /* badges removed from JWT - too large for cookie */
                    const userProfile = profileRes.data.user_profile;
                    if (userProfile) {
                        fresh.bio = userProfile.bio || fresh.bio || null;
                        if (userProfile.pronouns) {
                            fresh.pronouns = userProfile.pronouns;
                        }
                    }
                    return true;
                } catch (e) {
                    return false;
                }
            }

            if (!await fetchProfile(at, 'Bearer')) {
                if (BOT_TOKEN) {
                    console.log('[AUTH] Profile endpoint failed with OAuth, trying bot token...');
                    await fetchProfile(BOT_TOKEN, 'Bot');
                }
            }
        }

        // Fetch guild member info (nickname, roles, boost)
        if (BOT_TOKEN && fresh.id) {
            try {
                const memberRes = await axios.get(
                    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${fresh.id}`,
                    { headers: { Authorization: `Bot ${BOT_TOKEN}` }, timeout: 5000 }
                );
                const m = memberRes.data;
                console.log('[AUTH] Guild member fetch OK:', JSON.stringify({ nick: m.nick, roles: m.roles }));
                if (!fresh.premium_type && m.premium_since) {
                    fresh.premium_type = 2;
                }
                fresh.guild_nick = m.nick || null;
                fresh.guild_roles = m.roles || [];
                fresh.guild_joined_at = m.joined_at || null;
                fresh.guild_avatar = m.avatar || null;

                if (m.roles && m.roles.length > 0) {
                    try {
                        const rolesRes = await axios.get(
                            `https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,
                            { headers: { Authorization: `Bot ${BOT_TOKEN}` }, timeout: 5000 }
                        );
                        const roleMap = {};
                        rolesRes.data.forEach(r => {
                            if (r.id === GUILD_ID) return;
                            roleMap[r.id] = r.name;
                        });
                        const myRoles = m.roles.map(id => roleMap[id]).filter(Boolean);
                        fresh.guild_high_role = myRoles[0] || null;
                    } catch (roleErr) {
                        console.warn('[AUTH] Role name fetch failed:', roleErr.message);
                    }
                }
            } catch (err) {
                if (err.response?.status !== 404) {
                    console.warn('[AUTH] Bot member check failed:', err.message);
                }
            }
        }

        // Update JWT cookie with fresh data
        const { accessToken, iat, exp, guild_role_data, profile_badges, ...safeUser } = fresh;
        const newToken = jwt.sign(safeUser, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
        res.cookie('token', newToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({ authenticated: true, user: safeUser });
    } catch (err) {
        res.json({ authenticated: false });
    }
});

// --- Logout (POST - used by dashboard frontend) ---
router.post('/logout', async (req, res) => {
    const sid = req.cookies.session_id;
    if (sid) {
        try {
            await db.query(`UPDATE admin_sessions SET revoked = true WHERE session_id = $1`, [sid]);
        } catch (e) {}
    }
    res.clearCookie('token');
    res.clearCookie('discord_at');
    res.clearCookie('discord_refresh');
    res.clearCookie('session_id');
    res.json({ success: true });
});

// --- Logout ---
router.get('/logout', async (req, res) => {
    const sid = req.cookies.session_id;
    if (sid) {
        try {
            await db.query(`UPDATE admin_sessions SET revoked = true WHERE session_id = $1`, [sid]);
        } catch (e) {}
    }
    res.clearCookie('token');
    res.clearCookie('discord_at');
    res.clearCookie('discord_refresh');
    res.clearCookie('session_id');
    res.redirect('/');
});

// --- Lightweight guild profile data (roles, badges) - separate from JWT cookie ---
router.get('/guild-profile', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ ok: false });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        const result = { ok: true, guild_nick: null, guild_roles: [], guild_role_data: [], profile_badges: [] };

        const at = req.cookies.discord_at;
        if (at) {
            try {
                const profileRes = await axios.get(`https://discord.com/api/v9/users/${decoded.id}/profile`, {
                    headers: { Authorization: `Bearer ${at}` },
                    timeout: 5000
                });
                if (profileRes.data.badges) {
                    result.profile_badges = profileRes.data.badges;
                }
            } catch (_) {
                if (BOT_TOKEN) {
                    try {
                        const profileRes = await axios.get(`https://discord.com/api/v9/users/${decoded.id}/profile`, {
                            headers: { Authorization: `Bot ${BOT_TOKEN}` },
                            timeout: 5000
                        });
                        if (profileRes.data.badges) {
                            result.profile_badges = profileRes.data.badges;
                        }
                    } catch (_) {}
                }
            }
        }

        if (BOT_TOKEN && decoded.id) {
            try {
                const memberRes = await axios.get(
                    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${decoded.id}`,
                    { headers: { Authorization: `Bot ${BOT_TOKEN}` }, timeout: 5000 }
                );
                const m = memberRes.data;
                result.guild_nick = m.nick || null;
                result.guild_roles = m.roles || [];

                if (m.roles && m.roles.length > 0) {
                    const rolesRes = await axios.get(
                        `https://discord.com/api/v10/guilds/${GUILD_ID}/roles`,
                        { headers: { Authorization: `Bot ${BOT_TOKEN}` }, timeout: 5000 }
                    );
                    const roleMap = {};
                    rolesRes.data.forEach(r => {
                        if (r.id === GUILD_ID) return;
                        roleMap[r.id] = {
                            name: r.name,
                            color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
                            position: r.position
                        };
                    });
                    result.guild_role_data = m.roles
                        .map(id => roleMap[id])
                        .filter(Boolean)
                        .sort((a, b) => b.position - a.position);
                }
            } catch (_) {}
        }

        res.json(result);
    } catch (_) {
        res.json({ ok: false });
    }
});

module.exports = router;
