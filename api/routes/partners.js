const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';

const { discordFetch } = require('../utils/discord');

const authMiddleware = require('../middleware/auth');

const PARTNER_ROLE_ID = '1508659586339704883';

(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS partner_members (
                partner_id VARCHAR(50) NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
                user_id VARCHAR(20) NOT NULL,
                added_at TIMESTAMP DEFAULT NOW(),
                PRIMARY KEY (partner_id, user_id)
            )
        `);
    } catch (e) {
        console.error('[PARTNERS] partner_members table init failed:', e.message);
    }
})();

async function assignPartnerRole(userId) {
    const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${PARTNER_ROLE_ID}`;
    const headers = {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json'
    };
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, { method: 'PUT', headers });
        if (res.status === 204) return;
        if (res.status === 429) {
            const data = await res.json().catch(() => ({}));
            await new Promise(r => setTimeout(r, (data.retry_after || 1) * 1000));
            continue;
        }
        console.warn(`[PARTNERS] Role assign failed (${res.status})`);
        return;
    }
}

async function sendMemberDM(userId, embed) {
    try {
        if (!BOT_TOKEN) return;
        const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ recipient_id: userId })
        });
        if (!dmRes.ok) throw new Error(`DM channel creation failed (${dmRes.status})`);
        const dmChannel = await dmRes.json();
        await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (e) {
        console.warn('[PARTNERS] Failed to send DM to', userId, ':', e.message);
    }
}

async function syncPartnerMembers(partnerId, partnerName, userIds, oldUserIds) {
    if (!Array.isArray(userIds)) return;

    const newSet = new Set(userIds.filter(Boolean));
    const oldSet = new Set((oldUserIds || []).filter(Boolean));

    const added = [...newSet].filter(u => !oldSet.has(u));
    const removed = [...oldSet].filter(u => !newSet.has(u));

    for (const uid of removed) {
        await db.query('DELETE FROM partner_members WHERE partner_id = $1 AND user_id = $2', [partnerId, uid]);
        sendMemberDM(uid, {
            color: 0xE74C3C,
            title: '👋 Removed from Partnership',
            description: `You have been removed from the partnership **${partnerName}** on **disc-tools.de**.\n\nIf you believe this was a mistake, please reach out to the team.`,
            footer: { text: 'Disc-Tools Partnership Program' }
        });
    }

    for (const uid of added) {
        await db.query(
            'INSERT INTO partner_members (partner_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [partnerId, uid]
        );
        await assignPartnerRole(uid).catch(() => {});
    }

    for (const uid of added) {
        sendMemberDM(uid, {
            color: 0x2ECC71,
            title: '🤝 Added to Partnership',
            description: `You have been added to the partnership **${partnerName}** on **disc-tools.de**!`,
            footer: { text: 'Disc-Tools Partnership Program' }
        });
    }

    if (added.length > 0) {
        for (const uid of oldSet) {
            sendMemberDM(uid, {
                color: 0x3498DB,
                title: '👥 Partnership Updated',
                description: `${added.length} new member${added.length > 1 ? 's have' : ' has'} been added to your partnership **${partnerName}** on **disc-tools.de**!`,
                footer: { text: 'Disc-Tools Partnership Program' }
            });
        }
    }

    // Remove partner role from users who are no longer in any partnership
    for (const uid of removed) {
        try {
            const still = await db.query('SELECT 1 FROM partner_members WHERE user_id = $1 LIMIT 1', [uid]);
            if (still.rows.length === 0) {
                await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${uid}/roles/${PARTNER_ROLE_ID}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
                });
            }
        } catch (e) {
            console.warn('[PARTNERS] Role removal failed for', uid, ':', e.message);
        }
    }
}

function generateSlug(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

const ADMIN_ROLES = [
    '1503064097040629891', // Founder
    '1503064197704061109', // Co-Founder
    '1503064289915965621', // Sr. Admin
    '1503064343837937795'  // Admin
];

async function checkAdmin(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;

        if (!BOT_TOKEN) return res.status(503).json({ error: 'Bot not configured' });

        const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${decoded.id}`, BOT_TOKEN, 'Bot ');
        const roles = member.roles || [];
        const isAdmin = roles.some(r => ADMIN_ROLES.includes(r));

        if (isAdmin) return next();
        return res.status(403).json({ error: 'Not an admin' });
    } catch (err) {
        res.status(403).json({ error: 'Admin check failed' });
    }
}

// --- Get All Active Partners (Public) ---
router.get('/api/partners', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, slug, logo, description, website, discord_server, status 
             FROM partners WHERE status = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`,
            ['active']
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[PARTNERS] Fetch failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch partners' });
    }
});

// --- Get Partner by Slug (Public) ---
router.get('/api/partner/:slug', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT p.name, p.slug, p.logo, p.background, p.description, p.website, p.discord_server, p.expires_at,
                    COALESCE(json_agg(json_build_object('user_id', pm.user_id, 'added_at', pm.added_at)) FILTER (WHERE pm.user_id IS NOT NULL), '[]') as members
             FROM partners p
             LEFT JOIN partner_members pm ON pm.partner_id = p.id
             WHERE p.slug = $1 AND p.status = 'active'
             GROUP BY p.id`,
            [req.params.slug]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Partner not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[PARTNERS] Fetch by slug failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch partner' });
    }
});

// --- Get My Partner Info (Auth required) ---
router.get('/api/user/partner', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, slug, logo, description, website, discord_server
             FROM partners WHERE user_id = $1 AND status = 'active'`,
            [req.user.id]
        );
    if (result.rows.length === 0) {
        return res.json(null);
    }

    res.json(result.rows[0]);
    } catch (err) {
        console.error('[PARTNERS] Fetch mine failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch your partner info' });
    }
});

// --- Update My Partner Info (Auth required) ---
router.put('/api/user/partner', authMiddleware, async (req, res) => {
    try {
        const { description, website, discord_server, logo } = req.body;

        const existing = await db.query(
            `SELECT id FROM partners WHERE user_id = $1 AND status = 'active'`,
            [req.user.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'No partner found for your account' });
        }

        await db.query(
            `UPDATE partners SET
                description = COALESCE($1, description),
                website = COALESCE($2, website),
                discord_server = COALESCE($3, discord_server),
                logo = COALESCE($4, logo)
             WHERE user_id = $5 AND status = 'active'`,
            [description, website, discord_server, logo, req.user.id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[PARTNERS] Update failed:', err.message);
        res.status(500).json({ error: 'Failed to update partner info' });
    }
});

// --- Submit Partnership Request ---
router.post('/api/partners/request', authMiddleware, async (req, res) => {
    try {
        const { name, discordServer, website } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Project name is required' });
        }
        if (!website && !discordServer) {
            return res.status(400).json({ error: 'Either a Website or Discord Server link is required' });
        }

        // Check if user is in the Disc-Tools server
        if (!BOT_TOKEN) {
            return res.status(503).json({ error: 'Server membership check unavailable' });
        }

        try {
            await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${req.user.id}`, BOT_TOKEN, 'Bot ');
        } catch (err) {
            return res.status(403).json({ error: 'You must be a member of our Discord server to apply' });
        }

        const requestId = `${Date.now()}_${req.user.id}`;

        await db.query(
            `INSERT INTO partner_requests (id, user_id, username, avatar, name, discord_server, description, website, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
                requestId,
                req.user.id,
                req.user.username,
                req.user.avatar,
                name,
                discordServer || null,
                req.body.description || null,
                website || null,
                'pending'
            ]
        );

        console.log(`[PARTNERS] Request submitted by ${req.user.username} for ${name}`);

        // Send confirmation DM
        try {
            const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ recipient_id: req.user.id })
            });
            if (!dmChannelRes.ok) throw new Error(`DM channel creation failed (${dmChannelRes.status})`);
            const dmChannel = await dmChannelRes.json();

            await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    embeds: [{
                        color: 0x5865F2,
                        title: '📨 Partnership Request Received',
                        description: `Thank you for applying, **${req.user.username}**!\n\nWe have received your partnership request for **${name}** and our team will review it as soon as possible.`,
                        fields: [{
                            name: '⏳ How long does it take?',
                            value: 'There is no fixed timeframe - it depends on the project and team availability. Please do **not** message team members asking for updates. We will notify you via DM once a decision has been made.'
                        }],
                        footer: { text: 'Disc-Tools Partnership Program' }
                    }]
                })
            });
        } catch (e) {
            console.warn('[PARTNERS] Failed to send confirmation DM:', e.message);
        }

        // Notify team channel
        try {
            await fetch(`https://discord.com/api/v10/channels/1508660007405883493/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    embeds: [{
                        color: 0xF1C40F,
                        title: '📩 New Partnership Request',
                        description: `**${name}** has submitted a partnership request.`,
                        fields: [
                            { name: 'Applicant', value: `${req.user.username} (\`${req.user.id}\`)`, inline: true },
                            { name: 'Discord', value: discordServer || '-', inline: true },
                            { name: 'Website', value: website || '-', inline: true }
                        ],
                        url: 'https://disc-tools.de/admin/partner/requests/',
                        footer: { text: 'Disc-Tools Partnership Program' }
                    }]
                })
            });
        } catch (e) {
            console.warn('[PARTNERS] Failed to notify team channel:', e.message);
        }

        res.json({ success: true, requestId });
    } catch (err) {
        console.error('[PARTNERS] Request submission failed:', err.message);
        res.status(500).json({ error: 'Failed to submit partnership request' });
    }
});

// --- Admin: Get Single Request ---
router.get('/api/admin/partner/request/:id', checkAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM partner_requests WHERE id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[ADMIN PARTNERS] Fetch request failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch request' });
    }
});

// --- Admin: Get Pending Requests ---
router.get('/api/admin/partner/requests', checkAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT * FROM partner_requests WHERE status IN ('pending', 'reviewing') ORDER BY created_at DESC`,
        );
        res.json(result.rows);
    } catch (err) {
        console.error('[ADMIN PARTNERS] Fetch requests failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// --- Admin: Approve Partnership Request ---
router.post('/api/admin/partner/requests/:id/approve', checkAdmin, async (req, res) => {
    try {
        // Get the request
        const reqResult = await db.query(
            `SELECT * FROM partner_requests WHERE id = $1`,
            [req.params.id]
        );

        if (reqResult.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const partnerReq = reqResult.rows[0];

        const { duration } = req.body;
        let expiresAt = null;
        let durationLabel = '∞ Infinite';

        if (duration && Number.isInteger(duration) && duration > 0) {
            expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
            durationLabel = `${duration} day${duration === 1 ? '' : 's'}`;
        }

        // Insert into partners table
        const slug = generateSlug(partnerReq.name);
        await db.query(
            `INSERT INTO partners (id, name, slug, logo, description, website, discord_server, user_id, status, approved_by, approved_at, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)
             ON CONFLICT (id) DO NOTHING`,
            [
                partnerReq.id,
                partnerReq.name,
                slug,
                null,
                partnerReq.description,
                partnerReq.website,
                partnerReq.discord_server,
                partnerReq.user_id,
                'active',
                req.user.id,
                expiresAt
            ]
        );

        // Update request status
        await db.query(
            `UPDATE partner_requests SET status = $1 WHERE id = $2`,
            ['approved', req.params.id]
        );

        // Send Discord DM with embed
        try {
            const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ recipient_id: partnerReq.user_id })
            });
            if (!dmChannelRes.ok) throw new Error(`DM channel creation failed (${dmChannelRes.status})`);
            const dmChannel = await dmChannelRes.json();

            await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    embeds: [
                        {
                            color: 0x2ECC71,
                            title: '🎉 Partnership Approved!',
                            description: `Your partnership request for **${partnerReq.name}** has been approved!\n\nYou have been given the <@&${PARTNER_ROLE_ID}> role in our server. Welcome to the team! 🤝\n\n**Duration:** ${durationLabel}`,
                            footer: { text: 'Disc-Tools Partnership Program' }
                        }
                    ]
                })
            });
        } catch (e) {
            console.warn('[PARTNERS] Failed to notify user:', e.message);
        }

        // Assign partner role
        try {
            await assignPartnerRole(partnerReq.user_id);
        } catch (e) {
            console.warn('[PARTNERS] Failed to assign role:', e.message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[ADMIN PARTNERS] Approve failed:', err.message);
        res.status(500).json({ error: 'Failed to approve request' });
    }
});

// --- Admin: Mark Request as Under Review ---
router.post('/api/admin/partner/requests/:id/review', checkAdmin, async (req, res) => {
    try {
        const reqResult = await db.query(
            `SELECT * FROM partner_requests WHERE id = $1`,
            [req.params.id]
        );

        if (reqResult.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const partnerReq = reqResult.rows[0];

        // Update status to 'reviewing'
        await db.query(
            `UPDATE partner_requests SET status = $1 WHERE id = $2`,
            ['reviewing', req.params.id]
        );

        // Send Discord DM with embed
        try {
            const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ recipient_id: partnerReq.user_id })
            });
            if (!dmChannelRes.ok) throw new Error(`DM channel creation failed (${dmChannelRes.status})`);
            const dmChannel = await dmChannelRes.json();

            await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    embeds: [
                        {
                            color: 0xF1C40F,
                            title: '🔍 Partnership Under Review',
                            description: `Your partnership request for **${partnerReq.name}** is currently being reviewed by our team.\n\nWe will notify you via DM as soon as a decision has been made. Thank you for your patience!`,
                            footer: { text: 'Disc-Tools Partnership Program' }
                        }
                    ]
                })
            });
        } catch (e) {
            console.warn('[PARTNERS] Failed to send review DM:', e.message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[ADMIN PARTNERS] Review failed:', err.message);
        res.status(500).json({ error: 'Failed to mark request as under review' });
    }
});

// --- Admin: Reject Partnership Request ---
router.post('/api/admin/partner/requests/:id/reject', checkAdmin, async (req, res) => {
    try {
        const { reason } = req.body;

        const reqResult = await db.query(
            `SELECT * FROM partner_requests WHERE id = $1`,
            [req.params.id]
        );

        if (reqResult.rows.length === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const partnerReq = reqResult.rows[0];

        // Update request status
        await db.query(
            `UPDATE partner_requests SET status = $1, rejection_reason = $2 WHERE id = $3`,
            ['rejected', reason || 'Your application did not meet our criteria.', req.params.id]
        );

        // Send Discord DM with embed
        try {
            const dmChannelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ recipient_id: partnerReq.user_id })
            });
            if (!dmChannelRes.ok) throw new Error(`DM channel creation failed (${dmChannelRes.status})`);
            const dmChannel = await dmChannelRes.json();

            await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    embeds: [
                        {
                            color: 0xE74C3C,
                            title: '❌ Partnership Not Approved',
                            description: `Your partnership request for **${partnerReq.name}** was not approved at this time.`,
                            fields: [
                                {
                                    name: 'Reason',
                                    value: reason || 'Your application did not meet our criteria.'
                                }
                            ],
                            footer: { text: 'Disc-Tools Partnership Program' }
                        }
                    ]
                })
            });
        } catch (e) {
            console.warn('[PARTNERS] Failed to notify user:', e.message);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[ADMIN PARTNERS] Reject failed:', err.message);
        res.status(500).json({ error: 'Failed to reject request' });
    }
});

// --- Admin: Get All Partners ---
router.get('/api/admin/partners', checkAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT p.*, CASE WHEN p.expires_at IS NOT NULL AND p.expires_at <= NOW() THEN true ELSE false END as expired,
                    COALESCE(json_agg(json_build_object('user_id', pm.user_id, 'added_at', pm.added_at)) FILTER (WHERE pm.user_id IS NOT NULL), '[]') as members
             FROM partners p
             LEFT JOIN partner_members pm ON pm.partner_id = p.id
             GROUP BY p.id
             ORDER BY p.created_at DESC`
        );

        // Only display members who actually still have the partner role
        const rows = result.rows;
        for (const partner of rows) {
            if (!partner.members || partner.members.length === 0) continue;
            const verified = [];
            for (const m of partner.members) {
                try {
                    const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${m.user_id}`, BOT_TOKEN, 'Bot ');
                    if (Array.isArray(member.roles) && member.roles.includes(PARTNER_ROLE_ID)) {
                        verified.push(m);
                    }
                } catch (e) {
                    verified.push(m); // fail-open bei Discord-Fehlern/Rate-Limit
                }
            }
            partner.members = verified;
        }

        res.json(rows);
    } catch (err) {
        console.error('[ADMIN PARTNERS] Fetch all failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch partners' });
    }
});

// --- Admin: Resolve Discord user (avatar/username) for partner members ---
const partnerUserCache = new Map();

router.get('/api/admin/partner/user/:id', checkAdmin, async (req, res) => {
    const userId = req.params.id;
    if (!/^\d{17,20}$/.test(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }
    const cached = partnerUserCache.get(userId);
    if (cached && Date.now() - cached.time < 10 * 60 * 1000) {
        return res.json(cached.data);
    }
    try {
        const u = await discordFetch(`https://discord.com/api/v10/users/${userId}`, BOT_TOKEN, 'Bot ');
        const data = { id: u.id, username: u.username, global_name: u.global_name, avatar: u.avatar };
        partnerUserCache.set(userId, { data, time: Date.now() });
        res.json(data);
    } catch (err) {
        res.status(404).json({ error: 'User not found' });
    }
});

// --- Admin: Update Partner ---
router.put('/api/admin/partners/:id', checkAdmin, async (req, res) => {
    try {
        const { name, logo, description, website, discord_server, user_id, user_ids, duration } = req.body;

        const existing = await db.query(
            `SELECT id, name FROM partners WHERE id = $1`,
            [req.params.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Partner not found' });
        }

        const slug = name ? generateSlug(name) : undefined;

        let expiresAt = undefined;
        if (duration !== undefined) {
            if (duration === null || duration === 0 || duration === '0') {
                expiresAt = null;
            } else if (Number.isInteger(duration) && duration > 0) {
                expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
            }
        }

        await db.query(
            `UPDATE partners SET
                name = COALESCE($1, name),
                slug = COALESCE($2, slug),
                description = COALESCE($3, description),
                website = COALESCE($4, website),
                discord_server = COALESCE($5, discord_server),
                logo = COALESCE($6, logo),
                user_id = COALESCE($7, user_id),
                expires_at = COALESCE($8, expires_at)
             WHERE id = $9`,
            [name || null, slug || null, description || null, website || null, discord_server || null, logo || null, user_id || null, expiresAt, req.params.id]
        );

        if (user_ids !== undefined) {
            const oldMembers = await db.query(
                'SELECT user_id FROM partner_members WHERE partner_id = $1',
                [req.params.id]
            );
            await syncPartnerMembers(
                req.params.id,
                existing.rows[0].name,
                user_ids,
                oldMembers.rows.map(r => r.user_id)
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[ADMIN PARTNERS] Update failed:', err.message, err.stack);
        res.status(500).json({ error: 'Failed to update partner: ' + err.message });
    }
});

// --- Admin: Delete Partner ---
router.post('/api/admin/partners/:id/delete', checkAdmin, async (req, res) => {
    try {
        const { reason } = req.body || {};

        const existing = await db.query(
            `SELECT id, name, user_id FROM partners WHERE id = $1`,
            [req.params.id]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Partner not found' });
        }
        const partner = existing.rows[0];

        const members = await db.query(
            'SELECT user_id FROM partner_members WHERE partner_id = $1',
            [req.params.id]
        );

        await db.query(
            `DELETE FROM partners WHERE id = $1`,
            [req.params.id]
        );

        // Notify all linked members + the partner owner via DM
        const recipients = [...new Set([
            ...members.rows.map(r => r.user_id),
            partner.user_id
        ].filter(Boolean))];

        const endedBy = req.user.global_name || req.user.username || req.user.id;
        const endedReason = (reason && String(reason).trim()) || 'No reason provided.';

        for (const uid of recipients) {
            sendMemberDM(uid, {
                color: 0xE74C3C,
                title: '💔 Partnership Ended',
                description: `The partnership **${partner.name}** with **disc-tools.de** has been ended.`,
                fields: [
                    { name: 'Ended by', value: String(endedBy) },
                    { name: 'Ended at', value: `<t:${Math.floor(Date.now() / 1000)}:F>` },
                    { name: 'Reason', value: endedReason.slice(0, 1000) }
                ],
                footer: { text: 'Disc-Tools Partnership Program' }
            });
        }

        res.json({ success: true, notified: recipients.length });
    } catch (err) {
        console.error('[ADMIN PARTNERS] Delete failed:', err.message);
        res.status(500).json({ error: 'Failed to delete partner' });
    }
});

// --- Admin: Add Partner ---
router.post('/api/admin/partners/add', checkAdmin, async (req, res) => {
    try {
        const { name, logo, description, website, discordServer, user_ids, duration } = req.body;

        if (!name || (!user_ids && !req.body.user_id)) {
            return res.status(400).json({ error: 'Name and at least one User ID are required' });
        }
        if (!website && !discordServer) {
            return res.status(400).json({ error: 'Either Website or Discord Server link is required' });
        }

        const ids = Array.isArray(user_ids) ? user_ids.filter(Boolean) : (req.body.user_id ? [req.body.user_id] : []);

        let expiresAt = null;
        if (duration && Number.isInteger(duration) && duration > 0) {
            expiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
        }

        const partnerId = `${Date.now()}_${req.user.id}`;
        const slug = generateSlug(name);

        await db.query(
            `INSERT INTO partners (id, name, slug, logo, description, website, discord_server, user_id, status, approved_by, approved_at, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), $11)`,
            [
                partnerId, name, slug, logo || null, description,
                website || null, discordServer || null, ids[0] || null,
                'active', req.user.id, expiresAt
            ]
        );

        for (const uid of ids) {
            await db.query(
                'INSERT INTO partner_members (partner_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [partnerId, uid]
            );
        }

        for (const uid of ids) {
            sendMemberDM(uid, {
                color: 0x2ECC71,
                title: '🤝 Added to Partnership',
                description: `You have been added to the partnership **${name}** on **disc-tools.de**!${expiresAt ? `\n\n**Duration:** Until <t:${Math.floor(expiresAt.getTime() / 1000)}:D>` : ''}`,
                footer: { text: 'Disc-Tools Partnership Program' }
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[ADMIN PARTNERS] Add failed:', err.message);
        res.status(500).json({ error: 'Failed to add partner' });
    }
});

// --- Partner Image Upload ---
const PARTNER_UPLOADS_DIR = path.join(__dirname, '../../uploads/partners');
fs.mkdirSync(PARTNER_UPLOADS_DIR, { recursive: true });

const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 1 * 1024 * 1024;

const partnerUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dest = path.join(PARTNER_UPLOADS_DIR, req.params.slug);
            fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase() || '.png';
            const name = uuidv4() + ext;
            req.uploadedFilename = name;
            cb(null, name);
        }
    }),
    limits: { fileSize: MAX_IMAGE_SIZE },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIMES.includes(file.mimetype)) {
            return cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed'));
        }
        cb(null, true);
    }
});

async function checkPartnerAccess(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;

        const slug = req.params.slug;
        const partner = await db.query(
            'SELECT id, user_id FROM partners WHERE slug = $1 AND status = $2',
            [slug, 'active']
        );
        if (partner.rows.length === 0) {
            return res.status(404).json({ error: 'Partner not found' });
        }

        // Try admin check separately - don't block on failure
        let isAdmin = false;
        if (BOT_TOKEN) {
            try {
                const member = await discordFetch(
                    `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${decoded.id}`,
                    BOT_TOKEN, 'Bot '
                );
                const roles = member.roles || [];
                isAdmin = roles.some(r => ADMIN_ROLES.includes(r));
            } catch {}
        }

        if (isAdmin) {
            req.partner = partner.rows[0];
            return next();
        }

        // Check if partner member
        const memberCheck = await db.query(
            'SELECT 1 FROM partner_members WHERE partner_id = $1 AND user_id = $2',
            [partner.rows[0].id, decoded.id]
        );
        if (memberCheck.rows.length > 0 || partner.rows[0].user_id === decoded.id) {
            req.partner = partner.rows[0];
            return next();
        }

        return res.status(403).json({ error: 'Not authorized to manage this partner' });
    } catch (err) {
        console.error('[PARTNER ACCESS] Error:', err.message);
        return res.status(403).json({ error: 'Access check failed: ' + err.message });
    }
}

router.post('/api/admin/partner/manage/:slug/upload', checkPartnerAccess, partnerUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const file = req.file;
        const baseUrl = `/uploads/partners/${req.params.slug}/${file.filename}`;

        // Remove old file if replacing same type
        const type = req.body.type;
        if (type === 'logo' || type === 'background') {
            const old = await db.query(
                `SELECT ${type} FROM partners WHERE id = $1`,
                [req.partner.id]
            );
            const oldPath = old.rows[0]?.[type];
            if (oldPath && oldPath.startsWith('/uploads/')) {
                try { fs.unlinkSync(path.join(__dirname, '../..', oldPath)); } catch {}
            }
            await db.query(
                `UPDATE partners SET ${type} = $1 WHERE id = $2`,
                [baseUrl, req.partner.id]
            );
        }

        res.json({ success: true, url: baseUrl, filename: file.filename });
    } catch (err) {
        console.error('[PARTNER UPLOAD] Error:', err.message);
        res.status(500).json({ error: 'Upload failed' });
    }
});

router.post('/api/admin/partner/manage/:slug/upload/remove', checkPartnerAccess, async (req, res) => {
    try {
        const type = req.body.type;
        if (type !== 'logo' && type !== 'background') {
            return res.status(400).json({ error: 'Invalid type' });
        }

        const old = await db.query(
            `SELECT ${type} FROM partners WHERE id = $1`,
            [req.partner.id]
        );
        const oldPath = old.rows[0]?.[type];
        if (oldPath && oldPath.startsWith('/uploads/')) {
            try { fs.unlinkSync(path.join(__dirname, '../..', oldPath)); } catch {}
        }

        await db.query(
            `UPDATE partners SET ${type} = NULL WHERE id = $1`,
            [req.partner.id]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[PARTNER UPLOAD] Remove failed:', err.message);
        res.status(500).json({ error: 'Remove failed' });
    }
});

router.get('/api/admin/partner/manage/:slug', checkPartnerAccess, async (req, res) => {
    try {
        const partner = await db.query(
            `SELECT p.*, CASE WHEN p.expires_at IS NOT NULL AND p.expires_at <= NOW() THEN true ELSE false END as expired,
                    COALESCE(json_agg(json_build_object('user_id', pm.user_id, 'added_at', pm.added_at)) FILTER (WHERE pm.user_id IS NOT NULL), '[]') as members
             FROM partners p
             LEFT JOIN partner_members pm ON pm.partner_id = p.id
             WHERE p.slug = $1 AND p.status = 'active'
             GROUP BY p.id`,
            [req.params.slug]
        );
        if (partner.rows.length === 0) {
            return res.status(404).json({ error: 'Partner not found' });
        }
        res.json(partner.rows[0]);
    } catch (err) {
        console.error('[PARTNER MANAGE] Fetch failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch partner' });
    }
});

router.put('/api/admin/partner/manage/:slug', checkPartnerAccess, async (req, res) => {
    return updatePartnerManage(req, res);
});

router.post('/api/admin/partner/manage/:slug', checkPartnerAccess, async (req, res) => {
    return updatePartnerManage(req, res);
});

async function updatePartnerManage(req, res) {
    try {
        const { name, description, website, discord_server, user_ids } = req.body;

        await db.query(
            `UPDATE partners SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                website = COALESCE($3, website),
                discord_server = COALESCE($4, discord_server)
             WHERE id = $5`,
            [name || null, description || null, website || null, discord_server || null, req.partner.id]
        );

        if (name) {
            await db.query(
                'UPDATE partners SET slug = $1 WHERE id = $2',
                [generateSlug(name), req.partner.id]
            );
        }

        if (user_ids !== undefined) {
            const oldMembers = await db.query(
                'SELECT user_id FROM partner_members WHERE partner_id = $1',
                [req.partner.id]
            );
            await syncPartnerMembers(
                req.partner.id,
                name || req.partner.name || 'Unknown',
                Array.isArray(user_ids) ? user_ids : [],
                oldMembers.rows.map(r => r.user_id)
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[PARTNER MANAGE] Update failed:', err.message, err.stack);
        res.status(500).json({ error: 'Failed to update partner: ' + err.message });
    }
}

module.exports = router;
