const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');

const AD_TEXT_FILE = path.join(__dirname, '../../partner/partner_ad.txt');

function getFeatures() {
    try {
        const content = fs.readFileSync(AD_TEXT_FILE, 'utf-8');
        const features = [];
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('---') || trimmed.startsWith('*Want')) continue;
            const clean = trimmed.replace(/^\s*[•*]\s*/, '').replace(/\*{1,2}/g, '').trim();
            if (!clean) continue;
            if (clean.match(/^https?:\/\//)) {
                features.push('🌐 ' + clean);
            } else if (clean.startsWith('**') || clean.includes(':**')) {
                features.push(clean.replace(/\*{1,2}/g, '').replace(/:$/, ''));
            } else if (clean.startsWith('•')) {
                const item = clean.replace(/^•\s*/, '').trim();
                if (item) features.push('▸ ' + item);
            } else {
                features.push(clean);
            }
        }
        return features.length > 0 ? features : ['Disc-Tools ⚡ The ultimate Discord toolkit'];
    } catch {
        return ['Disc-Tools ⚡ The ultimate Discord toolkit'];
    }
}

const slogans = [
    'The ultimate Discord all-in-one toolkit',
    'Fully browser-based \u2013 no download required',
    '<i class="fa-solid fa-wrench"></i> Webhook Manager & Embed Builder',
    '<i class="fa-solid fa-image"></i> Avatar & Banner CDN Generator',
    '<i class="fa-solid fa-magnifying-glass"></i> Server & Invite Lookup',
    '<i class="fa-regular fa-face-smile"></i> Emoji & Sticker Stealer',
    '<i class="fa-regular fa-snowflake"></i> Snowflake Decoder, Color Picker, Timestamp Generator',
    '<i class="fa-solid fa-pen"></i> Markdown Generator for fancy messages',
    '<i class="fa-solid fa-shield"></i> Nitro Gift Safety Checker',
    '<i class="fa-solid fa-book"></i> Security Guides \u2013 spot token grabbers',
    '<i class="fa-solid fa-bolt"></i> Fast, clean, mobile-friendly',
    '<i class="fa-solid fa-rotate"></i> Weekly updates & new features',
    '<i class="fa-solid fa-globe"></i> Available in English & German',
    '<i class="fa-solid fa-lock"></i> No sensitive data stored \u2013 only OAuth2',
    '<i class="fa-solid fa-crown"></i> disc-tools.de'
];

const messages = [...getFeatures(), ...slogans];

router.get('/tiktok-ad', (req, res) => {
    const bg = req.query.bg || 'transparent';
    const color = req.query.color || '#ffffff';
    const size = parseInt(req.query.size) || 34;
    const interval = parseInt(req.query.interval) || 3000;
    const align = req.query.align || 'center';
    const font = req.query.font || 'Inter, system-ui, sans-serif';
    const accent = req.query.accent || '#5865F2';
    const card = req.query.card !== undefined ? req.query.card : 'rgba(0,0,0,0.75)';
    const radius = parseInt(req.query.radius) || 16;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Disc-Tools</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
    width: 100%; height: 100%;
    background: ${bg};
    font-family: ${font};
    overflow: hidden;
}
body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}
#card {
    background: ${card};
    border-radius: ${radius}px;
    padding: ${Math.round(size * 0.6)}px ${Math.round(size * 0.8)}px;
    width: ${Math.round(size * 18)}px;
    min-height: ${Math.round(size * 4.5)}px;
    display: flex;
    flex-direction: column;
    align-items: ${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};
    justify-content: center;
    text-align: ${align};
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
#logo {
    margin-bottom: ${Math.round(size * 0.35)}px;
    display: flex;
    align-items: center;
    justify-content: ${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};
    gap: 12px;
}
#logo img {
    height: ${Math.round(size * 0.9)}px;
    width: auto;
    border-radius: 10px;
    flex-shrink: 0;
}
#logo .dt {
    font-size: ${Math.round(size * 0.75)}px;
    font-weight: 800;
    letter-spacing: -0.5px;
    color: ${accent};
}
#line {
    font-size: ${size}px;
    font-weight: 700;
    line-height: 1.35;
    color: ${color};
    text-shadow: 0 2px 12px rgba(0,0,0,0.35);
    transition: opacity 0.4s ease, transform 0.4s ease;
    opacity: 0;
    transform: translateY(10px);
    min-height: 1.35em;
}
#line.show {
    opacity: 1;
    transform: translateY(0);
}
</style>
</head>
<body>
<div id="card">
    <div id="logo">
        <img src="https://disc-tools.de/assets/img/logo.png" alt="Disc-Tools" loading="lazy" onerror="this.style.display='none'">
        <span class="dt">Disc-Tools</span>
    </div>
    <div id="line"></div>
</div>
<script>
var items = ${JSON.stringify(messages)};
var i = 0;
var el = document.getElementById('line');

function show(idx) {
    el.innerHTML = items[idx % items.length];
    el.className = 'show';
}

function next() {
    el.className = '';
    setTimeout(function() {
        i = (i + 1) % items.length;
        show(i);
    }, 400);
}

show(0);
setInterval(next, ${interval});
</script>
</body>
</html>`);
});

router.get('/api/tiktok-ad', (req, res) => {
    res.redirect('/tiktok-ad?' + new URLSearchParams(req.query).toString());
});

router.get('/api/tiktok-ad/data', async (req, res) => {
    try {
        const features = getFeatures();
        const result = await db.query(
            `SELECT name, description, website, discord_server, logo
             FROM partners WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY RANDOM() LIMIT 1`
        );

        res.json({
            slogans,
            features,
            partner: result.rows[0] || null,
            all: [...features, ...slogans]
        });
    } catch (err) {
        console.error('[TIKTOK-AD] Data fetch failed:', err.message);
        res.json({ slogans, features: getFeatures(), all: [...getFeatures(), ...slogans] });
    }
});

module.exports = router;
