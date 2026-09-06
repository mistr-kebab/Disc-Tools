const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const probe = require('probe-image-size');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const auth = require('../middleware/auth');

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const INTERNAL_SECRET = process.env.GIFS_INTERNAL_SECRET;
const GUILD_ID = process.env.GUILD_ID;

const GIFS_LOG_CHANNEL = '1525954682261078188';
const GIFS_REPORT_CHANNEL = '1525925561128714410';
const ADMIN_ROLES = ['1503064097040629891', '1503064197704061109', '1503064289915965621', '1503064343837937795', '1503064391564791899', '1503064448267718760', '1503064501573124276', '1503064547966058626'];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const UPLOADS_DIR = path.join(__dirname, '../../uploads/gifs');
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_DIMENSION = 1920;

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userDir = path.join(UPLOADS_DIR, req.user.id);
        fs.mkdirSync(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        const id = uuidv4();
        req.gifId = id;
        cb(null, `${id}.gif`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'image/gif') {
            return cb(new Error('Only GIF files are allowed'));
        }
        cb(null, true);
    }
});

function internalAuth(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || auth !== `Internal ${INTERNAL_SECRET}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    next();
}

async function hasAdminRole(userId) {
    try {
        const response = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`, {
            headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
        });
        if (!response.ok) return false;
        const member = await response.json();
        return member.roles && member.roles.some(r => ADMIN_ROLES.includes(r));
    } catch {
        return false;
    }
}

async function sendModMessage(gifId, gifName, userId, fileSize, nsfw, tags, showButtons = true) {
    const embed = {
        title: gifName,
        url: `https://disc-tools.de/gifs/${userId}/${gifId}/`,
        color: nsfw ? 0xED4245 : 0x57F287,
        fields: [
            { name: 'Uploader', value: `<@${userId}>`, inline: true },
            { name: 'Size', value: `${(fileSize / 1024 / 1024).toFixed(2)} MB`, inline: true },
            { name: 'NSFW', value: nsfw ? '⚠️ Yes' : '✅ No', inline: true },
            { name: 'Status', value: nsfw ? '⏳ Pending review' : '✅ Auto-approved', inline: true },
            { name: 'Tags', value: tags.length ? tags.join(', ') : '-' }
        ],
        image: { url: `https://disc-tools.de/uploads/gifs/${userId}/${gifId}.gif` },
        footer: { text: `ID: ${gifId}` },
        timestamp: new Date().toISOString()
    };

    const body = { embeds: [embed] };
    if (showButtons) {
        body.components = [{
            type: 1,
            components: [
                { type: 2, style: 3, label: 'Approve', custom_id: `gifs_approve_${gifId}` },
                { type: 2, style: 4, label: 'Block', custom_id: `gifs_block_${gifId}` }
            ]
        }];
    }

    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${GIFS_LOG_CHANNEL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            const data = await response.json();
            return data.id;
        }
    } catch (e) {
        console.error('[GIFS] Failed to send mod message:', e.message);
    }
    return null;
}

async function sendReportMessage(gifId, gifName, reporterId, reporterName, uploaderId, reason) {
    const embed = {
        title: `Report: ${gifName}`,
        url: `https://disc-tools.de/gifs/${uploaderId}/${gifId}/`,
        color: 0xED4245,
        fields: [
            { name: 'GIF ID', value: gifId, inline: true },
            { name: 'Uploader', value: `<@${uploaderId}>`, inline: true },
            { name: 'Reported by', value: `<@${reporterId}> (${reporterName})`, inline: false },
            { name: 'Reason', value: reason && reason.trim() ? reason.trim() : 'No reason provided' }
        ],
        footer: { text: `Reporter ID: ${reporterId}` },
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch(`https://discord.com/api/v10/channels/${GIFS_REPORT_CHANNEL}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [embed] })
        });
        if (response.ok) {
            const data = await response.json();
            return data.id;
        }
    } catch (e) {
        console.error('[GIFS] Failed to send report message:', e.message);
    }
    return null;
}

function calculateAge(birthday) {
    const birth = new Date(birthday);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

// POST /api/gifs/upload
router.post('/gifs/upload', auth, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'File too large (max 8MB)' });
                }
                return res.status(400).json({ error: err.message });
            }
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { name, tags, nsfw } = req.body;
        if (!name || name.trim().length === 0 || name.length > 100) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Name is required (max 100 chars)' });
        }

        let dimensions;
        try {
            const stream = fs.createReadStream(req.file.path);
            dimensions = await probe(stream);
        } catch (e) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid or corrupted GIF' });
        }

        if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: `Dimensions exceed ${MAX_DIMENSION}px` });
        }

        const parsedTags = tags
            ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 10)
            : [];
        const cleanName = name.trim();
        const isNsfw = nsfw === 'true' || nsfw === '1';
        const autoApprove = !isNsfw;
        const modStatus = autoApprove ? 'approved' : 'pending';

        const uploaderName = req.user.global_name || req.user.username || 'Unknown';

        const result = await db.query(`
            INSERT INTO gifs (id, user_id, uploader_name, storage_path, original_name, name, tags, nsfw, file_size, width, height, moderation_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING id
        `, [
            req.gifId, req.user.id, uploaderName,
            `${req.user.id}/${req.gifId}.gif`,
            req.file.originalname,
            cleanName, parsedTags, isNsfw,
            req.file.size, dimensions.width, dimensions.height,
            modStatus
        ]);

        // Log every upload
        const logButtons = isNsfw;
        const messageId = await sendModMessage(req.gifId, cleanName, req.user.id, req.file.size, isNsfw, parsedTags, logButtons);
        if (messageId && isNsfw) {
            await db.query('UPDATE gifs SET moderation_message_id = $1 WHERE id = $2', [messageId, req.gifId]);
        }

        res.json({
            id: req.gifId,
            url: `/gifs/${req.user.id}/${req.gifId}/`,
            moderation_status: modStatus
        });
    } catch (err) {
        console.error('[GIFS UPLOAD]', err);
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// GET /api/gifs
router.get('/gifs', async (req, res) => {
    try {
        const { user, tags: tagFilter, nsfw: nsfwFilter, page = 1, limit = 30 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(parseInt(limit) || 30, 100);

        let where = ["moderation_status = 'approved'"];
        let params = [];
        let paramIndex = 1;

        if (user) {
            where.push(`user_id = $${paramIndex++}`);
            params.push(user);
        }
        if (tagFilter) {
            where.push(`tags && $${paramIndex++}`);
            params.push(tagFilter.split(',').map(t => t.trim()));
        }
        if (nsfwFilter === 'false' || nsfwFilter === '0') {
            where.push('nsfw = false');
        }

        const whereClause = where.join(' AND ');

        const countResult = await db.query(`SELECT COUNT(*) FROM gifs WHERE ${whereClause}`, params);
        const total = parseInt(countResult.rows[0].count);

        const result = await db.query(
             `SELECT id, user_id, uploader_name, name, tags, nsfw, file_size, width, height, views, created_at
              FROM gifs WHERE ${whereClause}
             ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
            [...params, Math.min(parseInt(limit) || 30, 100), offset]
        );

        res.json({
            gifs: result.rows.map(g => ({
                ...g,
                url: `https://disc-tools.de/uploads/gifs/${g.user_id}/${g.id}.gif`,
                page_url: `/gifs/${g.user_id}/${g.id}/`
            })),
            total,
            page: Math.max(1, parseInt(page)),
            limit: Math.min(parseInt(limit) || 30, 100)
        });
    } catch (err) {
        console.error('[GIFS LIST]', err);
        res.status(500).json({ error: 'Failed to fetch GIFs' });
    }
});

// GET /api/gifs/og/:id  (OpenGraph Embed für Crawler / freigegebene GIFs)
router.get('/gifs/og/:id', async (req, res) => {
    try {
        if (!UUID_REGEX.test(req.params.id)) {
            return res.status(404).send('GIF not found');
        }

        const result = await db.query(
            `SELECT id, user_id, uploader_name, name, tags, nsfw, file_size, width, height
             FROM gifs WHERE id = $1 AND moderation_status = 'approved'`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send('GIF not found');
        }

        const g = result.rows[0];
        const gifURL = `https://disc-tools.de/uploads/gifs/${g.user_id}/${g.id}.gif`;
        const pageURL = `https://disc-tools.de/gifs/${g.user_id}/${g.id}/`;
        const title = (g.nsfw ? '[NSFW] ' : '') + g.name;
        const desc = g.tags && g.tags.length
            ? `by ${g.uploader_name || 'Unknown'} • ${g.tags.join(', ')}`
            : `by ${g.uploader_name || 'Unknown'}`;
        const card = g.nsfw ? 'summary' : 'summary_large_image';

        const escapeHtml = s => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | Disc-Tools GIFs</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta name="theme-color" content="#5865f2">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Disc-Tools">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:url" content="${escapeHtml(pageURL)}">
<meta property="og:image" content="${escapeHtml(gifURL)}">
<meta property="og:image:type" content="image/gif">
<meta property="og:image:width" content="${g.width || ''}">
<meta property="og:image:height" content="${g.height || ''}">
<meta property="og:image:alt" content="${escapeHtml(g.name)}">
<meta name="twitter:card" content="${card}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(desc)}">
<meta name="twitter:image" content="${escapeHtml(gifURL)}">
</head>
<body style="margin:0;background:#0a0d13;color:#edf1fa;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px">
<div>
<img src="${escapeHtml(gifURL)}" alt="${escapeHtml(g.name)}" style="max-width:100%;max-height:60vh;border-radius:12px;border:1px solid #232c40">
<p style="margin-top:18px;font-size:20px;font-weight:700">${escapeHtml(title)}</p>
<p style="margin-top:4px;color:#9aa5bc">${escapeHtml(desc)}</p>
<p style="margin-top:18px"><a href="${escapeHtml(pageURL)}" style="color:#7c85f0">View on Disc-Tools →</a></p>
</div>
</body>
</html>`;

        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=300');
        return res.send(html);
    } catch (err) {
        console.error('[GIFS OG]', err);
        res.status(500).send('Failed to render GIF preview');
    }
});

// GET /api/gifs/:id
router.get('/gifs/:id', async (req, res) => {
    try {
        if (!UUID_REGEX.test(req.params.id)) {
            return res.status(404).json({ error: 'GIF not found' });
        }

        const result = await db.query(
             `SELECT id, user_id, uploader_name, name, tags, nsfw, file_size, width, height, views, moderation_status, created_at
              FROM gifs WHERE id = $1`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'GIF not found' });
        }

        const gif = result.rows[0];

        // Pending NSFW darf nur der Uploader sehen
        if (gif.moderation_status !== 'approved') {
            const token = req.cookies?.token;
            let userId = null;
            if (token) {
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
                    userId = decoded.id;
                } catch {}
            }
            if (gif.user_id !== userId) {
                return res.status(404).json({ error: 'GIF not found' });
            }
        }

        // Increment views
        await db.query('UPDATE gifs SET views = views + 1 WHERE id = $1', [gif.id]);

        res.json({
            ...gif,
            url: `https://disc-tools.de/uploads/gifs/${gif.user_id}/${gif.id}.gif`,
            page_url: `/gifs/${gif.user_id}/${gif.id}/`
        });
    } catch (err) {
        console.error('[GIFS GET]', err);
        res.status(500).json({ error: 'Failed to fetch GIF' });
    }
});

// POST /api/gifs/:id/approve (internal)
router.post('/gifs/:id/approve', internalAuth, async (req, res) => {
    try {
        if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'GIF not found' });
        const result = await db.query(
            `UPDATE gifs SET moderation_status = 'approved', moderated_by = $1, moderated_at = NOW()
             WHERE id = $2 AND moderation_status = 'pending'
             RETURNING id, user_id, name, moderation_message_id`,
            [req.body.moderator_id, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'GIF not found or already moderated' });
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('[GIFS APPROVE]', err);
        res.status(500).json({ error: 'Failed to approve GIF' });
    }
});

// POST /api/gifs/:id/reject (internal)
router.post('/gifs/:id/reject', internalAuth, async (req, res) => {
    try {
        if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'GIF not found' });
        const { reason, moderator_id } = req.body;

        const result = await db.query(
            `UPDATE gifs SET moderation_status = 'rejected', moderated_by = $1, moderation_reason = $2, moderated_at = NOW()
             WHERE id = $3 AND moderation_status = 'pending'
             RETURNING id, user_id, storage_path`,
            [moderator_id, reason || null, req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'GIF not found or already moderated' });
        }

        // Delete the file from disk
        const filePath = path.join(UPLOADS_DIR, result.rows[0].storage_path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[GIFS REJECT]', err);
        res.status(500).json({ error: 'Failed to reject GIF' });
    }
});

// POST /api/gifs/:id/report
router.post('/gifs/:id/report', auth, async (req, res) => {
    try {
        if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'GIF not found' });
        const { reason } = req.body;

        const result = await db.query(
            'SELECT id, user_id, name FROM gifs WHERE id = $1 AND moderation_status = $2',
            [req.params.id, 'approved']
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'GIF not found' });
        }

        await sendReportMessage(
            result.rows[0].id,
            result.rows[0].name,
            req.user.id,
            req.user.username || req.user.global_name || 'Unknown',
            result.rows[0].user_id,
            reason || ''
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[GIFS REPORT]', err);
        res.status(500).json({ error: 'Failed to report GIF' });
    }
});

// POST /api/gifs/:id/delete
router.post('/gifs/:id/delete', auth, async (req, res) => {
    try {
        if (!UUID_REGEX.test(req.params.id)) return res.status(404).json({ error: 'GIF not found' });
        const result = await db.query(
            'SELECT user_id, storage_path FROM gifs WHERE id = $1',
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'GIF not found' });
        }

        const gif = result.rows[0];
        const isOwner = gif.user_id === req.user.id;
        const isAdmin = await hasAdminRole(req.user.id);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Delete file
        const filePath = path.join(UPLOADS_DIR, gif.storage_path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await db.query('DELETE FROM gifs WHERE id = $1', [req.params.id]);

        res.json({ success: true });
    } catch (err) {
        console.error('[GIFS DELETE]', err);
        res.status(500).json({ error: 'Failed to delete GIF' });
    }
});

// POST /api/user/birthday
router.post('/user/birthday', auth, async (req, res) => {
    try {
        const { birthday } = req.body;
        if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
            return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
        }

        const date = new Date(birthday);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ error: 'Invalid date' });
        }

        await db.query(
            `INSERT INTO user_birthdays (user_id, birthday) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET birthday = $2, updated_at = NOW()`,
            [req.user.id, birthday]
        );

        const age = calculateAge(birthday);
        res.json({ birthday, age, isAdult: age >= 18 });
    } catch (err) {
        console.error('[BIRTHDAY SAVE]', err);
        res.status(500).json({ error: 'Failed to save birthday' });
    }
});

// GET /api/user/birthday
router.get('/user/birthday', auth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT birthday FROM user_birthdays WHERE user_id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.json({ birthday: null });
        }

        const birthday = result.rows[0].birthday;
        const age = calculateAge(birthday);
        res.json({ birthday, age, isAdult: age >= 18 });
    } catch (err) {
        console.error('[BIRTHDAY GET]', err);
        res.status(500).json({ error: 'Failed to fetch birthday' });
    }
});

module.exports = router;
