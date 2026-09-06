const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('../db');

(async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS snooper_log (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                ip TEXT,
                country TEXT,
                city TEXT,
                asn TEXT,
                cf_ray TEXT,
                bot_score TEXT,
                threat_score TEXT,
                user_agent TEXT,
                accept_language TEXT,
                referer TEXT,
                request_method TEXT,
                request_path TEXT,
                fingerprint_hash TEXT UNIQUE,
                browser TEXT,
                os TEXT,
                device TEXT,
                headers JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await db.query('CREATE INDEX IF NOT EXISTS idx_snooper_created ON snooper_log(created_at DESC)');
        console.log('[SNOOPER] Table ready');
    } catch (e) {
        console.error('[SNOOPER] Table init failed:', e.message);
    }
})();

function parseUA(ua) {
    const uaStr = (ua || '').toLowerCase();
    let browser = 'Unknown';
    let os = 'Unknown';
    let device = 'Desktop';

    if (uaStr.includes('firefox')) browser = 'Firefox';
    else if (uaStr.includes('edg/')) browser = 'Edge';
    else if (uaStr.includes('chrome')) browser = 'Chrome';
    else if (uaStr.includes('safari')) browser = 'Safari';
    else if (uaStr.includes('opera')) browser = 'Opera';
    else if (uaStr.includes('curl')) browser = 'curl';
    else if (uaStr.includes('python')) browser = 'Python';
    else if (uaStr.includes('bot')) browser = 'Bot';

    if (uaStr.includes('windows')) os = 'Windows';
    else if (uaStr.includes('mac os')) os = 'macOS';
    else if (uaStr.includes('linux')) os = 'Linux';
    else if (uaStr.includes('android')) { os = 'Android'; device = 'Mobile'; }
    else if (uaStr.includes('iphone') || uaStr.includes('ipad')) { os = 'iOS'; device = 'Mobile'; }

    return { browser, os, device };
}

function getFingerprint(req) {
    const parts = [
        req.headers['user-agent'] || '',
        req.headers['accept-language'] || '',
        req.headers['accept-encoding'] || '',
        req.headers['sec-ch-ua'] || '',
        req.headers['sec-ch-ua-platform'] || ''
    ].join('|');
    return crypto.createHash('sha256').update(parts).digest('hex');
}

function getClientIp(req) {
    return req.headers['cf-connecting-ip']
        || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.headers['x-real-ip']
        || req.ip;
}

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API - disc-tools.de</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #0a0a0a;
            color: #e0e0e0;
            font-family: 'Courier New', monospace;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            text-align: center;
            padding: 1rem;
        }
        .container {
            max-width: 640px;
            padding: 2rem 1rem;
        }
        .status { color: #ff4444; font-size: 1.2rem; margin-bottom: 1rem; }
        .code { color: #5865F2; font-size: 5rem; font-weight: bold; margin-bottom: 0.5rem; }
        h1 { color: #fff; font-size: 1.5rem; margin-bottom: 1.5rem; line-height: 1.3; }
        p { color: #888; line-height: 1.6; margin-bottom: 1rem; }
        .data { color: #666; font-size: 0.75rem; margin-top: 2rem; line-height: 1.8; max-width: 500px; margin-left: auto; margin-right: auto; text-align: left; }
        .data span { color: #e0e0e0; font-family: monospace; }
        .data .lbl { color: #5865F2; }
        hr { border: none; border-top: 1px solid #1a1a1a; margin: 2rem 0 1rem; }
        .blink { animation: blink 1s steps(2) infinite; }
        @keyframes blink { 50% { opacity: 0; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="status">● ACCESS DENIED</div>
        <div class="code">403</div>
        <h1>What exactly did you think<br>you'd find here, dumbass?</h1>
        <p>This is an <strong>internal API gateway</strong>, not a petting zoo.<br>Nothing to see, nothing to scrape, nothing to exploit.</p>
        <p>If you're a bot: beep boop fuck off.<br>If you're a human: why are you even here?</p>
        <hr>
        <div class="data">
            <div><span class="lbl">IP:</span> <span>{{IP}}</span></div>
            <div><span class="lbl">Country:</span> <span>{{COUNTRY}}</span></div>
            <div><span class="lbl">CF Ray:</span> <span>{{CF_RAY}}</span> &nbsp; <span class="lbl">Bot:</span> <span>{{BOT_SCORE}}</span></div>
            <div><span class="lbl">Browser:</span> <span>{{BROWSER}}</span> &nbsp; <span class="lbl">OS:</span> <span>{{OS}}</span> &nbsp; <span class="lbl">Device:</span> <span>{{DEVICE}}</span></div>
            <div style="margin-top:.5rem;font-size:.65rem;word-break:break-all"><span class="lbl">FP:</span> <span>{{FINGERPRINT}}</span></div>
            <div style="margin-top:.5rem;font-size:.65rem"><span class="lbl">ID:</span> <span>{{ID}}</span></div>
        </div>
        <p style="margin-top:1.5rem;font-size:.75rem">Your visit has been logged and reported.<span class="blink">_</span></p>
    </div>
</body>
</html>`;

router.get('/snoop', async (req, res) => {
    const ip = getClientIp(req);
    const fingerprint = getFingerprint(req);
    const ua = req.headers['user-agent'] || 'Unknown';
    const parsed = parseUA(ua);

    const data = {
        ip: ip || 'Unknown',
        country: req.headers['cf-ipcountry'] || 'Unknown',
        city: req.headers['cf-ipcity'] || 'Unknown',
        asn: req.headers['cf-asorganization'] || 'Unknown',
        cf_ray: req.headers['cf-ray'] || 'N/A',
        bot_score: req.headers['cf-bot-score'] || 'N/A',
        threat_score: req.headers['cf-threat-score'] || 'N/A',
        user_agent: ua,
        accept_language: req.headers['accept-language'] || 'Unknown',
        referer: req.headers['referer'] || 'None (direct)',
        request_method: req.method,
        request_path: req.originalUrl || req.url
    };

    let logId = 'ERROR';
    try {
        const result = await db.query(`
            INSERT INTO snooper_log (ip, country, city, asn, cf_ray, bot_score, threat_score,
                user_agent, accept_language, referer, request_method, request_path,
                fingerprint_hash, browser, os, device, headers)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            ON CONFLICT (fingerprint_hash) DO UPDATE SET
                ip = EXCLUDED.ip,
                country = EXCLUDED.country,
                city = EXCLUDED.city,
                asn = EXCLUDED.asn,
                cf_ray = EXCLUDED.cf_ray,
                bot_score = EXCLUDED.bot_score,
                threat_score = EXCLUDED.threat_score,
                user_agent = EXCLUDED.user_agent,
                accept_language = EXCLUDED.accept_language,
                referer = EXCLUDED.referer,
                request_method = EXCLUDED.request_method,
                request_path = EXCLUDED.request_path,
                browser = EXCLUDED.browser,
                os = EXCLUDED.os,
                device = EXCLUDED.device,
                headers = EXCLUDED.headers,
                created_at = NOW()
            RETURNING id
        `, [
            data.ip, data.country, data.city, data.asn,
            data.cf_ray, data.bot_score, data.threat_score,
            data.user_agent, data.accept_language, data.referer,
            data.request_method, data.request_path,
            fingerprint, parsed.browser, parsed.os, parsed.device,
            JSON.stringify({ 'x-forwarded-for': req.headers['x-forwarded-for'] || null })
        ]);
        logId = result.rows[0].id;
    } catch (e) {
        console.error('[SNOOPER] DB insert failed:', e.message);
    }

    let html = PAGE
        .replace(/{{IP}}/g, data.ip)
        .replace(/{{COUNTRY}}/g, data.country)
        .replace(/{{CITY}}/g, data.city)
        .replace(/{{ASN}}/g, data.asn)
        .replace(/{{BROWSER}}/g, parsed.browser)
        .replace(/{{OS}}/g, parsed.os)
        .replace(/{{DEVICE}}/g, parsed.device)
        .replace(/{{CF_RAY}}/g, data.cf_ray)
        .replace(/{{BOT_SCORE}}/g, data.bot_score)
        .replace(/{{FINGERPRINT}}/g, fingerprint.substring(0, 32) + '...')
        .replace(/{{ID}}/g, logId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

router.get('/snoop/logs', async (req, res) => {
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    if (!isLocal) return res.status(403).json({ error: 'Not authorized' });

    try {
        const { rows } = await db.query(
            'SELECT * FROM snooper_log ORDER BY created_at DESC LIMIT 200'
        );
        res.json({ total: rows.length, logs: rows });
    } catch (e) {
        res.status(500).json({ error: 'Query failed' });
    }
});

router.get('/snoop/stats', async (req, res) => {
    const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    if (!isLocal) return res.status(403).json({ error: 'Not authorized' });

    try {
        const [count, unique, countries, browsers, last24] = await Promise.all([
            db.query('SELECT COUNT(*) FROM snooper_log'),
            db.query('SELECT COUNT(DISTINCT fingerprint_hash) FROM snooper_log'),
            db.query('SELECT country, COUNT(*) as cnt FROM snooper_log WHERE country IS NOT NULL GROUP BY country ORDER BY cnt DESC LIMIT 20'),
            db.query('SELECT browser, os, device, COUNT(*) as cnt FROM snooper_log GROUP BY browser, os, device ORDER BY cnt DESC LIMIT 10'),
            db.query("SELECT COUNT(*) FROM snooper_log WHERE created_at > NOW() - INTERVAL '24 hours'")
        ]);
        res.json({
            total_requests: parseInt(count.rows[0].count),
            unique_fingerprints: parseInt(unique.rows[0].count),
            last_24h: parseInt(last24.rows[0].count),
            top_countries: countries.rows,
            top_clients: browsers.rows
        });
    } catch (e) {
        res.status(500).json({ error: 'Query failed' });
    }
});

module.exports = router;
