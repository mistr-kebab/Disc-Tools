const express = require('express');
const db = require('../db');
const { discordFetch } = require('../utils/discord');
const { hashIP, hashIPLegacy } = require('../utils/ip');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';
const MEMBER_ROLE_ID = '1503082936990306455';
const LOG_CHANNEL_ID = '1507558238353231922';

async function assignRole(userId) {
    const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}/roles/${MEMBER_ROLE_ID}`;
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
        const text = await res.text();
        console.error(`[VERIFY] Role assign failed (${res.status}):`, text);
        return;
    }
}

async function postLogEmbed(embed) {
    const res = await fetch(
        `https://discord.com/api/v10/channels/${LOG_CHANNEL_ID}/messages`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ embeds: [embed] })
        }
    );
    if (!res.ok) {
        console.error('[VERIFY LOG] Failed to post:', await res.text());
    }
}

async function memberHasRole(userId) {
    try {
        const res = await fetch(
            `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`,
            { headers: { 'Authorization': `Bot ${BOT_TOKEN}` } }
        );
        if (!res.ok) return false;
        const member = await res.json();
        return member.roles.includes(MEMBER_ROLE_ID);
    } catch {
        return false;
    }
}

router.get('/verify/status', authMiddleware, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT user_id FROM verified_users WHERE user_id = $1',
            [req.user.id]
        );
        const dbVerified = result.rows.length > 0;
        if (!dbVerified) return res.json({ verified: false });

        const hasRole = await memberHasRole(req.user.id);
        res.json({ verified: hasRole });
    } catch (err) {
        console.error('[VERIFY STATUS] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/verify/complete', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const username = req.user.username;

        let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;
        if (ip.startsWith('::ffff:')) ip = ip.split(':').pop();
        if (ip === '::1' || ip === '127.0.0.1') {
            return res.status(400).json({ error: 'Cannot verify from localhost' });
        }

        const ipHash = hashIP(ip);
        const ipHashLegacy = hashIPLegacy(ip);

        // All users (other than current) who verified from this IP (check both new HMAC & legacy SHA256)
        const existing = await db.query(
            'SELECT user_id FROM verified_users WHERE (ip_hash = $1 OR ip_hash = $2) AND user_id != $3',
            [ipHash, ipHashLegacy, userId]
        );
        const hasSimilarIP = existing.rows.length > 0;

        // Check if user has a previous verification record
        const alreadyVerified = await db.query(
            'SELECT user_id, ip_hash FROM verified_users WHERE user_id = $1',
            [userId]
        );
        const hasExistingRecord = alreadyVerified.rows.length > 0;

        const hasRole = await memberHasRole(userId);

        // Always record the IP hash first (even if already verified with role)
        await db.query(
            'INSERT INTO verified_users (user_id, ip_hash) VALUES ($1, $2)',
            [userId, ipHash]
        );

        // Also check if this user's OLD ip_hashes are shared with other users
        let otherUsersFromOldIp = [];
        if (hasExistingRecord) {
            const oldHashes = alreadyVerified.rows
                .map(r => r.ip_hash)
                .filter(h => h !== ipHash);
            const uniqueOldHashes = [...new Set(oldHashes)];
            for (const oldHash of uniqueOldHashes) {
                const oldMatches = await db.query(
                    'SELECT user_id FROM verified_users WHERE ip_hash = $1 AND user_id != $2',
                    [oldHash, userId]
                );
                for (const row of oldMatches.rows) {
                    if (!otherUsersFromOldIp.some(r => r.user_id === row.user_id)) {
                        otherUsersFromOldIp.push(row);
                    }
                }
            }
        }

        // Also check for known alt_relations
        const altRelRows = await db.query(
            `SELECT DISTINCT CASE WHEN user_id_a = $1 THEN user_id_b ELSE user_id_a END AS linked_id
             FROM alt_relations WHERE $1 IN (user_id_a, user_id_b)`,
            [userId]
        );
        const altRelUsers = altRelRows.rows.map(r => ({ user_id: r.linked_id }));

        // Store alt relationships in permanent table (before any early return)
        const allAltRows = [...existing.rows];
        const seenIds = new Set();
        [...existing.rows, ...otherUsersFromOldIp, ...altRelUsers].forEach(r => {
            if (!seenIds.has(r.user_id)) {
                seenIds.add(r.user_id);
                if (!allAltRows.some(a => a.user_id === r.user_id)) {
                    allAltRows.push(r);
                }
            }
        });
        for (const row of allAltRows) {
            await db.query(
                'INSERT INTO alt_relations (user_id_a, user_id_b) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [userId, row.user_id]
            );
        }

        if (hasExistingRecord && hasRole) {
            return res.json({ success: true, alreadyVerified: true });
        }

        const verifiedAt = new Date().toISOString();
        const timestamp = Math.floor(new Date(verifiedAt).getTime() / 1000);

        if (BOT_TOKEN) {
            await assignRole(userId);
        }

        // Build log embed
        if (hasSimilarIP || otherUsersFromOldIp.length > 0 || altRelUsers.length > 0) {
            const allAltRows = [...existing.rows];
            const seen = new Set();
            [...existing.rows, ...otherUsersFromOldIp, ...altRelUsers].forEach(r => {
                if (!seen.has(r.user_id)) {
                    seen.add(r.user_id);
                    if (!allAltRows.some(a => a.user_id === r.user_id)) {
                        allAltRows.push(r);
                    }
                }
            });

            const userMentions = [];
            for (const row of allAltRows) {
                try {
                    const u = await discordFetch(
                        `https://discord.com/api/v10/users/${row.user_id}`,
                        BOT_TOKEN,
                        'Bot '
                    );
                    userMentions.push(`<@${row.user_id}> (${u.username})`);
                } catch {
                    userMentions.push(`<@${row.user_id}>`);
                }
            }

            await postLogEmbed({
                color: 0xF1C40F,
                title: hasExistingRecord ? '⚠️ Alt Account (Re-Verify)' : '⚠️ Potential Alt Account',
                fields: [
                    { name: 'User', value: `<@${userId}> (${username})`, inline: false },
                    { name: 'Similar IP previously used by', value: userMentions.join('\n'), inline: false },
                    { name: 'Verified at', value: `<t:${timestamp}:F>`, inline: false },
                    ...(hasExistingRecord ? [{ name: 'Note', value: 'This user was already in the database and re-verified.', inline: false }] : [])
                ]
            });
        } else if (hasExistingRecord) {
            await postLogEmbed({
                color: 0x3498DB,
                title: '🔄 Re-Verification',
                fields: [
                    { name: 'User', value: `<@${userId}> (${username})`, inline: false },
                    { name: 'Verified at', value: `<t:${timestamp}:F>`, inline: false },
                    { name: 'Note', value: 'User left and re-verified with the same account.', inline: false }
                ]
            });
        } else {
            await postLogEmbed({
                color: 0x2ECC71,
                title: '✅ New Verification',
                fields: [
                    { name: 'User', value: `<@${userId}> (${username})`, inline: false },
                    { name: 'Verified at', value: `<t:${timestamp}:F>`, inline: false }
                ]
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[VERIFY API] Error:', err.message);
        res.status(500).json({ error: 'Verification failed. Please try again or contact staff.' });
    }
});

module.exports = router;
