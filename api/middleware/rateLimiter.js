const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS = 120;

const PATH_LIMITS = [
    { paths: ['/api/auth/login', '/api/auth/callback', '/api/auth/logout'], max: 10, window: 60 * 1000 },
    { paths: ['/api/lookup', '/api/discord/guilds', '/api/discord/users'], max: 30, window: 60 * 1000 },
    { paths: ['/api/gifs'], max: 60, window: 60 * 1000 },
    { paths: ['/api/topgg/webhook'], max: 30, window: 60 * 1000 },
    { paths: ['/api/username-history'], max: 10, window: 60 * 1000 },
    { paths: ['/api/user-lookup'], max: 10, window: 60 * 1000 },
];

function getLimitConfig(path) {
    for (const cfg of PATH_LIMITS) {
        if (cfg.paths.some(p => path === p || path.startsWith(p + '/') || path.startsWith(p))) {
            return cfg;
        }
    }
    return { max: MAX_REQUESTS, window: RATE_LIMIT_WINDOW };
}

const CLEANUP_INTERVAL = 5 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of rateLimitMap.entries()) {
        const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW * 2);
        if (valid.length === 0) {
            rateLimitMap.delete(key);
        } else {
            rateLimitMap.set(key, valid);
        }
    }
}, CLEANUP_INTERVAL);

function rateLimitMiddleware(req, res, next) {
    const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.ip;
    const now = Date.now();
    const config = getLimitConfig(req.path);
    const mapKey = `${ip}:${req.path}`;

    if (!rateLimitMap.has(mapKey)) {
        rateLimitMap.set(mapKey, []);
    }

    let timestamps = rateLimitMap.get(mapKey);
    timestamps = timestamps.filter(t => now - t < config.window);

    if (timestamps.length >= config.max) {
        const retryAfter = Math.ceil((timestamps[0] + config.window - now) / 1000);
        console.warn(`[SECURITY] Rate limit exceeded by IP: ${ip} on ${req.method} ${req.path}`);
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: 'Too many requests',
            retryAfterSeconds: retryAfter
        });
    }

    timestamps.push(now);
    rateLimitMap.set(mapKey, timestamps);
    next();
}

module.exports = rateLimitMiddleware;
