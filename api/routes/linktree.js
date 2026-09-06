const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');

async function checkPremium(userId) {
    try {
        const result = await db.query(
            'SELECT active, expires_at FROM premium_users WHERE user_id = $1',
            [userId]
        );
        if (result.rows.length === 0) return false;
        const p = result.rows[0];
        if (!p.active) return false;
        if (p.expires_at && new Date(p.expires_at) < new Date()) return false;
        return true;
    } catch {
        return false;
    }
}

router.get('/linktree/profile', auth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, user_id, username, display_name, bio, background_type,
                    background_value, text_color, accent_color, button_style,
                    is_premium, is_active, archived_at, created_at, updated_at
             FROM linktree_profiles WHERE user_id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.json({ profile: null, links: [], hobbies: [] });
        }
        const profile = result.rows[0];
        const linksResult = await db.query(
            'SELECT id, label, url, icon, sort_order FROM linktree_links WHERE profile_id = $1 ORDER BY sort_order',
            [profile.id]
        );
        const hobbiesResult = await db.query(
            'SELECT id, hobby, sort_order FROM linktree_hobbies WHERE profile_id = $1 ORDER BY sort_order',
            [profile.id]
        );
        res.json({ profile, links: linksResult.rows, hobbies: hobbiesResult.rows });
    } catch (err) {
        console.error('[LINKTREE] Get profile failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

router.post('/linktree/profile', auth, async (req, res) => {
    try {
        const { display_name, bio, background_type, background_value,
                text_color, accent_color, button_style, links, hobbies } = req.body;

        const username = (req.user.username || '').toLowerCase();
        if (!username || username.length < 2) {
            return res.status(400).json({ error: 'Invalid Discord username' });
        }

        const isPremium = await checkPremium(req.user.id);

        let profileId;
        const existing = await db.query(
            'SELECT id, is_active, archived_at FROM linktree_profiles WHERE user_id = $1',
            [req.user.id]
        );

        if (existing.rows.length > 0) {
            profileId = existing.rows[0].id;

            await db.query(
                `UPDATE linktree_profiles SET username = $1, display_name = $2, bio = $3,
                 background_type = $4, background_value = $5, text_color = $6,
                 accent_color = $7, button_style = $8, is_premium = $9,
                 archived_at = CASE WHEN $9 THEN NULL ELSE archived_at END,
                 updated_at = NOW()
                 WHERE id = $10`,
                [username, display_name || null, bio || null,
                 background_type || 'color', background_value || '#0d1117',
                 text_color || '#ffffff', accent_color || '#5865F2',
                 button_style || 'rounded', isPremium, profileId]
            );
        } else {
            if (!isPremium) {
                return res.status(403).json({ error: 'Premium required to create a Linktree profile' });
            }

            const insert = await db.query(
                `INSERT INTO linktree_profiles (user_id, username, display_name, bio,
                 background_type, background_value, text_color, accent_color, button_style, is_premium)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING id`,
                [req.user.id, username, display_name || null, bio || null,
                 background_type || 'color', background_value || '#0d1117',
                 text_color || '#ffffff', accent_color || '#5865F2',
                 button_style || 'rounded', isPremium]
            );
            profileId = insert.rows[0].id;
        }

        if (links && Array.isArray(links)) {
            await db.query('DELETE FROM linktree_links WHERE profile_id = $1', [profileId]);
            for (let i = 0; i < Math.min(links.length, 20); i++) {
                const l = links[i];
                if (l.label && l.url) {
                    await db.query(
                        'INSERT INTO linktree_links (profile_id, label, url, icon, sort_order) VALUES ($1, $2, $3, $4, $5)',
                        [profileId, l.label, l.url, l.icon || null, i]
                    );
                }
            }
        }

        if (hobbies && Array.isArray(hobbies)) {
            await db.query('DELETE FROM linktree_hobbies WHERE profile_id = $1', [profileId]);
            for (let i = 0; i < Math.min(hobbies.length, 20); i++) {
                const h = hobbies[i];
                if (h) {
                    await db.query(
                        'INSERT INTO linktree_hobbies (profile_id, hobby, sort_order) VALUES ($1, $2, $3)',
                        [profileId, h, i]
                    );
                }
            }
        }

        res.json({ success: true, profileId, username });
    } catch (err) {
        console.error('[LINKTREE] Save profile failed:', err.message);
        if (err.code === '23505') {
            return res.status(409).json({ error: 'A profile with this username already exists' });
        }
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

router.get('/linktree/page/:username', async (req, res) => {
    try {
        const username = req.params.username.toLowerCase();

        const result = await db.query(
            `SELECT id, user_id, username, display_name, bio, background_type, background_value,
                    text_color, accent_color, button_style, is_premium, is_active,
                    archived_at, created_at, updated_at
             FROM linktree_profiles WHERE username = $1 AND is_active = true`,
            [username]
        );

        if (result.rows.length === 0 || result.rows[0].archived_at) {
            return res.status(404).json({ error: 'Not found' });
        }

        const profile = result.rows[0];

        const linksResult = await db.query(
            'SELECT label, url, icon FROM linktree_links WHERE profile_id = $1 ORDER BY sort_order',
            [profile.id]
        );
        const hobbiesResult = await db.query(
            'SELECT hobby FROM linktree_hobbies WHERE profile_id = $1 ORDER BY sort_order',
            [profile.id]
        );

        res.json({
            username: profile.username,
            user_id: profile.user_id,
            display_name: profile.display_name,
            bio: profile.bio,
            background_type: profile.background_type,
            background_value: profile.background_value,
            text_color: profile.text_color,
            accent_color: profile.accent_color,
            button_style: profile.button_style,
            links: linksResult.rows,
            hobbies: hobbiesResult.rows.map(r => r.hobby)
        });
    } catch (err) {
        console.error('[LINKTREE] Get page failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

router.post('/linktree/profile/activate', auth, async (req, res) => {
    try {
        const isPremium = await checkPremium(req.user.id);
        const result = await db.query(
            'SELECT id, is_active, archived_at FROM linktree_profiles WHERE user_id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No profile exists. Create one first.' });
        }

        const profile = result.rows[0];

        if (!isPremium) {
            if (profile.is_active) {
                await db.query(
                    'UPDATE linktree_profiles SET is_active = false, archived_at = NOW(), updated_at = NOW() WHERE id = $1',
                    [profile.id]
                );
                return res.json({ active: false, message: 'Profile deactivated. Premium required to keep it active.' });
            }
            return res.status(403).json({ error: 'Premium required to activate a Linktree profile' });
        }

        const nowActive = !profile.is_active;
        await db.query(
            `UPDATE linktree_profiles SET is_active = $1, archived_at = CASE WHEN $1 THEN NULL ELSE archived_at END, updated_at = NOW() WHERE id = $2`,
            [nowActive, profile.id]
        );

        res.json({ active: nowActive });
    } catch (err) {
        console.error('[LINKTREE] Activate failed:', err.message);
        res.status(500).json({ error: 'Failed to toggle activation' });
    }
});

router.delete('/linktree/profile', auth, async (req, res) => {
    try {
        await db.query('DELETE FROM linktree_profiles WHERE user_id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('[LINKTREE] Delete failed:', err.message);
        res.status(500).json({ error: 'Failed to delete profile' });
    }
});

module.exports = router;