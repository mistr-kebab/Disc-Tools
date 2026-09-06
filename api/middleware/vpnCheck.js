const axios = require('axios');
const db = require('../db');
const { hashIP, hashIPLegacy } = require('../utils/ip');

const vpnCache = new Map();
const CACHE_TTL_VPN = 5 * 60 * 1000;
const CACHE_TTL_CLEAN = 30 * 60 * 1000;

const EXCLUDED_PATHS = [
    '/security/vpn-check',
    '/security/ban-check',
    '/auth/login',
    '/auth/callback',
    '/auth/logout',
    '/auth/me',
    '/team',
    '/announcements',
    '/stats/track',
    '/stats/popular',
    '/track/view',
    '/partners',
    '/profiles',
    '/verify',
    '/username-history/eligibility',
    '/user-lookup/eligibility',
    '/username-history/optout',
    '/username-history/optout/status',
    '/admin'
];

function isExcluded(path) {
    return EXCLUDED_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

function getClientIp(req) {
    let ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;
    if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.split(':').pop();
    return ip;
}

async function checkVpn(ip) {
    const cached = vpnCache.get(ip);
    if (cached) {
        const age = Date.now() - cached.timestamp;
        const ttl = cached.isVpn ? CACHE_TTL_VPN : CACHE_TTL_CLEAN;
        if (age < ttl) return cached;
        vpnCache.delete(ip);
    }

    if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
        const result = { isVpn: false, type: 'Local' };
        vpnCache.set(ip, { ...result, timestamp: Date.now() });
        return result;
    }

    try {
        const response = await axios.get(`https://proxycheck.io/v2/${ip}?vpn=1&asn=1`, { timeout: 3000 });
        const data = response.data;

        if (data.status !== 'ok') {
            return { isVpn: false, type: 'Unknown', error: 'API Status Error' };
        }

        const ipData = data[ip];
        if (!ipData) {
            return { isVpn: false, type: 'Unknown', error: 'IP not found' };
        }

        const isVpn = ipData.proxy === 'yes' || ipData.type === 'VPN' || ipData.type === 'Proxy' || ipData.type === 'Hosting';
        const result = { isVpn, type: ipData.type || 'Unknown', provider: ipData.provider || 'Unknown' };

        vpnCache.set(ip, { ...result, timestamp: Date.now() });
        return result;
    } catch (err) {
        console.error(`[VPN MIDDLEWARE] Check failed for ${ip}:`, err.message);
        return { isVpn: false, type: 'Unknown', error: 'Fetch failed' };
    }
}

async function checkIpBanned(req, res, next) {
    const ip = getClientIp(req);
    if (ip === '::1' || ip === '127.0.0.1') return next();

    const hmacHash = hashIP(ip);
    const legacyHash = hashIPLegacy(ip);

    try {
        const result = await db.query(
            'SELECT user_id FROM blocked_ips WHERE ip_hash IN ($1, $2) LIMIT 1',
            [hmacHash, legacyHash]
        );
        if (result.rows.length > 0) {
            console.warn(`[IP BANNED] ${req.method} ${req.path} from ${ip} (user ${result.rows[0].user_id})`);
            return res.status(403).json({
                error: 'Access denied',
                detail: 'Your IP address has been banned.'
            });
        }
    } catch (err) {
        console.error('[IP BAN CHECK] DB error:', err.message);
    }

    next();
}

async function vpnMiddleware(req, res, next) {
    if (isExcluded(req.path)) return next();

    // Check IP ban first (applies to everyone, even logged-in)
    const ip = getClientIp(req);
    if (ip !== '::1' && ip !== '127.0.0.1') {
        const hmacHash = hashIP(ip);
        const legacyHash = hashIPLegacy(ip);
        try {
            const banResult = await db.query(
                'SELECT user_id FROM blocked_ips WHERE ip_hash IN ($1, $2) LIMIT 1',
                [hmacHash, legacyHash]
            );
            if (banResult.rows.length > 0) {
                console.warn(`[IP BANNED] ${req.method} ${req.path} from ${ip} (user ${banResult.rows[0].user_id})`);
                return res.status(403).json({
                    error: 'Access denied',
                    detail: 'Your IP address has been banned.'
                });
            }
        } catch (err) {
            console.error('[IP BAN CHECK] DB error:', err.message);
        }
    }

    // Authenticated users skip VPN check
    const token = req.cookies?.token;
    if (token) {
        try {
            const jwt = require('jsonwebtoken');
            jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
            return next();
        } catch (e) {}
    }

    const result = await checkVpn(ip);

    if (result.isVpn) {
        console.warn(`[VPN BLOCKED] ${req.method} ${req.path} from ${ip} (${result.type})`);
        return res.status(403).json({
            error: 'VPN/Proxy access restricted',
            detail: `${result.type} detected from your IP. Log in with Discord to bypass.`
        });
    }

    next();
}

module.exports = vpnMiddleware;
