const tmi = require('tmi.js');
const axios = require('axios');

const CHANNEL = process.env.TWITCH_CHANNEL || 'mistr_kebab';
const BOT_USERNAME = process.env.TWITCH_BOT_USERNAME;
const BOT_OAUTH_TOKEN = process.env.TWITCH_BOT_OAUTH_TOKEN;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

const ADS = [
    '⚙️ Running a Discord server? disc-tools.de has free tools like embed builder, color picker & avatar generator!',
    '🔧 Need a webhook manager or emoji stealer? Try disc-tools.de - free Discord tools for everyone!',
    '📊 Check out disc-tools.de - server lookup, snowflake decoder, timestamp generator & many more free tools!',
    '🎨 Build perfect embeds with the visual embed builder at disc-tools.de - super easy & free!',
    '⚡ disc-tools.de - your all-in-one toolkit for Discord: markdown generator, webhook manager & more!',
    '🛠️ From nitro checker to invite lookup - disc-tools.de has every Discord tool you\'ll ever need. Free!',
    '💻 Level up your Discord game with disc-tools.de - try our tools today, all 100%% free!',
    '🔍 Server lookup, user lookup, username history - disc-tools.de makes Discord investigation easy!'
];

let appAccessToken = null;
let tokenExpiresAt = 0;
let isLive = false;
let adInterval = null;
let liveCheckInterval = null;
let lastAdIndex = -1;

async function getAppAccessToken() {
    if (appAccessToken && Date.now() < tokenExpiresAt) return appAccessToken;

    try {
        const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
            params: {
                client_id: TWITCH_CLIENT_ID,
                client_secret: TWITCH_CLIENT_SECRET,
                grant_type: 'client_credentials'
            }
        });
        appAccessToken = res.data.access_token;
        tokenExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;
        console.log('[TWITCH-BOT] App access token obtained');
        return appAccessToken;
    } catch (err) {
        console.error('[TWITCH-BOT] Failed to get app access token:', err.message);
        return null;
    }
}

async function checkLiveStatus() {
    const token = await getAppAccessToken();
    if (!token) return false;

    try {
        const res = await axios.get('https://api.twitch.tv/helix/streams', {
            headers: {
                'Client-Id': TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${token}`
            },
            params: { user_login: CHANNEL }
        });

        const live = res.data.data && res.data.data.length > 0;

        if (live && !isLive) {
            console.log(`[TWITCH-BOT] ${CHANNEL} is now LIVE!`);
            isLive = true;
            startAds();
        } else if (!live && isLive) {
            console.log(`[TWITCH-BOT] ${CHANNEL} went offline`);
            isLive = false;
            stopAds();
        }

        return live;
    } catch (err) {
        console.error('[TWITCH-BOT] Live check failed:', err.message);
        return false;
    }
}

function startAds() {
    if (adInterval) return;
    console.log('[TWITCH-BOT] Starting ad rotation');
    postAd();
    adInterval = setInterval(postAd, 30 * 60 * 1000);
}

function stopAds() {
    if (adInterval) {
        clearInterval(adInterval);
        adInterval = null;
        console.log('[TWITCH-BOT] Stopped ad rotation');
    }
}

function postAd() {
    try {
        if (!client || typeof client.readyState !== 'function' || client.readyState() !== 'OPEN') return;
    } catch (e) {
        return;
    }

    let idx;
    do {
        idx = Math.floor(Math.random() * ADS.length);
    } while (idx === lastAdIndex && ADS.length > 1);
    lastAdIndex = idx;

    const message = ADS[idx];
    client.say(CHANNEL, message)
        .then(() => console.log(`[TWITCH-BOT] Ad posted: ${message}`))
        .catch(err => console.error('[TWITCH-BOT] Failed to post ad:', err.message));
}

const client = new tmi.Client({
    identity: {
        username: BOT_USERNAME,
        password: BOT_OAUTH_TOKEN
    },
    channels: [CHANNEL]
});

client.on('connected', () => {
    console.log(`[TWITCH-BOT] Connected to #${CHANNEL} as ${BOT_USERNAME}`);

    liveCheckInterval = setInterval(checkLiveStatus, 5 * 60 * 1000);
    checkLiveStatus();
});

client.on('disconnected', (reason) => {
    console.log(`[TWITCH-BOT] Disconnected: ${reason}`);
    isLive = false;
    stopAds();
    setTimeout(() => {
        console.log('[TWITCH-BOT] Reconnecting...');
        client.connect().catch(err => console.error('[TWITCH-BOT] Reconnect failed:', err.message));
    }, 10000);
});

const RESPONSES = {
    '!discord': '💬 Join our Discord server: https://discord.gg/fuhjXKXbeJ',
    '!website': '🌐 disc-tools.de - Free tools, guides & resources for the Discord community!',
    '!about': 'ℹ️ disc-tools.de provides free Discord tools like embed builder, server lookup, emoji stealer & more. Built with ❤️ for the Discord community!',
    '!premium': '⭐ disc-tools.de is currently free for everyone! Some advanced features may require premium in the future. Stay tuned!'
};

const COMMANDS = new Map();
for (const [cmd, resp] of Object.entries(RESPONSES)) {
    COMMANDS.set(cmd, resp);
}
COMMANDS.set('!tools', null);
COMMANDS.set('!discordtools', null);

client.on('message', (channel, tags, message, self) => {
    try {
        if (self) return;

        const cmd = message.toLowerCase().trim();
        const response = COMMANDS.get(cmd);
        if (response) {
            client.say(channel, response).catch(err => console.error('[TWITCH-BOT] say failed:', err));
        } else if (cmd === '!tools' || cmd === '!discordtools') {
            const ad = ADS[Math.floor(Math.random() * ADS.length)];
            client.say(channel, ad).catch(err => console.error('[TWITCH-BOT] say failed:', err));
        }
    } catch (err) {
        console.error('[TWITCH-BOT] message handler error:', err.message);
    }
});

function start() {
    if (!BOT_USERNAME || !BOT_OAUTH_TOKEN) {
        console.log('[TWITCH-BOT] Not configured (TWITCH_BOT_USERNAME or TWITCH_BOT_OAUTH_TOKEN missing). Skipping start.');
        return;
    }

    client.connect().catch(err => {
        console.error('[TWITCH-BOT] Initial connection failed:', err.message);
        setTimeout(() => start(), 30000);
    });
}

module.exports = { start, stop: () => {
    stopAds();
    if (liveCheckInterval) clearInterval(liveCheckInterval);
    if (client) client.disconnect();
}};
