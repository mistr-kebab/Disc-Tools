const apiCache = new Map();
const rateLimitCache = new Map();

const DISCORD_HEADERS = {
    'User-Agent': 'curl/8.5.0',
    'Accept': '*/*'
};

/**
 * Fetch from Discord API with auto-retry on rate limit
 * @param {string} url - Discord API URL
 * @param {string} token - Bot or User token
 * @param {string} type - Authorization type: 'Bot ' or 'Bearer '
 * @returns {Promise} API response
 */
async function discordFetch(url, token, type = '', maxRetries = 2) {
    const cacheKey = `${url}:${token}:${type}`;

    // Check Rate Limit Cache
    if (rateLimitCache.has(cacheKey)) {
        const cooldown = rateLimitCache.get(cacheKey);
        if (Date.now() < cooldown) throw new Error('Rate limit active in cache');
        rateLimitCache.delete(cacheKey);
    }

    // Check Data Cache
    if (apiCache.has(cacheKey)) {
        const { data, timestamp } = apiCache.get(cacheKey);
        if (Date.now() - timestamp < 300000) return data; // 5 minute cache
    }

    for (let i = 0; i <= maxRetries; i++) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `${type}${token}`,
                    ...DISCORD_HEADERS
                }
            });

            if (response.status === 429) {
                const data = await response.json().catch(() => ({}));
                const retryAfter = (data.retry_after || 1) * 1000;
                rateLimitCache.set(cacheKey, Date.now() + retryAfter);
                console.warn(`[RATE LIMIT] ${url} - Retrying in ${retryAfter}ms`);
                await new Promise(r => setTimeout(r, retryAfter));
                continue;
            }

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                console.error(`[DISCORD API] ${url} - Status ${response.status}:`, data);
                const err = new Error(`Discord API Error: ${response.status}`);
                err.response = { status: response.status, data };
                throw err;
            }

            const result = await response.json();
            apiCache.set(cacheKey, { data: result, timestamp: Date.now() });
            return result;
        } catch (err) {
            if (i === maxRetries) throw err;
            if (!err.response || err.response.status !== 429) throw err;
        }
    }
}

module.exports = { discordFetch, apiCache, rateLimitCache };
