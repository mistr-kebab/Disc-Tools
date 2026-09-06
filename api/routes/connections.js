const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const db = require('../db');

const PROVIDERS = {
    github: {
        name: 'GitHub',
        icon: 'fa-brands fa-github',
        color: '#4078c0',
        authorizeUrl: (clientId, redirectUri, state) =>
            `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=read:user`,
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userUrl: 'https://api.github.com/user',
        getClientId: () => process.env.GITHUB_CLIENT_ID,
        getClientSecret: () => process.env.GITHUB_CLIENT_SECRET,
        getRedirectUri: () => process.env.GITHUB_REDIRECT_URI || 'https://disc-tools.de/api/auth/github/callback',
        extractUser: (data) => ({
            id: String(data.id),
            username: data.login,
            displayName: data.name || data.login,
            avatar: data.avatar_url
        })
    },
    twitch: {
        name: 'Twitch',
        icon: 'fa-brands fa-twitch',
        color: '#9146FF',
        authorizeUrl: (clientId, redirectUri, state) =>
            `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=user:read:email&state=${state}`,
        tokenUrl: 'https://id.twitch.tv/oauth2/token',
        userUrl: 'https://api.twitch.tv/helix/users',
        getClientId: () => process.env.TWITCH_CLIENT_ID,
        getClientSecret: () => process.env.TWITCH_CLIENT_SECRET,
        getRedirectUri: () => process.env.TWITCH_REDIRECT_URI || 'https://disc-tools.de/api/auth/twitch/callback',
        extractUser: (data) => {
            const user = Array.isArray(data.data) ? data.data[0] : data;
            return {
                id: user.id,
                username: user.login,
                displayName: user.display_name,
                avatar: user.profile_image_url
            };
        },
        customTokenPayload: (clientId, clientSecret, code, redirectUri, state) => ({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        }),
        customUserHeaders: (accessToken, clientId) => ({
            'Authorization': `Bearer ${accessToken}`,
            'Client-Id': clientId
        })
    }
};

(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS linked_accounts (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                provider_account_id TEXT NOT NULL,
                provider_username TEXT,
                provider_avatar TEXT,
                linked_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, provider),
                UNIQUE(provider, provider_account_id)
            )
        `);
        console.log('[CONNECTIONS] Table ready.');
    } catch (e) {
        console.error('[CONNECTIONS] Table init failed:', e.message);
    }
})();

function requireAuth(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        req.user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}

// --- GET /api/auth/connections - list linked accounts ---
router.get('/auth/connections', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT provider, provider_username, provider_avatar, linked_at FROM linked_accounts WHERE user_id = $1 ORDER BY provider`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[CONNECTIONS] List failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch linked accounts' });
    }
});

// --- GET /api/auth/:provider/login - start OAuth ---
router.get('/auth/:provider/login', requireAuth, (req, res) => {
    const { provider } = req.params;
    const p = PROVIDERS[provider];
    if (!p) return res.status(400).json({ error: `Unknown provider: ${provider}` });

    const clientId = p.getClientId();
    if (!clientId) return res.status(503).json({ error: `${p.name} OAuth not configured` });

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_link_state', state, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000
    });
    res.cookie('oauth_link_provider', provider, {
        httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000
    });
    res.redirect(p.authorizeUrl(clientId, p.getRedirectUri(), state));
});

// --- GET /api/auth/:provider/callback - OAuth callback ---
router.get('/auth/:provider/callback', async (req, res) => {
    const { provider } = req.params;
    const p = PROVIDERS[provider];
    if (!p) return res.status(400).send('Unknown provider');

    const { code, state } = req.query;
    if (!code) return res.status(400).send('No code provided');

    const expectedState = req.cookies.oauth_link_state;
    if (!expectedState || !state || expectedState !== state) {
        return res.status(403).send('Invalid state parameter');
    }
    res.clearCookie('oauth_link_state');

    const expectedProvider = req.cookies.oauth_link_provider;
    if (expectedProvider !== provider) {
        return res.status(403).send('Provider mismatch');
    }
    res.clearCookie('oauth_link_provider');

    const token = req.cookies.token;
    if (!token) return res.status(401).send('Not authenticated');

    let userId;
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        userId = decoded.id;
    } catch {
        return res.status(401).send('Invalid authentication');
    }

    try {
        const tokenPayload = p.customTokenPayload
            ? p.customTokenPayload(p.getClientId(), p.getClientSecret(), code, p.getRedirectUri(), state)
            : { client_id: p.getClientId(), client_secret: p.getClientSecret(), code, redirect_uri: p.getRedirectUri(), state };

        const tokenHeaders = p.customTokenPayload
            ? { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
            : { 'Accept': 'application/json', 'Content-Type': 'application/json' };

        const tokenRes = await axios.post(p.tokenUrl, tokenPayload, { headers: tokenHeaders });

        const accessToken = tokenRes.data.access_token;
        if (!accessToken) {
            console.error(`[CONNECTIONS] ${p.name} token exchange failed:`, tokenRes.data);
            return res.redirect('/admin/linktree/?connection=error');
        }

        const userHeaders = p.customUserHeaders
            ? p.customUserHeaders(accessToken, p.getClientId())
            : { Authorization: `Bearer ${accessToken}` };

        const userRes = await axios.get(p.userUrl, { headers: userHeaders });

        const providerUser = p.extractUser(userRes.data);

        // Check if this provider account is already linked by another user
        const existing = await db.query(
            `SELECT user_id FROM linked_accounts WHERE provider = $1 AND provider_account_id = $2`,
            [provider, providerUser.id]
        );
        if (existing.rows.length > 0 && existing.rows[0].user_id !== userId) {
            return res.redirect('/admin/linktree/?connection=taken');
        }

        await db.query(
            `INSERT INTO linked_accounts (user_id, provider, provider_account_id, provider_username, provider_avatar)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, provider) DO UPDATE SET
                provider_account_id = $3, provider_username = $4, provider_avatar = $5, linked_at = NOW()`,
            [userId, provider, providerUser.id, providerUser.username, providerUser.avatar]
        );

        res.redirect('/admin/linktree/?connection=success');
    } catch (err) {
        console.error(`[CONNECTIONS] ${p.name} callback failed:`, err.response?.data || err.message);
        res.redirect('/admin/linktree/?connection=error');
    }
});

// --- POST /api/auth/connections/discord/link - link current Discord user ---
router.post('/auth/connections/discord/link', requireAuth, async (req, res) => {
    try {
        const { id, username, avatar, global_name } = req.user;
        await db.query(
            `INSERT INTO linked_accounts (user_id, provider, provider_account_id, provider_username, provider_avatar)
             VALUES ($1, 'discord', $2, $3, $4)
             ON CONFLICT (user_id, provider) DO UPDATE SET
                provider_account_id = $2, provider_username = $3, provider_avatar = $4, linked_at = NOW()`,
            [id, id, username, avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : null]
        );
        res.json({ success: true, provider_username: username, provider_avatar: avatar });
    } catch (err) {
        console.error('[CONNECTIONS] Discord link failed:', err.message);
        res.status(500).json({ error: 'Failed to link Discord account' });
    }
});

// --- POST /api/auth/connections/:provider/unlink ---
router.post('/auth/connections/:provider/unlink', requireAuth, async (req, res) => {
    try {
        await db.query(
            `DELETE FROM linked_accounts WHERE user_id = $1 AND provider = $2`,
            [req.user.id, req.params.provider]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[CONNECTIONS] Unlink failed:', err.message);
        res.status(500).json({ error: 'Failed to unlink account' });
    }
});

// --- GET /api/team/profiles/:username/connections - public connections for profile ---
router.get('/team/profiles/:username/connections', async (req, res) => {
    try {
        const profileResult = await db.query(
            `SELECT user_id FROM profiles WHERE LOWER(username) = $1 AND activated = $2`,
            [req.params.username.toLowerCase(), true]
        );
        if (profileResult.rows.length === 0) return res.json([]);

        const result = await db.query(
            `SELECT provider, provider_username FROM linked_accounts WHERE user_id = $1`,
            [profileResult.rows[0].user_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[CONNECTIONS] Public fetch failed:', err.message);
        res.json([]);
    }
});

module.exports = router;
module.exports.PROVIDERS = PROVIDERS;
