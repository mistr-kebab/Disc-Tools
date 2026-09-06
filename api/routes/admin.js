const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';
const LOG_FILE = path.join(__dirname, '../error.log');

const { discordFetch, apiCache } = require('../utils/discord');
const { hashIP, hashIPLegacy } = require('../utils/ip');

// Ensure session tracking tables exist
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                global_name TEXT,
                avatar TEXT,
                session_id UUID NOT NULL UNIQUE,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                last_active TIMESTAMP DEFAULT NOW(),
                revoked BOOLEAN DEFAULT FALSE,
                refresh_token TEXT
            )
        `);
        await db.query(`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS refresh_token TEXT`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_session_id ON admin_sessions(session_id)`);
        await db.query(`
            CREATE TABLE IF NOT EXISTS blocked_users (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                blocked_at TIMESTAMP DEFAULT NOW(),
                blocked_by TEXT
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS blocked_ips (
                ip_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                blocked_at TIMESTAMP DEFAULT NOW(),
                blocked_by TEXT
            )
        `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_blocked_ips_user_id ON blocked_ips(user_id)`);
    } catch (e) {
        console.error('[ADMIN] Session table creation failed:', e.message);
    }
})();

const ADMIN_ROLES = [
    '1503064097040629891', // Founder
    '1503064197704061109', // Co-Founder
    '1503064289915965621', // Sr. Admin
    '1503064343837937795'  // Admin
];

const PROTECTED_USERS = ['1366501281337839777'];

const ALL_TEAM_ROLE_IDS = [
    '1503064097040629891', // Founder
    '1503064197704061109', // Co-Founder
    '1503064289915965621', // Sr. Admin
    '1503064343837937795', // Admin
    '1503064391564791899', // Sr. Moderator
    '1503064448267718760', // Moderator
    '1503064501573124276', // Developer
    '1503064547966058626'  // Helper
];

async function checkAdmin(req, res, next) {
    const token = req.cookies.token;
    if (!token) {
        console.log('[ADMIN] No token cookie found');
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;
        console.log('[ADMIN] Token valid for user:', decoded.username);

        // Check if user is blocked
        const blockCheck = await db.query(`SELECT 1 FROM blocked_users WHERE user_id = $1`, [decoded.id]);
        if (blockCheck.rows.length > 0) {
            return res.status(403).json({ error: 'Your account has been blocked from the admin panel.' });
        }

        // Check session validity
        const sid = req.cookies.session_id;
        if (sid) {
            try {
                const sessRes = await db.query(
                    `SELECT revoked FROM admin_sessions WHERE session_id = $1 AND user_id = $2`,
                    [sid, decoded.id]
                );
                if (sessRes.rows.length > 0 && sessRes.rows[0].revoked) {
                    return res.status(401).json({ error: 'Session revoked. Please log in again.' });
                }
                if (sessRes.rows.length > 0) {
                    await db.query(`UPDATE admin_sessions SET last_active = NOW() WHERE session_id = $1`, [sid]);
                }
            } catch (e) {
                console.error('[ADMIN] Session check error:', e.message);
            }
        }

        const cacheKey = `admin_${decoded.id}`;
        if (apiCache.has(cacheKey)) {
            const cached = apiCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 60000) {
                if (cached.isAdmin) {
                    req.highestRole = cached.highestRole;
                    return next();
                }
                return res.status(403).json({ error: 'Not an admin' });
            }
        }

        if (!BOT_TOKEN) return res.status(503).json({ error: 'Bot not configured' });

        console.log('[ADMIN] Checking Discord member for user:', decoded.id);
        const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${decoded.id}`, BOT_TOKEN, 'Bot ');
        const roles = member.roles || [];
        console.log('[ADMIN] Member roles:', roles);
        const isAdmin = roles.some(r => ADMIN_ROLES.includes(r));
        console.log('[ADMIN] Is admin:', isAdmin);

        let highestRole = null;
        if (roles.length > 0) {
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
                const myRoles = roles.map(id => roleMap[id]).filter(Boolean);
                highestRole = myRoles[0] || null;
            } catch (_) {}
        }
        req.highestRole = highestRole;

        apiCache.set(cacheKey, { isAdmin, highestRole, timestamp: Date.now() });

        if (!isAdmin) return res.status(403).json({ error: 'Not an admin' });

        // Auto-create session for existing admins without session_id
        if (!sid) {
            try {
                const newSid = crypto.randomUUID();
                await db.query(
                    `INSERT INTO admin_sessions (user_id, username, global_name, avatar, session_id, user_agent)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT DO NOTHING`,
                    [decoded.id, decoded.username, decoded.global_name, decoded.avatar, newSid, req.headers['user-agent'] || null]
                );
                res.cookie('session_id', newSid, {
                    httpOnly: true, secure: true, sameSite: 'lax',
                    maxAge: 7 * 24 * 60 * 60 * 1000
                });
            } catch (e) {
                console.error('[ADMIN] Session auto-create error:', e.message);
            }
        }

        return next();
    } catch (err) {
        console.error('[ADMIN] Check failed:', err.message, err.response?.status);
        res.status(403).json({ error: 'Admin check failed' });
    }
}

// --- Admin Check ---
router.get('/check', checkAdmin, (req, res) => {
    res.json({
        isAdmin: true,
        highestRole: req.highestRole,
        user: req.user ? {
            id: req.user.id,
            username: req.user.username,
            discriminator: req.user.discriminator,
            avatar: req.user.avatar,
            global_name: req.user.global_name
        } : null
    });
});

// --- Get Announcements ---
router.get('/announcements', checkAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM announcements ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN] Fetch announcements failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// --- Create Announcement ---
router.post('/announcements', checkAdmin, async (req, res) => {
    try {
        const { title, text, type } = req.body;

        const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 200) : '';
        const cleanText = typeof text === 'string' ? text.trim().slice(0, 2000) : '';
        const cleanType = typeof type === 'string' && ['info', 'announcement', 'update', 'alert', 'warning'].includes(type.toLowerCase())
            ? type.toLowerCase()
            : 'announcement';

        if (!cleanTitle || !cleanText) {
            return res.status(400).json({ error: 'Title and text are required.' });
        }

        const annId = `${Date.now()}`;

        await db.query(
            `INSERT INTO announcements (id, title, text, type, active, author_id, author_username, author_avatar, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
                annId,
                cleanTitle,
                cleanText,
                cleanType,
                true,
                req.user.id,
                req.user.username,
                req.user.avatar
            ]
        );

        res.json({ success: true, id: annId });
    } catch (err) {
        console.error('[ADMIN] Create announcement failed:', err.message);
        res.status(500).json({ error: 'Failed to create announcement' });
    }
});

// --- Delete Announcement ---
router.post('/announcements/:id/delete', checkAdmin, async (req, res) => {
    try {
        await db.query(
            `DELETE FROM announcements WHERE id = $1`,
            [req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[ADMIN] Delete announcement failed:', err.message);
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

// --- Get System Stats ---
router.get('/system-stats', checkAdmin, async (req, res) => {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        let disk = { total: '0G', used: '0G', percent: 0 };
        try {
            const df = execSync("df -h / | tail -1").toString().trim().split(/\s+/);
            disk = { total: df[1], used: df[2], percent: parseInt(df[4].replace('%', '')) || 0 };
        } catch (e) {}

        let services = { nginx: 'down', api: 'down', bot: 'down', umami: 'down', postgresql: 'down' };
        try {
            const systemctl = execSync("systemctl is-active nginx").toString().trim();
            services.nginx = systemctl === 'active' ? 'up' : 'down';
        } catch (e) {}
        try {
            const pm2 = execSync("pm2 jlist").toString();
            const pm2Data = JSON.parse(pm2);
            const apiProc = pm2Data.find(p => p.name === 'disc-tools-api');
            services.api = (apiProc && apiProc.pm2_env.status === 'online') ? 'up' : 'down';
            const botProc = pm2Data.find(p => p.name === 'disc-tools-main-bot');
            services.bot = (botProc && botProc.pm2_env.status === 'online') ? 'up' : 'down';
        } catch (e) {}
        try {
            execSync("pg_isready -q");
            services.postgresql = 'up';
        } catch (e) {}
        try {
            const umami = execSync("systemctl is-active umami", { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
            services.umami = umami === 'active' ? 'up' : 'down';
        } catch (e) {
            try {
                const curl = execSync("curl -sf -o /dev/null http://localhost:3000/", { timeout: 3000 }).toString().trim();
                services.umami = curl === '' ? 'up' : 'down';
            } catch (e2) {}
        }

        let pageviews = 0;
        try {
            const pv = await db.query('SELECT count FROM page_views WHERE date = CURRENT_DATE');
            if (pv.rows.length > 0) pageviews = pv.rows[0].count;
        } catch (e) {
            console.error('[ADMIN] Pageviews query failed:', e.message);
        }

        res.json({
            cpu: os.loadavg()[0].toFixed(2),
            ram: { total: totalMem, used: usedMem, percent: Math.round((usedMem/totalMem)*100) },
            disk,
            uptime: os.uptime(),
            services,
            pageviews
        });
    } catch (err) {
        console.error('[ADMIN] System stats failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch system stats' });
    }
});

// --- Get System History ---
router.get('/system-history', checkAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT cpu, ram, disk, recorded_at FROM stats_history ORDER BY recorded_at DESC LIMIT 144`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN] System history failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch system history' });
    }
});

// --- Get Database Info ---
router.get('/db-info', checkAdmin, async (req, res) => {
    try {
        const versionResult = await db.query(`SELECT version()`);
        const version = versionResult.rows[0].version.split(',')[0];

        const sizeResult = await db.query(`
            SELECT pg_database_size(current_database()) as size_bytes,
                   pg_size_pretty(pg_database_size(current_database())) as size_pretty
        `);
        const dbSize = sizeResult.rows[0];

        const connResult = await db.query(`
            SELECT count(*)::int as active_conns,
                   (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_conns
            FROM pg_stat_activity WHERE state = 'active'
        `);
        const conns = connResult.rows[0];

        const hitResult = await db.query(`
            SELECT round(blks_hit::numeric / (blks_hit + blks_read) * 100, 1) as cache_hit_ratio
            FROM pg_stat_database WHERE datname = current_database()
        `);
        const cacheHit = hitResult.rows[0]?.cache_hit_ratio || 0;

        const uptimeResult = await db.query(`SELECT pg_postmaster_start_time() as start_time`);
        const uptime = uptimeResult.rows[0].start_time;

        res.json({
            version,
            size: dbSize.size_pretty,
            sizeBytes: dbSize.size_bytes,
            connections: conns.active_conns,
            maxConnections: conns.max_conns,
            cacheHitRatio: cacheHit,
            startTime: uptime
        });
    } catch (err) {
        console.error('[ADMIN] DB info failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch database info' });
    }
});

// --- Get Umami Analytics Stats ---
router.get('/umami-stats', checkAdmin, async (req, res) => {
    try {
        const { Pool } = require('pg');
        const umami = new Pool({
            user: 'umami',
            password: process.env.UMAMI_DB_PASSWORD,
            host: 'localhost',
            port: 5432,
            database: 'umami',
            max: 1,
            idleTimeoutMillis: 5000,
            connectionTimeoutMillis: 3000
        });

        const wid = '0cf82497-80c8-42a2-b6e4-8a8ae179d1fe';

        const [todayRes, weekRes, monthRes, topPages, browsers, devices, countries, osRes, uniques] = await Promise.all([
            umami.query(`SELECT count(*)::int as cnt FROM website_event WHERE website_id = $1 AND created_at >= CURRENT_DATE AND event_type = 1`, [wid]),
            umami.query(`SELECT count(*)::int as cnt FROM website_event WHERE website_id = $1 AND created_at >= CURRENT_DATE - interval '7 days' AND event_type = 1`, [wid]),
            umami.query(`SELECT count(*)::int as cnt FROM website_event WHERE website_id = $1 AND created_at >= CURRENT_DATE - interval '30 days' AND event_type = 1`, [wid]),
            umami.query(`SELECT url_path, count(*)::int as cnt FROM website_event WHERE website_id = $1 AND created_at >= CURRENT_DATE - interval '7 days' AND event_type = 1 GROUP BY url_path ORDER BY cnt DESC LIMIT 15`, [wid]),
            umami.query(`SELECT s.browser, count(*)::int as cnt FROM website_event e JOIN session s ON e.session_id = s.session_id WHERE e.website_id = $1 AND e.created_at >= CURRENT_DATE - interval '7 days' AND e.event_type = 1 GROUP BY s.browser ORDER BY cnt DESC`, [wid]),
            umami.query(`SELECT s.device, count(*)::int as cnt FROM website_event e JOIN session s ON e.session_id = s.session_id WHERE e.website_id = $1 AND e.created_at >= CURRENT_DATE - interval '7 days' AND e.event_type = 1 GROUP BY s.device ORDER BY cnt DESC`, [wid]),
            umami.query(`SELECT s.country, count(*)::int as cnt FROM website_event e JOIN session s ON e.session_id = s.session_id WHERE e.website_id = $1 AND e.created_at >= CURRENT_DATE - interval '7 days' AND e.event_type = 1 GROUP BY s.country ORDER BY cnt DESC`, [wid]),
            umami.query(`SELECT s.os, count(*)::int as cnt FROM website_event e JOIN session s ON e.session_id = s.session_id WHERE e.website_id = $1 AND e.created_at >= CURRENT_DATE - interval '7 days' AND e.event_type = 1 GROUP BY s.os ORDER BY cnt DESC`, [wid]),
            umami.query(`SELECT count(DISTINCT s.session_id)::int as cnt FROM website_event e JOIN session s ON e.session_id = s.session_id WHERE e.website_id = $1 AND e.created_at >= CURRENT_DATE AND e.event_type = 1`, [wid])
        ]);

        await umami.end();

        res.json({
            today: todayRes.rows[0].cnt,
            week: weekRes.rows[0].cnt,
            month: monthRes.rows[0].cnt,
            uniqueVisits: uniques.rows[0].cnt,
            topPages: topPages.rows,
            browsers: browsers.rows,
            devices: devices.rows,
            countries: countries.rows,
            os: osRes.rows
        });
    } catch (err) {
        console.error('[ADMIN] Umami stats failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// --- Get Logs ---
router.get('/logs', checkAdmin, (req, res) => {
    const type = req.query.type === 'mod' ? 'mod' : 'error';
    const logFile = type === 'mod' ? path.join(__dirname, '../mod.log') : LOG_FILE;

    if (fs.existsSync(logFile)) {
        try {
            const content = fs.readFileSync(logFile, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0).slice(-100).reverse();
            res.json({ logs: lines });
        } catch (e) {
            res.json({ logs: [] });
        }
    } else {
        res.json({ logs: [] });
    }
});

// --- Get Members ---
router.get('/members', checkAdmin, async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 1000);
        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Bot not configured' });
        }
        const [members, roles] = await Promise.all([
            discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=${limit}`, BOT_TOKEN, 'Bot '),
            discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`, BOT_TOKEN, 'Bot ')
        ]);

        // Sort roles by position descending (highest first)
        roles.sort((a, b) => b.position - a.position);

        // Enrich members with resolved role details, sorted by position descending
        const enriched = members.map(m => {
            const memberRoles = (m.roles || [])
                .map(id => roles.find(r => r.id === id))
                .filter(Boolean)
                .sort((a, b) => b.position - a.position);
            return { ...m, enrichedRoles: memberRoles };
        });

        // Sort members by highest role position (descending)
        enriched.sort((a, b) => {
            const aPos = a.enrichedRoles.length > 0 ? a.enrichedRoles[0].position : -1;
            const bPos = b.enrichedRoles.length > 0 ? b.enrichedRoles[0].position : -1;
            return bPos - aPos;
        });

        res.json({ members: enriched, roles });
    } catch (e) {
        console.error('[ADMIN] Fetch members failed:', e.message);
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

const KICK_LOG_CHANNEL = '1503119647539597515';
const BAN_LOG_CHANNEL = '1503119628199788718';

async function sendDiscordDM(userId, embeds) {
    const dm = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recipient_id: userId })
    });
    if (!dm.ok) throw new Error('Failed to create DM channel');
    const dmChannel = await dm.json();
    await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
        method: 'POST',
        headers: {
            'Authorization': `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ embeds })
    });
}

async function sendLog(channelId, embed) {
    try {
        await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (e) {
        console.warn(`[LOG] Failed to send to channel ${channelId}:`, e.message);
    }
}

async function fetchUser(userId) {
    try {
        return await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
    } catch {
        return { id: userId, username: 'Unknown', global_name: null };
    }
}

async function deleteProfile(userId) {
    try {
        const profile = await db.query(
            `SELECT username FROM profiles WHERE user_id = $1`,
            [userId]
        );
        if (profile.rows.length === 0) return;

        const { username } = profile.rows[0];

        if (username) {
            const safeName = username.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
            const userFolder = path.resolve(path.join(__dirname, '../../team', safeName));
            if (userFolder.startsWith(path.resolve(path.join(__dirname, '../../team')))) {
                if (fs.existsSync(userFolder)) {
                    fs.rmSync(userFolder, { recursive: true, force: true });
                }
            }
        }

        await db.query(`DELETE FROM profile_links WHERE user_id = $1`, [userId]);
        await db.query(`DELETE FROM profiles WHERE user_id = $1`, [userId]);
        console.log(`[ADMIN] Deleted profile for ${userId}${username ? ` (${username})` : ''}`);
    } catch (err) {
        console.error(`[ADMIN] Failed to delete profile for ${userId}:`, err.message);
    }
}

// --- Kick Member ---
router.post('/members/:id/kick', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 512) : 'No reason provided.';
        const modTag = req.user.username ? `${req.user.username} (${req.user.id})` : 'Unknown';

        // Fetch user info for log
        const user = await fetchUser(id);
        const displayName = user.global_name || user.username || id;

        // Send DM first
        try {
            await sendDiscordDM(id, [{
                color: 0xE74C3C,
                title: 'Kicked from Disc-Tools',
                description: `You have been kicked from the **Disc-Tools** Discord server.`,
                fields: [
                    { name: '👤 Kicked by', value: `<@${req.user.id}>`, inline: true },
                    { name: '📅 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: '❓ Reason', value: cleanReason, inline: false }
                ],
                thumbnail: user.avatar ? { url: `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128` } : undefined,
                footer: { text: 'Disc-Tools Moderation' }
            }]);
        } catch (dmErr) {
            console.warn(`[KICK] Could not DM ${id}:`, dmErr.message);
        }

        // Execute kick
        const kickRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'X-Audit-Log-Reason': cleanReason
            }
        });

        if (!kickRes.ok) {
            const errData = await kickRes.json().catch(() => ({}));
            return res.status(kickRes.status).json({ error: `Kick failed: ${errData.message || kickRes.statusText}` });
        }

        // Delete profile linktree
        await deleteProfile(id);

        // Send log to kick channel
        await sendLog(KICK_LOG_CHANNEL, {
            color: 0xE74C3C,
            title: '🚪 Member Kicked',
            thumbnail: user.avatar ? { url: `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128` } : undefined,
            fields: [
                { name: '👤 User', value: `${displayName}\n<@${id}> (\`${id}\`)`, inline: false },
                { name: '❓ Reason', value: cleanReason, inline: false },
                { name: '🛡️ Moderator', value: `<@${req.user.id}>`, inline: true },
                { name: '📅 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '🔧 Source', value: 'Admin Panel', inline: true }
            ]
        });

        console.log(`[KICK] ${id} (${displayName}) kicked by ${modTag}. Reason: ${cleanReason}`);
        res.json({ success: true, kicked: id, reason: cleanReason });
    } catch (e) {
        console.error('[KICK] Error:', e.message);
        res.status(500).json({ error: 'Failed to kick member' });
    }
});

// --- Ban Member ---
router.post('/members/:id/ban', checkAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 512) : 'No reason provided.';
        const modTag = req.user.username ? `${req.user.username} (${req.user.id})` : 'Unknown';

        // Fetch user info for log
        const user = await fetchUser(id);
        const displayName = user.global_name || user.username || id;

        // Send DM first
        try {
            await sendDiscordDM(id, [{
                color: 0xE74C3C,
                title: 'Banned from Disc-Tools',
                description: `You have been banned from the **Disc-Tools** Discord server.`,
                fields: [
                    { name: '👤 Banned by', value: `<@${req.user.id}>`, inline: true },
                    { name: '📅 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    { name: '❓ Reason', value: cleanReason, inline: false }
                ],
                thumbnail: user.avatar ? { url: `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128` } : undefined,
                footer: { text: 'Disc-Tools Moderation' }
            }]);
        } catch (dmErr) {
            console.warn(`[BAN] Could not DM ${id}:`, dmErr.message);
        }

        // Execute ban
        const banRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/bans/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Audit-Log-Reason': cleanReason
            },
            body: JSON.stringify({
                delete_message_days: 1,
                reason: cleanReason
            })
        });

        if (!banRes.ok) {
            const errData = await banRes.json().catch(() => ({}));
            return res.status(banRes.status).json({ error: `Ban failed: ${errData.message || banRes.statusText}` });
        }

        // Delete profile linktree
        await deleteProfile(id);

        // Send log to ban channel
        await sendLog(BAN_LOG_CHANNEL, {
            color: 0xE74C3C,
            title: '🔨 Member Banned',
            thumbnail: user.avatar ? { url: `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128` } : undefined,
            fields: [
                { name: '👤 User', value: `${displayName}\n<@${id}> (\`${id}\`)`, inline: false },
                { name: '❓ Reason', value: cleanReason, inline: false },
                { name: '🛡️ Moderator', value: `<@${req.user.id}>`, inline: true },
                { name: '📅 When', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                { name: '🔧 Source', value: 'Admin Panel', inline: true }
            ]
        });

        console.log(`[BAN] ${id} (${displayName}) banned by ${modTag}. Reason: ${cleanReason}`);
        res.json({ success: true, banned: id, reason: cleanReason });
    } catch (e) {
        console.error('[BAN] Error:', e.message);
        res.status(500).json({ error: 'Failed to ban member' });
    }
});

// --- Session Management ---
router.get('/sessions', checkAdmin, async (req, res) => {
    try {
        const result = await db.query(`
            SELECT DISTINCT ON (s.user_id)
                   s.id, s.user_id, s.username, s.global_name, s.avatar, s.session_id,
                   s.user_agent, s.created_at, s.last_active, s.revoked,
                   CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as blocked,
                   CASE WHEN ip.user_id IS NOT NULL THEN true ELSE false END as ip_blocked
            FROM admin_sessions s
            LEFT JOIN blocked_users b ON s.user_id = b.user_id
            LEFT JOIN blocked_ips ip ON s.user_id = ip.user_id
            ORDER BY s.user_id, s.revoked ASC, s.last_active DESC
        `);
        res.json(result.rows);
    } catch (e) {
        console.error('[ADMIN] Sessions fetch failed:', e.message);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

router.post('/sessions/logout/:userId', checkAdmin, async (req, res) => {
    try {
        await db.query(`UPDATE admin_sessions SET revoked = true WHERE user_id = $1`, [req.params.userId]);
        const self = req.user && req.user.id === req.params.userId;
        if (self) {
            res.clearCookie('token');
            res.clearCookie('discord_at');
            res.clearCookie('session_id');
        }
        res.json({ success: true, self });
    } catch (e) {
        res.status(500).json({ error: 'Failed to logout user' });
    }
});

router.post('/sessions/revoke-all/:userId', checkAdmin, async (req, res) => {
    try {
        await db.query(`UPDATE admin_sessions SET revoked = true WHERE user_id = $1`, [req.params.userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to revoke sessions' });
    }
});

async function getClientIp(req) {
    let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.split(':').pop();
    return ip;
}

router.post('/sessions/block/:userId', checkAdmin, async (req, res) => {
    if (PROTECTED_USERS.includes(req.params.userId)) {
        return res.status(403).json({ error: 'This user cannot be blocked.' });
    }
    try {
        // Revoke all admin sessions
        await db.query(`UPDATE admin_sessions SET revoked = true WHERE user_id = $1`, [req.params.userId]);

        // Add to blocked_users (admin panel ban)
        await db.query(
            `INSERT INTO blocked_users (user_id, username, blocked_by) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username`,
            [req.params.userId, req.body.username || 'Unknown', req.user.id]
        );

        // Look up user's IP hashes from verified_users and block them site-wide
        const ipRows = await db.query(
            `SELECT DISTINCT ip_hash FROM verified_users WHERE user_id = $1`,
            [req.params.userId]
        );

        let ipBanCount = 0;
        for (const row of ipRows.rows) {
            try {
                await db.query(
                    `INSERT INTO blocked_ips (ip_hash, user_id, blocked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                    [row.ip_hash, req.params.userId, req.user.id]
                );
                ipBanCount++;
            } catch (e) {}
        }

        console.log(`[ADMIN] Blocked user ${req.params.userId} (${req.body.username || 'Unknown'}) by ${req.user.username} - ${ipBanCount} IP hashes banned`);
        res.json({ success: true, ipBanned: ipBanCount });
    } catch (e) {
        console.error('[ADMIN] Block user failed:', e.message);
        res.status(500).json({ error: 'Failed to block user' });
    }
});

router.post('/sessions/unblock/:userId', checkAdmin, async (req, res) => {
    try {
        await db.query(`DELETE FROM blocked_users WHERE user_id = $1`, [req.params.userId]);
        await db.query(`DELETE FROM blocked_ips WHERE user_id = $1`, [req.params.userId]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to unblock user' });
    }
});

// --- Cleanup Orphaned Profiles ---
router.post('/linktree/cleanup', checkAdmin, async (req, res) => {
    try {
        if (!BOT_TOKEN) return res.status(503).json({ error: 'Bot not configured' });

        const profiles = await db.query(
            `SELECT user_id, username FROM profiles WHERE activated = $1`,
            [true]
        );

        let cleaned = 0;
        let skipped = 0;
        let errors = 0;

        for (const profile of profiles.rows) {
            try {
                const member = await discordFetch(
                    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${profile.user_id}`,
                    BOT_TOKEN, 'Bot '
                );

                const roles = member.roles || [];
                const isTeam = roles.some(r => ALL_TEAM_ROLE_IDS.includes(r));

                if (!isTeam) {
                    await deleteProfile(profile.user_id);
                    cleaned++;
                } else {
                    skipped++;
                }
            } catch (err) {
                if (err.status === 404 || err.message?.includes('404')) {
                    await deleteProfile(profile.user_id);
                    cleaned++;
                } else {
                    console.error(`[ADMIN] Cleanup error for ${profile.user_id}:`, err.message);
                    errors++;
                }
            }
        }

        res.json({ success: true, cleaned, skipped, errors });
    } catch (err) {
        console.error('[ADMIN] Cleanup failed:', err.message);
        res.status(500).json({ error: 'Cleanup failed' });
    }
});

module.exports = router;
