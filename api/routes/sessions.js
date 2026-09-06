const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

// --- User session list (current user) ---
router.get('/sessions', auth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, session_id, user_agent, created_at, last_active AS last_used
             FROM admin_sessions
             WHERE user_id = $1 AND revoked = false
             ORDER BY last_active DESC`,
            [req.user.id]
        );
        res.json({ sessions: result.rows });
    } catch (e) {
        console.error('[SESSIONS] Fetch failed:', e.message);
        res.status(500).json({ error: 'Failed to fetch sessions' });
    }
});

// --- Revoke a session (current user) ---
router.delete('/sessions/:id', auth, async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: 'Invalid session id' });
        }
        const result = await db.query(
            `UPDATE admin_sessions SET revoked = true
             WHERE id = $1 AND user_id = $2
             RETURNING session_id`,
            [id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (req.cookies.session_id === result.rows[0].session_id) {
            res.clearCookie('token');
            res.clearCookie('discord_at');
            res.clearCookie('discord_refresh');
            res.clearCookie('session_id');
        }
        res.json({ success: true });
    } catch (e) {
        console.error('[SESSIONS] Revoke failed:', e.message);
        res.status(500).json({ error: 'Failed to revoke session' });
    }
});

module.exports = router;
