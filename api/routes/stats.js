const express = require('express');
const router = express.Router();
const db = require('../db');
const os = require('os');
const { execSync } = require('child_process');

const authMiddleware = require('../middleware/auth');

// --- Track Tool Usage ---
router.post('/stats/track', async (req, res) => {
    let { tool } = req.body;

    if (typeof tool !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
    }

    tool = tool.substring(0, 50).replace(/[^a-z0-9-]/gi, '');

    try {
        await db.query(
            `INSERT INTO stats (tool_id, hits, last_update) VALUES ($1, 1, NOW())
             ON CONFLICT (tool_id) DO UPDATE SET hits = stats.hits + 1, last_update = NOW()`,
            [tool]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[STATS] Track failed:', err.message);
        res.status(500).json({ error: 'Failed to track stats' });
    }
});

// --- Get Popular Tools ---
router.get('/stats/popular', async (req, res) => {
    try {
        const result = await db.query('SELECT tool_id as id, hits as count FROM stats ORDER BY hits DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('[STATS] Popular failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// --- Get System Stats (Admin only) ---
router.get('/stats/system', authMiddleware, async (req, res) => {
    try {
        // Check if user is admin
        const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
        const GUILD_ID = process.env.GUILD_ID;
        const { discordFetch, apiCache } = require('../utils/discord');

        const ADMIN_ROLES = [
            '1503064097040629891', // Founder
            '1503064197704061109', // Co-Founder
            '1503064289915965621', // Sr. Admin
            '1503064343837937795'  // Admin
        ];

        let isAdmin = false;
        if (BOT_TOKEN && GUILD_ID) {
            try {
                const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${req.user.id}`, BOT_TOKEN, 'Bot ');
                const roles = member.roles || [];
                isAdmin = roles.some(r => ADMIN_ROLES.includes(r));
            } catch (e) {}
        }

        if (!isAdmin) {
            return res.status(403).json({ error: 'Not an admin' });
        }

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        let disk = { total: '0G', used: '0G', percent: 0 };
        try {
            const df = execSync("df -h / | tail -1").toString().trim().split(/\s+/);
            disk = { total: df[1], used: df[2], percent: parseInt(df[4].replace('%', '')) || 0 };
        } catch (e) {}

        let services = { nginx: 'down', api: 'up', bot: 'unknown', postgresql: 'unknown' };
        try {
            const systemctl = execSync("systemctl is-active nginx").toString().trim();
            services.nginx = systemctl === 'active' ? 'up' : 'down';
        } catch (e) {}
        try {
            const pm2 = execSync("pm2 jlist").toString();
            const pm2Data = JSON.parse(pm2);
            const botProc = pm2Data.find(p => p.name === 'disc-tools-bot');
            services.bot = (botProc && botProc.pm2_env.status === 'online') ? 'up' : 'down';
        } catch (e) {}

        res.json({
            cpu: os.loadavg()[0].toFixed(2),
            ram: { total: totalMem, used: usedMem, percent: Math.round((usedMem/totalMem)*100) },
            disk,
            uptime: os.uptime(),
            services
        });
    } catch (err) {
        console.error('[SYSTEM STATS] Failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch system stats' });
    }
});

// --- Track Page View ---
router.post('/track/view', async (req, res) => {
    try {
        await db.query(
            `INSERT INTO page_views (date, count) VALUES (CURRENT_DATE, 1)
             ON CONFLICT (date) DO UPDATE SET count = page_views.count + 1`
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[STATS] Page view track failed:', err.message);
        res.status(500).json({ error: 'Failed to track page view' });
    }
});

// --- Get Page Views Today ---
router.get('/stats/pageviews', async (req, res) => {
    try {
        const result = await db.query(
            'SELECT count FROM page_views WHERE date = CURRENT_DATE'
        );
        const count = result.rows.length > 0 ? result.rows[0].count : 0;
        res.json({ count });
    } catch (err) {
        console.error('[STATS] Page views fetch failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch page views' });
    }
});

module.exports = router;
