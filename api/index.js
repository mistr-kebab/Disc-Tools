const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();

app.set('trust proxy', 'loopback');

// Helmet middleware (headers: CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", "https://cdn.discordapp.com", "https://cdn.jsdelivr.net", "https://i.scdn.co", "https://mosaic.scdn.co", "https://image-cdn-ak.spotifycdn.com", "https://www.google.com", "https://t2.gstatic.com", "https://*.giphy.com", "https://icons.duckduckgo.com", "https://avatars.githubusercontent.com", "https://static-cdn.jtvnw.net", "https://storage.ko-fi.com"],
            connectSrc: ["'self'", "https://discord.com", "https://umami.disc-tools.de", "https://soundcloud.com", "https://api.stripe.com"],
            frameSrc: ["'self'", "https://open.spotify.com", "https://w.soundcloud.com", "https://www.google.com", "https://stripe.com"],
            fontSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

// Rate limiting
const rateLimitMiddleware = require('./middleware/rateLimiter');
app.use(rateLimitMiddleware);

// CORS
const corsMiddleware = require('./middleware/cors');
app.use(corsMiddleware);

// VPN check (server-side enforcement)
const vpnMiddleware = require('./middleware/vpnCheck');
app.use('/api', vpnMiddleware);

// Import routes
const authRoutes = require('./routes/auth');
const discordRoutes = require('./routes/discord');
const statsRoutes = require('./routes/stats');
const partnersRoutes = require('./routes/partners');
const profilesRoutes = require('./routes/profiles');
const verifyRoutes = require('./routes/verify');
const proxyRoutes = require('./routes/proxy');
const connectionsRoutes = require('./routes/connections');
const gifsRoutes = require('./routes/gifs');
const tiktokRoutes = require('./routes/tiktok');
const linktreeRoutes = require('./routes/linktree');
const snooperRoutes = require('./routes/snooper');
const sessionsRoutes = require('./routes/sessions');

// Register routes
app.use('/', tiktokRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', discordRoutes);
app.use('/api', statsRoutes);
app.use('/', partnersRoutes);
app.use('/api', profilesRoutes);
app.use('/api', verifyRoutes);
app.use('/api', connectionsRoutes);
app.use('/api', gifsRoutes);
app.use('/api', linktreeRoutes);
app.use('/', snooperRoutes);
app.use('/api', sessionsRoutes);

function getClientIp(req) {
    let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.split(':').pop();
    return ip;
}

// --- Team Endpoint ---
const db = require('./db');
const { discordFetch } = require('./utils/discord');

const TEAM_ROLES = [
    { id: '1503064097040629891', name: 'Founder', priority: 1, color: '#5865F2' },
    { id: '1503064197704061109', name: 'Co-Founder', priority: 2, color: '#4752C4' },
    { id: '1503064289915965621', name: 'Sr. Admin', priority: 3, color: '#E74C3C' },
    { id: '1503064343837937795', name: 'Admin', priority: 4, color: '#E67E22' },
    { id: '1503064391564791899', name: 'Sr. Moderator', priority: 5, color: '#F1C40F' },
    { id: '1503064448267718760', name: 'Moderator', priority: 6, color: '#2ECC71' },
    { id: '1503064501573124276', name: 'Developer', priority: 7, color: '#1ABC9C' },
    { id: '1503064547966058626', name: 'Helper', priority: 8, color: '#3498DB' }
];

const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;

let teamCache = { data: null, timestamp: 0 };

app.get('/api/team', async (req, res) => {
    const now = Date.now();
    if (teamCache.data && now - teamCache.timestamp < 60000) {
        return res.json(teamCache.data);
    }

    if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'Bot token not configured' });
    }

    try {
        // Load presences from database
        const presencesResult = await db.query('SELECT user_id, status FROM presences');
        const presences = {};
        presencesResult.rows.forEach(row => {
            presences[row.user_id] = row.status;
        });

        // Load custom profiles
        const profilesResult = await db.query(
            `SELECT user_id, username, visibility, activated FROM profiles`
        );
        const profilesMap = {};
        profilesResult.rows.forEach(row => {
            profilesMap[row.user_id] = row;
        });

        // Fetch Guild Members
        const members = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members?limit=1000`, BOT_TOKEN, 'Bot ');

        // Filter and Map Team Members
        const teamMembers = [];
        for (const m of members) {
            const memberRoles = m.roles || [];
            const matchingRoles = TEAM_ROLES.filter(r => memberRoles.includes(r.id));

            if (matchingRoles.length > 0) {
                const highestRole = matchingRoles.sort((a, b) => a.priority - b.priority)[0];

                let bannerURL = null;
                let avatarDecorationAsset = null;
                try {
                    const fullUser = await discordFetch(`https://discord.com/api/v10/users/${m.user.id}`, BOT_TOKEN, 'Bot ');
                    if (fullUser.banner) {
                        const ext = fullUser.banner.startsWith('a_') ? 'gif' : 'png';
                        bannerURL = `https://cdn.discordapp.com/banners/${fullUser.id}/${fullUser.banner}.${ext}?size=600`;
                    }
                    if (fullUser.avatar_decoration_data && fullUser.avatar_decoration_data.asset) {
                        avatarDecorationAsset = fullUser.avatar_decoration_data.asset;
                    }
                } catch (e) {}

                const avatarExt = m.user.avatar && m.user.avatar.startsWith('a_') ? 'gif' : 'png';
                const avatarURL = m.user.avatar
                    ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.${avatarExt}?size=256`
                    : `https://cdn.discordapp.com/embed/avatars/${(parseInt(m.user.id) >> 22) % 6}.png`;

                const profile = profilesMap[m.user.id];
                const hasProfile = profile && profile.visibility === 'public' && profile.activated === true;
                const profileUsername = hasProfile ? profile.username : null;

                teamMembers.push({
                    userId: m.user.id,
                    username: m.user.username,
                    displayName: m.nick || m.user.global_name || m.user.username,
                    avatarURL,
                    bannerURL,
                    avatarDecorationAsset,
                    role: highestRole,
                    onlineStatus: presences[m.user.id] || 'offline',
                    hasProfile,
                    profileUsername
                });
            }
        }

        // Group by Role
        const grouped = TEAM_ROLES.map(role => ({
            ...role,
            members: teamMembers.filter(m => m.role.id === role.id)
        }));

        teamCache = { data: grouped, timestamp: now };
        res.json(grouped);
    } catch (err) {
        console.error('[TEAM API] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch team members' });
    }
});

// --- Username History ---
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS username_history_optout (
                user_id VARCHAR(20) PRIMARY KEY,
                opted_out_at TIMESTAMP DEFAULT NOW()
            )
        `);
    } catch (e) {
        console.error('[USERNAME-HISTORY-OPTOUT] Table init failed:', e.message);
    }
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS username_history_free_usage (
                ip_hash VARCHAR(64) PRIMARY KEY,
                used_at TIMESTAMP DEFAULT NOW()
            )
        `);
    } catch (e) {
        console.error('[USERNAME-HISTORY-FREE-USAGE] Table init failed:', e.message);
    }
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS username_history_user_usage (
                user_id VARCHAR(20) NOT NULL,
                used_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, used_at)
            )
        `);
    } catch (e) {
        console.error('[USERNAME-HISTORY-USER-USAGE] Table init failed:', e.message);
    }
})();

app.get('/api/username-history/eligibility', async (req, res) => {
    try {
        const token = req.cookies?.token;
        let user = null;
        if (token) {
            try {
                user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            } catch (e) {}
        }

        if (!user) {
            return res.json({
                eligible: false,
                isLoggedIn: false,
                optedOut: false,
                reason: 'login_required'
            });
        }

        const optout = await db.query(
            'SELECT 1 FROM username_history_optout WHERE user_id = $1',
            [user.id]
        );
        if (optout.rows.length > 0) {
            return res.json({
                eligible: false,
                isLoggedIn: true,
                optedOut: true,
                reason: 'optout'
            });
        }

        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true AND (expires_at IS NULL OR expires_at > NOW())',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {}

        return res.json({
            eligible: isPremium,
            isLoggedIn: true,
            optedOut: false,
            isPremium: isPremium,
            reason: isPremium ? null : 'premium_required'
        });
    } catch (err) {
        console.error('[USERNAME-HISTORY-ELIGIBILITY] Error:', err.message);
        res.json({ eligible: false, isLoggedIn: false, optedOut: false, reason: 'error' });
    }
});

const BETA_ROLE_ID = '1513630971679736078';

function isBetaOrAdmin(user) {
    if (!user || !user.guild_roles) return false;
    const adminRoles = ['1503064097040629891', '1503064197704061109', '1503064289915965621', '1503064343837937795'];
    return user.guild_roles.includes(BETA_ROLE_ID) || user.guild_roles.some(r => adminRoles.includes(r));
}

app.get('/api/user-info/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || !/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        if (!BOT_TOKEN) return res.status(503).json({ error: 'Bot not configured' });

        const userRes = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        if (!userRes.ok) return res.status(404).json({ error: 'User not found' });
        const data = await userRes.json();
        res.json(data);
    } catch (err) {
        console.error('[USER-INFO] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch user info' });
    }
});

app.get('/api/username-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId || !/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Premium-only: require login + premium
        const token = req.cookies?.token;
        let user = null;
        if (token) {
            try {
                user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            } catch (e) {}
        }

        if (!user) {
            return res.status(403).json({
                error: 'Access denied',
                reason: 'login_required',
                isLoggedIn: false
            });
        }

        // Requester opt-out check
        const requesterOptout = await db.query(
            'SELECT 1 FROM username_history_optout WHERE user_id = $1',
            [user.id]
        );
        if (requesterOptout.rows.length > 0) {
            return res.status(403).json({
                error: 'Access denied',
                reason: 'optout',
                isLoggedIn: true,
                optedOut: true
            });
        }

        // Premium check
        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true AND (expires_at IS NULL OR expires_at > NOW())',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {}

        if (!isPremium) {
            return res.status(403).json({
                error: 'Access denied',
                reason: 'premium_required',
                isLoggedIn: true,
                isPremium: false
            });
        }

        // Target opt-out check (hides history but data stays saved)
        const targetOptout = await db.query(
            'SELECT 1 FROM username_history_optout WHERE user_id = $1',
            [userId]
        );
        if (targetOptout.rows.length > 0) {
            return res.json({ history: [], optedOut: true });
        }

        const result = await db.query(
            `SELECT old_username, new_username, changed_at
             FROM username_history
             WHERE user_id = $1
             ORDER BY changed_at DESC`,
            [userId]
        );

        res.json({ history: result.rows, optedOut: false });
    } catch (err) {
        console.error('[USERNAME-HISTORY] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch username history' });
    }
});

app.post('/api/username-history/optout', async (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.status(401).json({ error: 'Not authenticated' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

        const existing = await db.query(
            `SELECT 1 FROM username_history_optout WHERE user_id = $1`,
            [decoded.id]
        );

        if (existing.rows.length > 0) {
            await db.query(`DELETE FROM username_history_optout WHERE user_id = $1`, [decoded.id]);
            return res.json({ optedOut: false });
        } else {
            await db.query(
                `INSERT INTO username_history_optout (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
                [decoded.id]
            );
            return res.json({ optedOut: true });
        }
    } catch (err) {
        console.error('[USERNAME-HISTORY-OPTOUT] Error:', err.message);
        res.status(500).json({ error: 'Failed to toggle opt-out status' });
    }
});

app.get('/api/username-history/optout/status', async (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.json({ optedOut: false });

        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

        const result = await db.query(
            `SELECT 1 FROM username_history_optout WHERE user_id = $1`,
            [decoded.id]
        );

        res.json({ optedOut: result.rows.length > 0 });
    } catch (err) {
        res.json({ optedOut: false });
    }
});

app.get('/api/user/check-beta', async (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.json({ isBetaOrAdmin: false });

        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        let authorized = isBetaOrAdmin(decoded);

        if (!authorized && BOT_TOKEN) {
            try {
                const member = await discordFetch(
                    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${decoded.id}`,
                    BOT_TOKEN, 'Bot '
                );
                const roles = member.roles || [];
                authorized = roles.includes(BETA_ROLE_ID) || roles.some(r => ['1503064097040629891', '1503064197704061109', '1503064289915965621', '1503064343837937795'].includes(r));
            } catch {}
        }

        res.json({ isBetaOrAdmin: authorized });
    } catch {
        res.json({ isBetaOrAdmin: false });
    }
});

// --- Announcement Read Tracking ---
// Ensure tables exist
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
        await db.query(`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ip_hash VARCHAR(64)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions(user_id)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_session_id ON admin_sessions(session_id)`);
    } catch (e) {
        console.error('[SESSIONS] Table init failed:', e.message);
    }
    try {
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
        console.error('[BLOCKED TABLES] Init failed:', e.message);
    }
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS stats_history (cpu DECIMAL, ram DECIMAL, disk DECIMAL, recorded_at TIMESTAMP)
        `);
    } catch (e) {
        console.error('[STATS TABLE] Init failed:', e.message);
    }
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gifs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id VARCHAR(20) NOT NULL,
                storage_path TEXT NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                name VARCHAR(100) NOT NULL,
                uploader_name VARCHAR(32),
                tags TEXT[] DEFAULT '{}',
                nsfw BOOLEAN DEFAULT false,
                file_size INTEGER NOT NULL,
                width INTEGER,
                height INTEGER,
                moderation_status VARCHAR(20) DEFAULT 'pending',
                moderated_by VARCHAR(20),
                moderation_reason TEXT,
                moderated_at TIMESTAMP,
                moderation_message_id TEXT,
                views INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_gifs_user_id ON gifs(user_id)
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_gifs_moderation ON gifs(moderation_status)
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_gifs_created ON gifs(created_at DESC)
        `);
    } catch (e) {
        console.error('[GIFS TABLE] Init failed:', e.message);
    }
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_birthdays (
                user_id VARCHAR(20) PRIMARY KEY,
                birthday DATE NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
    } catch (e) {
        console.error('[USER BIRTHDAYS] Init failed:', e.message);
    }
})();

// GET: fetch user's read announcement IDs (optional auth)
app.get('/api/announcements/read', async (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.json({ readIds: [] });

        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const result = await db.query(
            'SELECT announcement_id FROM announcement_reads WHERE user_id = $1',
            [decoded.id]
        );
        res.json({ readIds: result.rows.map(r => r.announcement_id) });
    } catch (err) {
        res.json({ readIds: [] });
    }
});

// POST: mark announcement(s) as read/unread (optional auth, silent no-op for guests)
app.post('/api/announcements/read', async (req, res) => {
    try {
        const token = req.cookies?.token;
        if (!token) return res.json({ success: true });

        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const { id, ids, unread, markAll } = req.body;

        if (markAll) {
            await db.query(
                `INSERT INTO announcement_reads (user_id, announcement_id)
                 SELECT $1, id FROM announcements WHERE active = true
                 ON CONFLICT (user_id, announcement_id) DO NOTHING`,
                [decoded.id]
            );
        } else if (ids && Array.isArray(ids)) {
            if (unread) {
                await db.query(
                    'DELETE FROM announcement_reads WHERE user_id = $1 AND announcement_id = ANY($2)',
                    [decoded.id, ids]
                );
            } else {
                const values = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
                const params = [decoded.id, ...ids];
                await db.query(
                    `INSERT INTO announcement_reads (user_id, announcement_id) VALUES ${values} ON CONFLICT DO NOTHING`,
                    params
                );
            }
        } else if (id) {
            if (unread) {
                await db.query(
                    'DELETE FROM announcement_reads WHERE user_id = $1 AND announcement_id = $2',
                    [decoded.id, id]
                );
            } else {
                await db.query(
                    'INSERT INTO announcement_reads (user_id, announcement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [decoded.id, id]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[ANNOUNCEMENT_READS] Update failed:', err.message);
        res.status(500).json({ error: 'Failed to update read state' });
    }
});

// --- Public Announcements ---
app.get('/api/announcements', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, title, text, type, author_id, author_username, author_avatar, author_avatar_decoration, created_at
             FROM announcements WHERE active = true ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[ANNOUNCEMENTS] Fetch failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// --- Log errors to file ---
const LOG_FILE = path.join(__dirname, 'error.log');
function logError(msg, context = {}) {
    const logEntry = `[${new Date().toISOString()}] ${msg} | Context: ${JSON.stringify(context)}\n`;
    try {
        fs.appendFileSync(LOG_FILE, logEntry);
    } catch (e) {
        console.error('Failed to write to error log:', e);
    }
}

// --- System stats collection ---
setInterval(async () => {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        let diskPercent = 0;
        try {
            const { execSync } = require('child_process');
            const df = execSync("df -h / | tail -1").toString().trim().split(/\s+/);
            diskPercent = parseInt(df[4].replace('%', '')) || 0;
        } catch (e) {}

        const cpu = parseFloat(os.loadavg()[0].toFixed(2)) * 25;
        const ram = Math.round((usedMem / totalMem) * 100);

        await db.query(
            `INSERT INTO stats_history (cpu, ram, disk, recorded_at) VALUES ($1, $2, $3, NOW())`,
            [cpu, ram, diskPercent]
        );

        // Keep only last 144 entries (24h worth at 10min intervals)
        await db.query(
            `DELETE FROM stats_history WHERE id NOT IN (SELECT id FROM stats_history ORDER BY recorded_at DESC LIMIT 144)`
        );
    } catch (e) {
        console.error('[STATS COLLECTOR] Failed:', e.message);
    }
}, 10 * 60 * 1000); // Every 10 minutes

// --- Linktree cleanup (archive non-premium, delete after 30 days) ---
async function cleanupLinktreeProfiles() {
    try {
        const result = await db.query(`
            DELETE FROM linktree_profiles
            WHERE archived_at IS NOT NULL
            AND archived_at < NOW() - INTERVAL '30 days'
        `);
        if (result.rowCount > 0) {
            console.log(`[LINKTREE] Cleaned up ${result.rowCount} expired profiles`);
        }

        await db.query(`
            UPDATE linktree_profiles
            SET is_active = false, archived_at = COALESCE(archived_at, NOW()), updated_at = NOW()
            WHERE is_active = true
            AND user_id NOT IN (SELECT user_id FROM premium_users WHERE active = true AND (expires_at IS NULL OR expires_at > NOW()))
        `);
    } catch (e) {
        console.error('[LINKTREE] Cleanup failed:', e.message);
    }
}

cleanupLinktreeProfiles();
setInterval(cleanupLinktreeProfiles, 60 * 60 * 1000);

// --- User Lookup ---
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_lookup_usage (
                user_id VARCHAR(20) NOT NULL,
                used_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, used_at)
            )
        `);
    } catch (e) {
        console.error('[USER-LOOKUP] Table init failed:', e.message);
    }
})();

(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS server_lookup_usage (
                user_id VARCHAR(20) NOT NULL,
                used_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, used_at)
            )
        `);
    } catch (e) {
        console.error('[SERVER-LOOKUP] Table init failed:', e.message);
    }
})();

(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS invite_lookup_usage (
                user_id VARCHAR(20) NOT NULL,
                used_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, used_at)
            )
        `);
    } catch (e) {
        console.error('[INVITE-LOOKUP] Table init failed:', e.message);
    }
})();

app.get('/api/user-lookup/eligibility', async (req, res) => {
    const token = req.cookies?.token;
    let user = null;
    if (token) {
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            console.error('[USER-LOOKUP-ELIGIBILITY] JWT verify failed:', e.message);
        }
    }

    if (!user) {
        return res.json({ eligible: false, isLoggedIn: false });
    }

    let isPremium = false;
    try {
        const premium = await db.query(
            'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
            [user.id]
        );
        isPremium = premium.rows.length > 0;
    } catch (e) {
        console.error('[USER-LOOKUP-ELIGIBILITY] Premium check failed:', e.message);
    }

    if (isPremium) {
        return res.json({ eligible: true, isLoggedIn: true, isPremium: true, remaining: -1 });
    }

    let used = 0;
    try {
        const usage = await db.query(
            'SELECT COUNT(*) AS cnt FROM user_lookup_usage WHERE user_id = $1',
            [user.id]
        );
        used = parseInt(usage.rows[0]?.cnt, 10) || 0;
    } catch (e) {
        console.error('[USER-LOOKUP-ELIGIBILITY] Usage query failed:', e.message);
    }

    const maxFree = 3;
    const remaining = Math.max(0, maxFree - used);

    res.json({
        eligible: remaining > 0,
        isLoggedIn: true,
        isPremium: false,
        remaining: remaining,
        maxFree: maxFree,
        used: used
    });
});

app.get('/api/user-lookup/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid User ID' });
        }

        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {
            isPremium = false;
        }

        if (!isPremium) {
            let used = 0;
            try {
                const usage = await db.query(
                    'SELECT COUNT(*) AS cnt FROM user_lookup_usage WHERE user_id = $1',
                    [user.id]
                );
                used = parseInt(usage.rows[0]?.cnt, 10) || 0;
            } catch (e) {
                console.error('[USER-LOOKUP] Usage check failed:', e.message);
            }
            if (used >= 3) {
                return res.status(403).json({
                    error: 'Free limit reached',
                    remaining: 0,
                    maxFree: 3,
                    used: 3
                });
            }
        }

        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Bot token not configured' });
        }

        let discordUser;
        try {
            discordUser = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status === 404) {
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('[USER-LOOKUP] Discord API error:', err.message);
            return res.status(502).json({ error: 'Failed to fetch user from Discord' });
        }

        if (!isPremium) {
            try {
                await db.query(
                    'INSERT INTO user_lookup_usage (user_id) VALUES ($1)',
                    [user.id]
                );
            } catch (e) {
                console.error('[USER-LOOKUP] Usage insert failed:', e.message);
            }
        }

        let guildMember = null;
        try {
            const raw = await discordFetch(
                `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`,
                BOT_TOKEN, 'Bot '
            );
            if (raw && raw.user) {
                const matchedRoles = (raw.roles || [])
                    .map(r => TEAM_ROLES.find(t => t.id === r))
                    .filter(Boolean)
                    .sort((a, b) => a.priority - b.priority);
                guildMember = {
                    nick: raw.nick || null,
                    role: matchedRoles.length > 0 ? matchedRoles[0] : null,
                    joinedAt: raw.joined_at || null
                };
            }
        } catch (e) {
            guildMember = null;
        }

        res.json({ ...discordUser, _guildMember: guildMember });
    } catch (err) {
        console.error('[USER-LOOKUP] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Server Lookup (Discord Widget API) ---
app.get('/api/server-lookup/eligibility', async (req, res) => {
    const token = req.cookies?.token;
    let user = null;
    if (token) {
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            console.error('[SERVER-LOOKUP-ELIGIBILITY] JWT verify failed:', e.message);
        }
    }

    if (!user) {
        return res.json({ eligible: false, isLoggedIn: false });
    }

    let isPremium = false;
    try {
        const premium = await db.query(
            'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
            [user.id]
        );
        isPremium = premium.rows.length > 0;
    } catch (e) {
        console.error('[SERVER-LOOKUP-ELIGIBILITY] Premium check failed:', e.message);
    }

    if (isPremium) {
        return res.json({ eligible: true, isLoggedIn: true, isPremium: true, remaining: -1 });
    }

    let used = 0;
    try {
        const usage = await db.query(
            'SELECT COUNT(*) AS cnt FROM server_lookup_usage WHERE user_id = $1',
            [user.id]
        );
        used = parseInt(usage.rows[0]?.cnt, 10) || 0;
    } catch (e) {
        console.error('[SERVER-LOOKUP-ELIGIBILITY] Usage query failed:', e.message);
    }

    const maxFree = 3;
    const remaining = Math.max(0, maxFree - used);

    res.json({
        eligible: remaining > 0,
        isLoggedIn: true,
        isPremium: false,
        remaining: remaining,
        maxFree: maxFree,
        used: used
    });
});

app.get('/api/server-lookup/:id', async (req, res) => {
    try {
        const guildId = req.params.id;
        if (!/^\d{17,20}$/.test(guildId)) {
            return res.status(400).json({ error: 'Invalid Server ID' });
        }

        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {
            isPremium = false;
        }

        if (!isPremium) {
            let used = 0;
            try {
                const usage = await db.query(
                    'SELECT COUNT(*) AS cnt FROM server_lookup_usage WHERE user_id = $1',
                    [user.id]
                );
                used = parseInt(usage.rows[0]?.cnt, 10) || 0;
            } catch (e) {
                console.error('[SERVER-LOOKUP] Usage check failed:', e.message);
            }
            if (used >= 3) {
                return res.status(403).json({
                    error: 'Free limit reached',
                    remaining: 0,
                    maxFree: 3,
                    used: 3
                });
            }
        }

        let widget;
        try {
            const response = await axios.get(
                `https://discord.com/api/v10/guilds/${guildId}/widget.json`,
                { timeout: 10000, headers: { 'User-Agent': 'Disc-Tools/1.0' } }
            );
            widget = response.data;
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status === 404) {
                return res.status(404).json({ error: 'Server not found or widget is disabled' });
            }
            if (status === 403) {
                return res.status(404).json({ error: 'Server not found or widget is disabled' });
            }
            console.error('[SERVER-LOOKUP] Widget fetch error:', err.message);
            return res.status(502).json({ error: 'Failed to fetch server widget' });
        }

        // Enrich with guild details (icon, banner, boosts, member count) via the
        // public invite endpoint — the widget API alone has no icon/banner data.
        let guildInfo = null;
        if (widget.instant_invite) {
            const codeMatch = String(widget.instant_invite).match(/(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)([A-Za-z0-9-]+)/);
            const code = codeMatch ? codeMatch[1] : null;
            if (code) {
                try {
                    const response = await axios.get(
                        `https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`,
                        { timeout: 10000, headers: { 'User-Agent': 'Disc-Tools/1.0' } }
                    );
                    const invite = response.data;
                    const guild = invite.guild || {};
                    guildInfo = {
                        icon: guild.icon || null,
                        banner: guild.banner || null,
                        splash: guild.splash || null,
                        description: guild.description || null,
                        features: Array.isArray(guild.features) ? guild.features : [],
                        verification_level: guild.verification_level != null ? guild.verification_level : null,
                        boost_count: guild.premium_subscription_count != null ? guild.premium_subscription_count : null,
                        premium_tier: guild.premium_tier != null ? guild.premium_tier : null,
                        member_count: (invite.profile && invite.profile.member_count != null)
                            ? invite.profile.member_count
                            : (invite.approximate_member_count != null ? invite.approximate_member_count : null),
                        invite_expires_at: invite.expires_at || null
                    };
                } catch (e) {
                    console.error('[SERVER-LOOKUP] Invite enrichment failed:', e.message);
                }
            }
        }

        if (!isPremium) {
            try {
                await db.query(
                    'INSERT INTO server_lookup_usage (user_id) VALUES ($1)',
                    [user.id]
                );
            } catch (e) {
                console.error('[SERVER-LOOKUP] Usage insert failed:', e.message);
            }
        }

        function cdnAsset(type, hash, size) {
            if (!hash) return null;
            const ext = hash.startsWith('a_') ? 'gif' : 'png';
            return `https://cdn.discordapp.com/${type}/${guildId}/${hash}.${ext}?size=${size}`;
        }

        res.json({
            id: widget.id || guildId,
            name: widget.name || 'Unknown',
            instant_invite: widget.instant_invite || null,
            presence_count: widget.presence_count || 0,
            channels: Array.isArray(widget.channels) ? widget.channels : [],
            members: Array.isArray(widget.members) ? widget.members : [],
            widget_image: `/api/server-lookup/${guildId}/image`,
            widget_url: `https://discord.com/api/v10/guilds/${guildId}/widget.json`,
            icon_url: guildInfo ? cdnAsset('icons', guildInfo.icon, 256) : null,
            banner_url: guildInfo ? cdnAsset('banners', guildInfo.banner, 600) : null,
            splash_url: guildInfo ? cdnAsset('splashes', guildInfo.splash, 600) : null,
            description: guildInfo ? guildInfo.description : null,
            features: guildInfo ? guildInfo.features : [],
            verification_level: guildInfo ? guildInfo.verification_level : null,
            boost_count: guildInfo ? guildInfo.boost_count : null,
            premium_tier: guildInfo ? guildInfo.premium_tier : null,
            member_count: guildInfo ? guildInfo.member_count : null,
            invite_expires_at: guildInfo ? guildInfo.invite_expires_at : null
        });
    } catch (err) {
        console.error('[SERVER-LOOKUP] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/server-lookup/:id/image', async (req, res) => {
    try {
        const guildId = req.params.id;
        if (!/^\d{17,20}$/.test(guildId)) {
            return res.status(400).json({ error: 'Invalid Server ID' });
        }
        const response = await axios.get(
            `https://discord.com/api/v10/guilds/${guildId}/widget.png?style=banner1&size=1024`,
            { timeout: 10000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Disc-Tools/1.0' } }
        );
        res.set('Content-Type', response.headers['content-type'] || 'image/png');
        res.set('Cache-Control', 'public, max-age=300');
        res.send(Buffer.from(response.data));
    } catch (err) {
        const status = err.response ? err.response.status : 502;
        if (status === 404 || status === 403) {
            return res.status(404).json({ error: 'Server not found or widget is disabled' });
        }
        console.error('[SERVER-LOOKUP-IMAGE] Widget image error:', err.message);
        res.status(502).json({ error: 'Failed to fetch server widget image' });
    }
});

// --- Invite Lookup ---
app.get('/api/invite-lookup/eligibility', async (req, res) => {
    const token = req.cookies?.token;
    let user = null;
    if (token) {
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            console.error('[INVITE-LOOKUP-ELIGIBILITY] JWT verify failed:', e.message);
        }
    }

    if (!user) {
        return res.json({ eligible: false, isLoggedIn: false });
    }

    let isPremium = false;
    try {
        const premium = await db.query(
            'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
            [user.id]
        );
        isPremium = premium.rows.length > 0;
    } catch (e) {
        console.error('[INVITE-LOOKUP-ELIGIBILITY] Premium check failed:', e.message);
    }

    if (isPremium) {
        return res.json({ eligible: true, isLoggedIn: true, isPremium: true, remaining: -1 });
    }

    let used = 0;
    try {
        const usage = await db.query(
            'SELECT COUNT(*) AS cnt FROM invite_lookup_usage WHERE user_id = $1',
            [user.id]
        );
        used = parseInt(usage.rows[0]?.cnt, 10) || 0;
    } catch (e) {
        console.error('[INVITE-LOOKUP-ELIGIBILITY] Usage query failed:', e.message);
    }

    const maxFree = 3;
    const remaining = Math.max(0, maxFree - used);

    res.json({
        eligible: remaining > 0,
        isLoggedIn: true,
        isPremium: false,
        remaining: remaining,
        maxFree: maxFree,
        used: used
    });
});

app.get('/api/invite-lookup/:code', async (req, res) => {
    try {
        const code = req.params.code;
        if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) {
            return res.status(400).json({ error: 'Invalid invite code' });
        }

        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {
            isPremium = false;
        }

        if (!isPremium) {
            let used = 0;
            try {
                const usage = await db.query(
                    'SELECT COUNT(*) AS cnt FROM invite_lookup_usage WHERE user_id = $1',
                    [user.id]
                );
                used = parseInt(usage.rows[0]?.cnt, 10) || 0;
            } catch (e) {
                console.error('[INVITE-LOOKUP] Usage check failed:', e.message);
            }
            if (used >= 3) {
                return res.status(403).json({
                    error: 'Free limit reached',
                    remaining: 0,
                    maxFree: 3,
                    used: 3
                });
            }
        }

        let invite;
        try {
            const response = await axios.get(
                `https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true&with_expiration=true`,
                { timeout: 10000, headers: { 'User-Agent': 'Disc-Tools/1.0' } }
            );
            invite = response.data;
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status === 404) {
                return res.status(404).json({ error: 'Invite not found or expired' });
            }
            console.error('[INVITE-LOOKUP] Invite fetch error:', err.message);
            return res.status(502).json({ error: 'Failed to fetch invite' });
        }

        if (!isPremium) {
            try {
                await db.query(
                    'INSERT INTO invite_lookup_usage (user_id) VALUES ($1)',
                    [user.id]
                );
            } catch (e) {
                console.error('[INVITE-LOOKUP] Usage insert failed:', e.message);
            }
        }

        const guild = invite.guild || {};
        const inviter = invite.inviter || null;
        const channel = invite.channel || null;

        function cdn(type, hash, size) {
            if (!hash) return null;
            const ext = hash.startsWith('a_') ? 'gif' : 'png';
            return `https://cdn.discordapp.com/${type}/${type === 'avatars' ? inviter.id : guild.id}/${hash}.${ext}?size=${size}`;
        }

        res.json({
            code: invite.code || code,
            type: invite.type != null ? invite.type : null,
            expires_at: invite.expires_at || null,
            liveliness: invite.liveliness != null ? invite.liveliness : null,
            guild: {
                id: guild.id || invite.guild_id || null,
                name: guild.name || null,
                icon_url: guild.icon ? cdn('icons', guild.icon, 256) : null,
                banner_url: guild.banner ? cdn('banners', guild.banner, 600) : null,
                splash_url: guild.splash ? cdn('splashes', guild.splash, 600) : null,
                description: guild.description || null,
                features: Array.isArray(guild.features) ? guild.features : [],
                verification_level: guild.verification_level != null ? guild.verification_level : null,
                boost_count: guild.premium_subscription_count != null ? guild.premium_subscription_count : null,
                premium_tier: guild.premium_tier != null ? guild.premium_tier : null,
                vanity_url_code: guild.vanity_url_code || null,
                nsfw: !!guild.nsfw
            },
            member_count: invite.approximate_member_count != null ? invite.approximate_member_count : null,
            presence_count: invite.approximate_presence_count != null ? invite.approximate_presence_count : null,
            inviter: inviter ? {
                id: inviter.id || null,
                username: inviter.username || null,
                global_name: inviter.global_name || null,
                avatar_url: inviter.avatar ? cdn('avatars', inviter.avatar, 128) : null,
                bot: !!inviter.bot
            } : null,
            channel: channel ? {
                id: channel.id || null,
                name: channel.name || null,
                type: channel.type != null ? channel.type : null
            } : null,
            target_type: invite.target_type != null ? invite.target_type : null,
            target_user: invite.target_user ? { id: invite.target_user.id, username: invite.target_user.username } : null
        });
    } catch (err) {
        console.error('[INVITE-LOOKUP] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Alt Account Lookup (Premium only) ---
app.get('/api/alt-lookup/eligibility', async (req, res) => {
    const token = req.cookies?.token;
    let user = null;
    if (token) {
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            console.error('[ALT-LOOKUP-ELIGIBILITY] JWT verify failed:', e.message);
        }
    }

    if (!user) {
        return res.json({ eligible: false, isLoggedIn: false, isPremium: false });
    }

    let isPremium = false;
    try {
        const premium = await db.query(
            'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
            [user.id]
        );
        isPremium = premium.rows.length > 0;
    } catch (e) {
        console.error('[ALT-LOOKUP-ELIGIBILITY] Premium check failed:', e.message);
    }

    res.json({ eligible: isPremium, isLoggedIn: true, isPremium: isPremium });
});

app.get('/api/alt-lookup/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid User ID' });
        }

        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {
            isPremium = false;
        }

        if (!isPremium) {
            return res.status(403).json({ error: 'Alt Account Lookup is a Premium feature' });
        }

        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Bot token not configured' });
        }

        let discordUser;
        try {
            discordUser = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status === 404) {
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('[ALT-LOOKUP] Discord API error:', err.message);
            return res.status(502).json({ error: 'Failed to fetch user from Discord' });
        }

        const data = Object.assign({}, discordUser);

        const at = req.cookies.discord_at;
        if (at) {
            try {
                const sessToken = req.cookies.token;
                if (sessToken) {
                    const decoded = jwt.verify(sessToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
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

        let guildMember = null;
        try {
            const raw = await discordFetch(
                `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`,
                BOT_TOKEN, 'Bot '
            );
            if (raw && raw.user) {
                const matchedRoles = (raw.roles || [])
                    .map(r => TEAM_ROLES.find(t => t.id === r))
                    .filter(Boolean)
                    .sort((a, b) => a.priority - b.priority);
                guildMember = {
                    nick: raw.nick || null,
                    role: matchedRoles.length > 0 ? matchedRoles[0] : null,
                    joinedAt: raw.joined_at || null
                };
            }
        } catch (e) {
            guildMember = null;
        }

        // --- IP-hash linking (like bot /alt) ---
        let links = { ipHashes: 0, linkedAccounts: [], totalLinked: 0, truncated: false };
        try {
            const ipResult = await db.query(
                'SELECT DISTINCT ip_hash FROM verified_users WHERE user_id = $1',
                [userId]
            );
            const ipHashes = ipResult.rows.map(r => r.ip_hash);

            const relResult = await db.query(
                `SELECT DISTINCT CASE WHEN user_id_a = $1 THEN user_id_b ELSE user_id_a END AS linked_id
                 FROM alt_relations WHERE $1 IN (user_id_a, user_id_b)`,
                [userId]
            );

            const hashCounts = {};
            if (ipHashes.length > 0) {
                const hashUsers = await db.query(
                    'SELECT DISTINCT user_id, ip_hash FROM verified_users WHERE ip_hash = ANY($1)',
                    [ipHashes]
                );
                hashUsers.rows.forEach(row => {
                    hashCounts[row.user_id] = (hashCounts[row.user_id] || 0) + 1;
                });
            }

            const linkedIds = new Set(relResult.rows.map(r => r.linked_id));
            Object.keys(hashCounts).forEach(uid => linkedIds.add(uid));

            const others = Array.from(linkedIds).filter(uid => uid !== userId).sort();

            for (const uid of others) {
                await db.query(
                    'INSERT INTO alt_relations (user_id_a, user_id_b) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [userId, uid]
                ).catch(err => console.error('[ALT-LOOKUP] persist relation failed:', err.message));
            }

            const ACCOUNT_FETCH_CAP = 20;
            const truncated = others.length > ACCOUNT_FETCH_CAP;
            const accounts = [];

            for (const uid of others.slice(0, ACCOUNT_FETCH_CAP)) {
                let info = { userId: uid, username: null, avatar: null, globalName: null, bot: false };
                if (BOT_TOKEN) {
                    try {
                        const u = await discordFetch(`https://discord.com/api/v10/users/${uid}`, BOT_TOKEN, 'Bot ');
                        info = {
                            userId: u.id,
                            username: u.username || null,
                            avatar: u.avatar || null,
                            globalName: u.global_name || null,
                            bot: !!u.bot
                        };
                    } catch (e) {
                        info = { userId: uid, username: null, avatar: null, globalName: null, bot: false };
                    }
                }
                info.sharedHashes = hashCounts[uid] || 0;
                accounts.push(info);
            }

            links = { ipHashes: ipHashes.length, linkedAccounts: accounts, totalLinked: others.length, truncated: truncated };
        } catch (e) {
            console.error('[ALT-LOOKUP] IP-linking failed:', e.message);
        }

        res.json({ ...data, _guildMember: guildMember, links: links });
    } catch (err) {
        console.error('[ALT-LOOKUP] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Account Checker score (free with limits like User Lookup) ---
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS fake_lookup_usage (
                user_id VARCHAR(20) NOT NULL,
                used_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (user_id, used_at)
            )
        `);
    } catch (e) {
        console.error('[FAKE-LOOKUP] Table init failed:', e.message);
    }
})();

app.get('/api/fake-lookup/eligibility', async (req, res) => {
    const token = req.cookies?.token;
    let user = null;
    if (token) {
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            console.error('[FAKE-LOOKUP-ELIGIBILITY] JWT verify failed:', e.message);
        }
    }

    if (!user) {
        return res.json({ eligible: false, isLoggedIn: false });
    }

    let isPremium = false;
    try {
        const premium = await db.query(
            'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
            [user.id]
        );
        isPremium = premium.rows.length > 0;
    } catch (e) {
        console.error('[FAKE-LOOKUP-ELIGIBILITY] Premium check failed:', e.message);
    }

    if (isPremium) {
        return res.json({ eligible: true, isLoggedIn: true, isPremium: true, remaining: -1 });
    }

    let used = 0;
    try {
        const usage = await db.query(
            'SELECT COUNT(*) AS cnt FROM fake_lookup_usage WHERE user_id = $1',
            [user.id]
        );
        used = parseInt(usage.rows[0]?.cnt, 10) || 0;
    } catch (e) {
        console.error('[FAKE-LOOKUP-ELIGIBILITY] Usage query failed:', e.message);
    }

    const maxFree = 3;
    const remaining = Math.max(0, maxFree - used);

    res.json({
        eligible: remaining > 0,
        isLoggedIn: true,
        isPremium: false,
        remaining: remaining,
        maxFree: maxFree,
        used: used
    });
});

app.get('/api/fake-lookup/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid User ID' });
        }

        const token = req.cookies?.token;
        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        let isPremium = false;
        try {
            const premium = await db.query(
                'SELECT 1 FROM premium_users WHERE user_id = $1 AND active = true',
                [user.id]
            );
            isPremium = premium.rows.length > 0;
        } catch (e) {
            isPremium = false;
        }

        if (!isPremium) {
            let used = 0;
            try {
                const usage = await db.query(
                    'SELECT COUNT(*) AS cnt FROM fake_lookup_usage WHERE user_id = $1',
                    [user.id]
                );
                used = parseInt(usage.rows[0]?.cnt, 10) || 0;
            } catch (e) {
                console.error('[FAKE-LOOKUP] Usage check failed:', e.message);
            }
            if (used >= 3) {
                return res.status(403).json({
                    error: 'Free limit reached',
                    remaining: 0,
                    maxFree: 3,
                    used: 3
                });
            }
        }

        const ipResult = await db.query(
            'SELECT DISTINCT ip_hash FROM verified_users WHERE user_id = $1',
            [userId]
        );
        const ipHashes = ipResult.rows.map(r => r.ip_hash);

        const relResult = await db.query(
            `SELECT DISTINCT CASE WHEN user_id_a = $1 THEN user_id_b ELSE user_id_a END AS linked_id
             FROM alt_relations WHERE $1 IN (user_id_a, user_id_b)`,
            [userId]
        );

        const hashCounts = {};
        if (ipHashes.length > 0) {
            const hashUsers = await db.query(
                'SELECT DISTINCT user_id, ip_hash FROM verified_users WHERE ip_hash = ANY($1)',
                [ipHashes]
            );
            hashUsers.rows.forEach(row => {
                hashCounts[row.user_id] = (hashCounts[row.user_id] || 0) + 1;
            });
        }

        const linkedIds = new Set(relResult.rows.map(r => r.linked_id));
        Object.keys(hashCounts).forEach(uid => linkedIds.add(uid));

        const others = Array.from(linkedIds).filter(uid => uid !== userId).sort();

        for (const uid of others) {
            await db.query(
                'INSERT INTO alt_relations (user_id_a, user_id_b) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [userId, uid]
            ).catch(err => console.error('[FAKE-LOOKUP] persist relation failed:', err.message));
        }

        if (!isPremium) {
            try {
                await db.query(
                    'INSERT INTO fake_lookup_usage (user_id) VALUES ($1)',
                    [user.id]
                );
            } catch (e) {
                console.error('[FAKE-LOOKUP] Usage insert failed:', e.message);
            }
        }

        let target = null;
        try {
            if (BOT_TOKEN) {
                const t = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
                target = {
                    id: t.id,
                    username: t.username,
                    globalName: t.global_name || null,
                    avatar: t.avatar || null,
                    bot: !!t.bot
                };
            }
        } catch (e) {
            target = null;
        }

        const ACCOUNT_FETCH_CAP = 20;
        const truncated = others.length > ACCOUNT_FETCH_CAP;
        const accounts = [];
        const toFetch = others.slice(0, ACCOUNT_FETCH_CAP);

        for (const uid of toFetch) {
            let info = { userId: uid, username: null, avatar: null, globalName: null, bot: false };
            if (BOT_TOKEN) {
                try {
                    const u = await discordFetch(`https://discord.com/api/v10/users/${uid}`, BOT_TOKEN, 'Bot ');
                    info = {
                        userId: u.id,
                        username: u.username || null,
                        avatar: u.avatar || null,
                        globalName: u.global_name || null,
                        bot: !!u.bot
                    };
                } catch (e) {
                    info = { userId: uid, username: null, avatar: null, globalName: null, bot: false };
                }
            }
            info.sharedHashes = hashCounts[uid] || 0;
            accounts.push(info);
        }

        res.json({
            target: target,
            ipHashes: ipHashes.length,
            linkedAccounts: accounts,
            totalLinked: others.length,
            truncated: truncated
        });
    } catch (err) {
        console.error('[FAKE-LOOKUP] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Emoji Stealer (Free - no login required) ---
app.get('/api/emoji-stealer/eligibility', async (req, res) => {
    res.json({ eligible: true, isLoggedIn: true, isPremium: true });
});

app.get('/api/emoji-stealer/:input', async (req, res) => {
    try {
        const raw = decodeURIComponent(req.params.input || '').trim();

        const markupMatch = raw.match(/^<(a)?:(\w+):(\d{17,20})>$/);
        const legacyMatch = raw.match(/^:(\w+):(\d{17,20})$/);
        const plainMatch = raw.match(/^\d{17,20}$/);

        if (!markupMatch && !legacyMatch && !plainMatch) {
            return res.status(400).json({ error: 'Invalid emoji or sticker' });
        }

        // Full markup pasted → emoji info comes straight from the markup, no
        // Discord API needed (works for emojis from any server).
        if (markupMatch || legacyMatch) {
            const animated = markupMatch ? markupMatch[1] === 'a' : false;
            const name = markupMatch ? markupMatch[2] : legacyMatch[1];
            const id = markupMatch ? markupMatch[3] : legacyMatch[2];
            const ext = animated ? 'gif' : 'png';
            const sizes = [128, 256, 512, 1024];
            return res.json({
                type: 'emoji',
                id: id,
                name: name,
                animated: animated,
                previewUrl: `https://cdn.discordapp.com/emojis/${id}.${ext}?size=160`,
                markup: (animated ? '<a:' : '<:') + name + ':' + id + '>',
                formats: sizes.map(size => ({
                    format: ext.toUpperCase(),
                    size: size,
                    url: `https://cdn.discordapp.com/emojis/${id}.${ext}?size=${size}`
                }))
            });
        }

        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Bot token not configured' });
        }

        // Plain ID → try sticker API first (works globally), then fall back to
        // CDN probing for emojis (name can't be resolved without the guild).
        const assetId = plainMatch[0];
        let sticker = null;
        try {
            sticker = await discordFetch(`https://discord.com/api/v10/stickers/${assetId}`, BOT_TOKEN, 'Bot ');
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status !== 404) {
                console.error('[EMOJI-STEALER] Sticker API error:', err.message);
            }
        }

        if (!sticker) {
            const probe = async (ext) => {
                try {
                    const r = await axios.head(
                        `https://cdn.discordapp.com/emojis/${assetId}.${ext}?size=32`,
                        { timeout: 8000, headers: { 'User-Agent': 'Disc-Tools/1.0' } }
                    );
                    return r.status >= 200 && r.status < 300;
                } catch (e) {
                    return false;
                }
            };
            const gifOk = await probe('gif');
            const pngOk = await probe('png');

            if (gifOk || pngOk) {
                const animated = gifOk;
                const ext = animated ? 'gif' : 'png';
                const sizes = [128, 256, 512, 1024];
                return res.json({
                    type: 'emoji',
                    id: assetId,
                    name: null,
                    animated: animated,
                    previewUrl: `https://cdn.discordapp.com/emojis/${assetId}.${ext}?size=160`,
                    markup: null,
                    formats: sizes.map(size => ({
                        format: ext.toUpperCase(),
                        size: size,
                        url: `https://cdn.discordapp.com/emojis/${assetId}.${ext}?size=${size}`
                    }))
                });
            }

            return res.status(404).json({
                error: 'Emoji or sticker not found',
                hint: 'Emoji IDs can\'t be resolved alone — paste the full emoji instead, e.g. <:name:id> or <a:name:id>.'
            });
        }

        const formatType = sticker.format_type != null ? sticker.format_type : 1;
        const animated = formatType === 2 || formatType === 4;
        if (formatType === 3) {
            return res.status(422).json({ error: 'Lottie stickers cannot be downloaded as images' });
        }
        const ext = formatType === 4 ? 'gif' : 'png';
        const asset = sticker.asset || sticker.id;
        const url = `https://cdn.discordapp.com/stickers/${sticker.id}/${asset}.${ext}`;

        return res.json({
            type: 'sticker',
            id: sticker.id,
            name: sticker.name,
            animated: animated,
            description: sticker.description || null,
            tags: sticker.tags || null,
            guildId: sticker.guild_id || null,
            formatType: formatType,
            previewUrl: url,
            formats: [{ format: ext.toUpperCase(), size: null, url: url }]
        });
    } catch (err) {
        console.error('[EMOJI-STEALER] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Avatar CDN (free, no login required) ---
app.get('/api/avatar-cdn/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Bot token not configured' });
        }

        let discordUser;
        try {
            discordUser = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status === 404) {
                return res.status(404).json({ error: 'User not found' });
            }
            console.error('[AVATAR-CDN] Discord API error:', err.message);
            return res.status(502).json({ error: 'Failed to fetch user from Discord' });
        }

        const AVATAR_SIZES = [32, 64, 128, 256, 512, 1024, 2048, 4096];

        let formats = [];
        let previewUrl;
        let animated = false;
        let hasAvatar = !!discordUser.avatar;

        if (hasAvatar) {
            animated = discordUser.avatar.startsWith('a_');
            const exts = animated ? ['gif', 'webp', 'png'] : ['png', 'webp', 'jpg'];
            AVATAR_SIZES.forEach(size => {
                exts.forEach(ext => {
                    formats.push({
                        format: ext.toUpperCase(),
                        size: size,
                        url: `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}?size=${size}`
                    });
                });
            });
            previewUrl = `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${animated ? 'gif' : 'png'}?size=256`;
        } else {
            // No custom avatar → Discord default avatars (0-5)
            let idx = 0;
            try {
                idx = Number((BigInt(discordUser.id) >> 22n) % 6n);
                if (isNaN(idx) || idx < 0) idx = 0;
            } catch (e) {}
            AVATAR_SIZES.forEach(size => {
                formats.push({
                    format: 'PNG',
                    size: size,
                    url: `https://cdn.discordapp.com/embed/avatars/${idx}.png?size=${size}`
                });
            });
            previewUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png?size=256`;
        }

        res.json({
            type: 'avatar',
            id: discordUser.id,
            username: discordUser.username,
            globalName: discordUser.global_name || null,
            animated: animated,
            hasAvatar: hasAvatar,
            previewUrl: previewUrl,
            formats: formats
        });
    } catch (err) {
        console.error('[AVATAR-CDN] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Collectibles Inspector (free, no login required) ---
app.get('/api/collectibles/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        if (!/^\d{17,20}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }
        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Bot token not configured' });
        }

        let u;
        try {
            u = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
        } catch (err) {
            const status = err.response ? err.response.status : 502;
            if (status === 404) return res.status(404).json({ error: 'User not found' });
            console.error('[COLLECTIBLES] Discord API error:', err.message);
            return res.status(502).json({ error: 'Failed to fetch user from Discord' });
        }

        const SIZES_AVATAR = [32, 64, 128, 256, 512, 1024, 2048, 4096];
        const SIZES_BANNER = [128, 256, 480, 600, 1024, 2048, 4096];
        const SIZES_DECORATION = [64, 128, 256, 512];

        // --- Avatar ---
        let avatar = null;
        if (u.avatar) {
            const animated = u.avatar.startsWith('a_');
            const exts = animated ? ['gif', 'webp', 'png'] : ['png', 'webp', 'jpg'];
            const formats = [];
            SIZES_AVATAR.forEach(size => exts.forEach(ext => formats.push({
                format: ext.toUpperCase(), size, url: `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${ext}?size=${size}`
            })));
            avatar = {
                hash: u.avatar,
                animated,
                hasAvatar: true,
                previewUrl: `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${animated ? 'gif' : 'png'}?size=256`,
                formats
            };
        } else {
            let idx = 0;
            try { idx = Number((BigInt(u.id) >> 22n) % 6n); if (isNaN(idx) || idx < 0) idx = 0; } catch(e){}
            const formats = SIZES_AVATAR.map(size => ({
                format: 'PNG', size, url: `https://cdn.discordapp.com/embed/avatars/${idx}.png`
            }));
            // embed avatars actually don't support size param historically, but we keep it simple
            avatar = {
                hash: null,
                animated: false,
                hasAvatar: false,
                defaultIndex: idx,
                previewUrl: `https://cdn.discordapp.com/embed/avatars/${idx}.png`,
                formats
            };
        }

        // --- Banner ---
        let banner = null;
        if (u.banner) {
            const animated = u.banner.startsWith('a_');
            const exts = animated ? ['gif', 'webp', 'png'] : ['png', 'webp', 'jpg'];
            const formats = [];
            SIZES_BANNER.forEach(size => exts.forEach(ext => formats.push({
                format: ext.toUpperCase(), size, url: `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${ext}?size=${size}`
            })));
            banner = {
                hash: u.banner,
                animated,
                hasBanner: true,
                color: u.banner_color || null,
                accentColor: u.accent_color ?? null,
                accentColorHex: u.accent_color != null ? '#' + u.accent_color.toString(16).padStart(6, '0') : null,
                previewUrl: `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${animated ? 'gif' : 'png'}?size=600`,
                formats
            };
        } else {
            banner = {
                hash: null,
                animated: false,
                hasBanner: false,
                color: u.banner_color || null,
                accentColor: u.accent_color ?? null,
                accentColorHex: u.accent_color != null ? '#' + u.accent_color.toString(16).padStart(6, '0') : (u.banner_color || null),
                previewUrl: null,
                formats: []
            };
        }

        // --- Avatar Decoration ---
        let avatarDecoration = null;
        if (u.avatar_decoration_data && u.avatar_decoration_data.asset) {
            const asset = u.avatar_decoration_data.asset;
            const skuId = u.avatar_decoration_data.sku_id || null;
            const expiresAt = u.avatar_decoration_data.expires_at || null;
            const cdnBase = `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png`;
            const formats = SIZES_DECORATION.map(size => ({
                format: 'PNG', size, url: `https://cdn.discordapp.com/avatar-decoration-presets/${asset}.png?size=${size}`
            }));
            // also provide without size
            formats.unshift({ format: 'PNG', size: 256, url: cdnBase + '?size=256' });
            avatarDecoration = {
                asset,
                skuId,
                expiresAt,
                previewUrl: cdnBase + '?size=256',
                cdnBase,
                formats: [...new Map(formats.map(f => [f.size, f])).values()]
            };
        }

        // --- Nameplate / Collectibles ---
        let nameplate = null;
        let collectibles = u.collectibles || null;
        if (collectibles && collectibles.nameplate) {
            const np = collectibles.nameplate;
            const asset = np.asset || null; // e.g. "nameplates/spirit_wolf/1538991722535714867/"
            let staticUrl = null;
            let animatedUrl = null;
            if (asset) {
                const clean = asset.endsWith('/') ? asset : asset + '/';
                staticUrl = `https://cdn.discordapp.com/assets/collectibles/${clean}static.png`;
                animatedUrl = `https://cdn.discordapp.com/assets/collectibles/${clean}asset.webm`;
            }
            nameplate = {
                skuId: np.sku_id || null,
                asset,
                label: np.label || null,
                palette: np.palette || null,
                staticUrl,
                animatedUrl
            };
        }

        // --- Clan / Primary Guild ---
        let clan = null;
        const clanRaw = u.clan || u.primary_guild || null;
        if (clanRaw && clanRaw.identity_guild_id) {
            const gid = clanRaw.identity_guild_id;
            const tag = clanRaw.tag || null;
            const badge = clanRaw.badge || null;
            clan = {
                guildId: gid,
                tag,
                badge,
                badgeUrl: badge ? `https://cdn.discordapp.com/clan-badges/${gid}/${badge}.png` : null,
                enabled: !!clanRaw.identity_enabled
            };
        }

        // --- Display Name Styles ---
        let displayNameStyles = null;
        if (u.display_name_styles) {
            displayNameStyles = {
                fontId: u.display_name_styles.font_id ?? null,
                effectId: u.display_name_styles.effect_id ?? null,
                colors: u.display_name_styles.colors || []
            };
        }

        res.json({
            id: u.id,
            username: u.username,
            globalName: u.global_name || null,
            displayName: u.global_name || u.username,
            discriminator: u.discriminator,
            avatar,
            banner,
            avatarDecoration,
            nameplate,
            collectibles,
            clan,
            displayNameStyles,
            accentColor: u.accent_color ?? null,
            bannerColor: u.banner_color || null
        });
    } catch (err) {
        console.error('[COLLECTIBLES] Error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Alias for backwards-compat / pretty slug
app.get('/api/profile-inspector/:id', async (req, res) => {
    return res.redirect(307, '/api/collectibles/' + req.params.id);
});

// --- Color Picker history (last 5 colors per logged-in user) ---
(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS color_picker_history (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(20) NOT NULL,
                color VARCHAR(7) NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (user_id, color)
            )
        `);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_cp_history_user ON color_picker_history(user_id, updated_at DESC)`);
    } catch (e) {
        console.error('[COLOR-PICKER] Table init failed:', e.message);
    }
})();

function getColorPickerUser(req) {
    const token = req.cookies?.token;
    if (!token) return null;
    try {
        return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (e) {
        return null;
    }
}

app.get('/api/color-picker/history', async (req, res) => {
    try {
        const user = getColorPickerUser(req);
        if (!user) {
            return res.json({ colors: [], isLoggedIn: false });
        }
        const result = await db.query(
            'SELECT color FROM color_picker_history WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5',
            [user.id]
        );
        res.json({ colors: result.rows.map(r => r.color), isLoggedIn: true });
    } catch (err) {
        console.error('[COLOR-PICKER-HISTORY] Fetch failed:', err.message);
        res.json({ colors: [], isLoggedIn: false });
    }
});

app.post('/api/color-picker/history', async (req, res) => {
    try {
        const user = getColorPickerUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const color = String(req.body?.color || '').trim().toUpperCase();
        if (!/^#[0-9A-F]{6}$/.test(color)) {
            return res.status(400).json({ error: 'Invalid color' });
        }

        await db.query(
            `INSERT INTO color_picker_history (user_id, color) VALUES ($1, $2)
             ON CONFLICT (user_id, color) DO UPDATE SET updated_at = NOW()`,
            [user.id, color]
        );
        await db.query(
            `DELETE FROM color_picker_history a USING (
                SELECT id FROM color_picker_history WHERE user_id = $1 ORDER BY updated_at DESC OFFSET 5
             ) b WHERE a.id = b.id`,
            [user.id]
        );

        const result = await db.query(
            'SELECT color FROM color_picker_history WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5',
            [user.id]
        );
        res.json({ colors: result.rows.map(r => r.color), isLoggedIn: true });
    } catch (err) {
        console.error('[COLOR-PICKER-HISTORY] Save failed:', err.message);
        res.status(500).json({ error: 'Failed to save color' });
    }
});

app.use((err, req, res, next) => {    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ error: 'CORS policy blocked this request' });
    }
    console.error(`[ERROR] ${err.stack}`);
    logError('Internal Server Error', { path: req.path, method: req.method, error: err.message });
    res.status(500).json({ error: 'Internal Server Error' });
});

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT]', err);
    logError('Uncaught Exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
    logError('Unhandled Rejection', { error: typeof reason === 'object' ? reason.message : String(reason) });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
    console.log(`✅ API running on ${HOST}:${PORT}`);
});
