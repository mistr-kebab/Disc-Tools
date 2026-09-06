const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const GUILD_ID = process.env.GUILD_ID || '1502369884322136326';

const { discordFetch, apiCache } = require('../utils/discord');
const { getSpotifyCurrentlyListening, normalizeSpotifyEmbedUrl, normalizeSoundcloudEmbedUrl } = require('../utils/spotify');
const { PROVIDERS } = require('./connections');

const PROVIDER_CONFIG = {};
Object.keys(PROVIDERS).forEach(key => {
    const p = PROVIDERS[key];
    PROVIDER_CONFIG[key] = { icon: p.icon, color: p.color, name: p.name, url: (username) => {
        if (key === 'twitch') return `https://twitch.tv/${username}`;
        return `https://${key}.com/${username}`;
    }};
});

/** Public team pages served by nginx at /team/{username}/ */
const TEAM_PAGES_DIR = path.join(__dirname, '../../team');

function getTeamPageDir(username) {
    const safe = path.basename(String(username).toLowerCase());
    const resolved = path.resolve(TEAM_PAGES_DIR, safe);
    if (!resolved.startsWith(TEAM_PAGES_DIR)) {
        throw new Error('Invalid team page directory');
    }
    return resolved;
}

function resolveBannerForHtml(banner, discordBannerUrl) {
    const type = banner?.type || 'discord';
    if (type === 'color') return banner?.value || '#111118';
    if (type === 'image') return banner?.value || null;
    return discordBannerUrl || banner?.value || null;
}

const HOBBY_CONFIG = {
    music: { label: 'Music', icon: 'fa-solid fa-music' },
    movies: { label: 'Movies', icon: 'fa-solid fa-film' },
    gaming: { label: 'Gaming', icon: 'fa-solid fa-gamepad' },
    biking: { label: 'Biking', icon: 'fa-solid fa-bicycle' },
    hiking: { label: 'Hiking', icon: 'fa-solid fa-person-hiking' },
    cooking: { label: 'Cooking', icon: 'fa-solid fa-utensils' },
    reading: { label: 'Reading', icon: 'fa-solid fa-book' },
    photography: { label: 'Photography', icon: 'fa-solid fa-camera' },
    travel: { label: 'Travel', icon: 'fa-solid fa-plane' },
    fitness: { label: 'Fitness', icon: 'fa-solid fa-dumbbell' },
    art: { label: 'Art', icon: 'fa-solid fa-palette' },
    coding: { label: 'Coding', icon: 'fa-solid fa-code' },
    anime: { label: 'Anime', icon: 'fa-solid fa-star' },
    sports: { label: 'Sports', icon: 'fa-solid fa-trophy' },
    football: { label: 'Football', icon: 'fa-solid fa-futbol' },
    basketball: { label: 'Basketball', icon: 'fa-solid fa-basketball' },
    dancing: { label: 'Dancing', icon: 'fa-solid fa-music' },
    streaming: { label: 'Streaming', icon: 'fa-solid fa-tower-broadcast' },
    youtube: { label: 'YouTube', icon: 'fa-brands fa-youtube' },
    cats: { label: 'Cats', icon: 'fa-solid fa-cat' },
    dogs: { label: 'Dogs', icon: 'fa-solid fa-dog' },
    cars: { label: 'Cars', icon: 'fa-solid fa-car' },
    fashion: { label: 'Fashion', icon: 'fa-solid fa-shirt' },
    sneakers: { label: 'Sneakers', icon: 'fa-solid fa-shoe-prints' },
    skateboard: { label: 'Skateboarding', icon: 'fa-solid fa-person-skating' },
    swimming: { label: 'Swimming', icon: 'fa-solid fa-person-swimming' },
    yoga: { label: 'Yoga', icon: 'fa-solid fa-spa' },
    minecraft: { label: 'Minecraft', icon: 'fa-solid fa-cube' },
    chess: { label: 'Chess', icon: 'fa-solid fa-chess' },
    boxing: { label: 'Boxing', icon: 'fa-solid fa-hand-fist' }
};

const LINK_PLATFORM_CONFIG = {
    instagram: { name: 'Instagram', icon: 'fa-brands fa-instagram', url: username => `https://instagram.com/${username}` },
    twitter: { name: 'Twitter/X', icon: 'fa-brands fa-x-twitter', url: username => `https://x.com/${username}` },
    github: { name: 'GitHub', icon: 'fa-brands fa-github', url: username => `https://github.com/${username}` },
    youtube: { name: 'YouTube', icon: 'fa-brands fa-youtube', url: username => `https://youtube.com/@${username}` },
    twitch: { name: 'Twitch', icon: 'fa-brands fa-twitch', url: username => `https://twitch.tv/${username}` },
    tiktok: { name: 'TikTok', icon: 'fa-brands fa-tiktok', url: username => `https://tiktok.com/@${username}` },
    linkedin: { name: 'LinkedIn', icon: 'fa-brands fa-linkedin', url: username => `https://linkedin.com/in/${username}` },
    discord: { name: 'Discord', icon: 'fa-brands fa-discord', url: username => `https://discord.com/users/${username}` },
    steam: { name: 'Steam', icon: 'fa-brands fa-steam', url: username => `https://steamcommunity.com/id/${username}` },
    spotify: { name: 'Spotify', icon: 'fa-brands fa-spotify', url: username => `https://open.spotify.com/user/${username}` },
    soundcloud: { name: 'SoundCloud', icon: 'fa-brands fa-soundcloud', url: username => `https://soundcloud.com/${username}` },
    reddit: { name: 'Reddit', icon: 'fa-brands fa-reddit', url: username => `https://reddit.com/user/${username}` }
};

const TEAM_ROLES = [
    { id: '1503064097040629891', name: 'Founder', priority: 1, color: '#5865F2' },
    { id: '1503064197704061109', name: 'Co-Founder', priority: 2, color: '#4752C4' },
    { id: '1503064289915965621', name: 'Sr. Admin', priority: 3, color: '#E74C3C' },
    { id: '1503064343837937795', name: 'Admin', priority: 4, color: '#E67E22' },
    { id: '1503064391564791899', name: 'Sr. Moderator', priority: 5, color: '#F1C40F' },
    { id: '1503064448267718760', name: 'Moderator', priority: 6, color: '#2ECC71' },
    { id: '1503064501573124276', name: 'Developer', priority: 7, color: '#1ABC9C' },
    { id: '1503064547966058626', name: 'Helper', priority: 8, color: '#3498DB' }
];

const ALL_TEAM_ROLE_IDS = TEAM_ROLES.map(r => r.id);

async function checkTeamRole(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded;

        const cacheKey = `team_${decoded.id}`;
        if (apiCache.has(cacheKey)) {
            const cached = apiCache.get(cacheKey);
            if (Date.now() - cached.timestamp < 300000) {
                if (cached.isTeam) {
                    req.member = cached.member;
                    return next();
                }
                return res.status(403).json({ error: 'Access denied: Only team members can have a profile.' });
            }
        }

        if (!BOT_TOKEN) return res.status(503).json({ error: 'Discord bot connection unavailable' });

        const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${decoded.id}`, BOT_TOKEN, 'Bot ');
        const roles = member.roles || [];
        const isTeam = roles.some(r => ALL_TEAM_ROLE_IDS.includes(r));

        apiCache.set(cacheKey, { isTeam, member, timestamp: Date.now() });

        if (isTeam) {
            req.member = member;
            return next();
        }
        return res.status(403).json({ error: 'Access denied: Only team members can have a profile.' });
    } catch (err) {
        res.status(403).json({ error: 'Verification failed. Try logging in again.' });
    }
}

function getLinkUrl(link) {
    if (link.url) return link.url;
    const platform = LINK_PLATFORM_CONFIG[link.platform];
    if (platform && link.username) return platform.url(String(link.username).trim().replace(/^@+/, ''));
    return '#';
}

function getLinkDisplay(link) {
    const platform = LINK_PLATFORM_CONFIG[link.platform];
    const url = getLinkUrl(link);
    const normalizeHandle = (value) => {
        const clean = String(value || '').trim().replace(/^@+/, '').toLowerCase();
        return clean ? `@${clean}` : '';
    };
    const getWebsiteHandle = (url) => {
        try {
            return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
        } catch (e) {
            return '';
        }
    };
    const handler = platform ? normalizeHandle(link.username) : getWebsiteHandle(url);
    return {
        url,
        title: link.label || platform?.name || link.platform || url,
        handler,
        iconClass: platform?.icon || 'fa-solid fa-globe'
    };
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function generateProfileHtml(profile, avatar, banner, links, music, teamMembers, avatarDecorationAsset, showAvatarDecoration, connections) {
    const resolvedAvatar = avatar || profile.avatar || '';
    const displayName = profile.display_name || profile.username || '';
    const safeDisplayName = escapeHtml(displayName);
    const safeUsername = escapeHtml(profile.username || '');
    const bio = escapeHtml(profile.bio || '');
    const spotifyEmbedUrl = normalizeSpotifyEmbedUrl(music?.spotify_embed || '');
    const soundcloudEmbedUrl = normalizeSoundcloudEmbedUrl(music?.soundcloud_embed || '');

    const embedSections = [];
    if (spotifyEmbedUrl) {
        embedSections.push(`
      <section class="embed-block embed-block-spotify">
        <div class="embed-header"><span>Spotify Song</span></div>
        <div class="embed-frame embed-frame-spotify">
          <iframe src="${spotifyEmbedUrl}" width="100%" height="152" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen" loading="lazy" title="Spotify embed"></iframe>
        </div>
      </section>`);
    }
    if (soundcloudEmbedUrl) {
        embedSections.push(`
      <section class="embed-block embed-block-soundcloud">
        <div class="embed-header"><span>SoundCloud Track</span></div>
        <div class="embed-frame embed-frame-soundcloud">
          <iframe src="${soundcloudEmbedUrl}" width="100%" height="166" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen" loading="lazy" title="SoundCloud embed"></iframe>
        </div>
      </section>`);
    }

        const listeningScript = music?.currently_listening_enabled && music?.spotify_refresh_token
        ? `<script src="/js/spotify-listening.js" data-user-id="${escapeHtml(profile.user_id)}" data-layout="${escapeHtml(profile.spotify_listening_layout || 'card')}"></script>`
        : '';

    const linksById = {};
    (links || []).forEach(l => { if (l.id) linksById[l.id] = l; });
    const connsByProvider = {};
    (connections || []).forEach(c => { connsByProvider[c.provider] = c; });

    const verifiedOrder = Array.isArray(profile.verified_order) ? profile.verified_order : [];
    const renderedIds = new Set();
    const renderedProviders = new Set();

    const orderedItems = [];
    for (const entry of verifiedOrder) {
        if (linksById[entry] && !renderedIds.has(entry)) {
            orderedItems.push({ type: 'link', data: linksById[entry] });
            renderedIds.add(entry);
        } else if (connsByProvider[entry] && !renderedProviders.has(entry)) {
            orderedItems.push({ type: 'verified', data: connsByProvider[entry] });
            renderedProviders.add(entry);
        }
    }
    // Append any remaining links and connections not in verifiedOrder
    (links || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).forEach(l => {
        if (!renderedIds.has(l.id)) {
            orderedItems.push({ type: 'link', data: l });
        }
    });
    (connections || []).forEach(c => {
        if (!renderedProviders.has(c.provider)) {
            orderedItems.push({ type: 'verified', data: c });
        }
    });

    const linksHtml = orderedItems.map(item => {
        if (item.type === 'verified') {
            const c = item.data;
            const cfg = PROVIDER_CONFIG[c.provider];
            const accountUrl = cfg ? cfg.url(c.provider_username) : '#';
            const iconClass = cfg ? cfg.icon : 'fa-solid fa-link';
            const name = cfg ? cfg.name : c.provider;
            return `<a href="${escapeHtml(accountUrl)}" target="_blank" rel="noopener noreferrer" class="profile-link"><i class="${iconClass} profile-link-icon"></i><span class="profile-link-text"><span class="profile-link-title">${escapeHtml(name)} <span style="color:#2ecc71;font-size:11px;font-weight:600;">✓ Verified</span></span><span class="profile-link-handle">@${escapeHtml(c.provider_username)}</span></span></a>`;
        }
        const l = item.data;
        const isCustom = !l.platform;
        const linkDisplay = getLinkDisplay(l);
        if (isCustom) {
            let favIcon = l.icon || '';
            if (!favIcon) {
                try { favIcon = linkDisplay.url ? `https://icons.duckduckgo.com/ip3/${new URL(linkDisplay.url).hostname}.ico` : ''; } catch(e) {}
            }
            return `<a href="${escapeHtml(linkDisplay.url)}" target="_blank" rel="noopener noreferrer" class="profile-link"><img src="${escapeHtml(favIcon)}" class="profile-link-icon" style="width:22px;height:22px;border-radius:4px;" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'"><span class="profile-link-text"><span class="profile-link-title">${escapeHtml(linkDisplay.title)}</span>${linkDisplay.handler ? `<span class="profile-link-handle">${escapeHtml(linkDisplay.handler)}</span>` : ''}</span></a>`;
        }
        return `<a href="${escapeHtml(linkDisplay.url)}" target="_blank" rel="noopener noreferrer" class="profile-link"><i class="${escapeHtml(linkDisplay.iconClass)} profile-link-icon"></i><span class="profile-link-text"><span class="profile-link-title">${escapeHtml(linkDisplay.title)}</span>${linkDisplay.handler ? `<span class="profile-link-handle">${escapeHtml(linkDisplay.handler)}</span>` : ''}</span></a>`;
    }).join('\n');

    const bannerStyle = banner
        ? banner.startsWith('http')
            ? `background-image:url('${escapeHtml(banner)}'); background-size:cover; background-position:center;`
            : banner.startsWith('#')
                ? `background:${escapeHtml(banner)};`
                : `background:${escapeHtml(banner)};`
        : 'background: linear-gradient(135deg, rgba(17,17,24,0.9), rgba(9,11,17,0.9));';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeDisplayName} (@${safeUsername}) | Disc-Tools Team</title>
  <meta name="description" content="${bio}">
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>
  <body>
    <main class="profile-container" style="--accent: ${escapeHtml(profile.accent_color || '#5865F2')}">
      <section class="profile-card layout-${profile.layout || 'centered'}">
        <div class="profile-banner" style="${bannerStyle}"></div>
      <div class="profile-content">
        <div class="profile-header-flex">
          <div class="profile-avatar-section">
            <div class="profile-avatar-wrapper">
              <img src="${resolvedAvatar}" alt="${safeDisplayName}" class="profile-avatar">
              ${avatarDecorationAsset && showAvatarDecoration !== false ? `<div class="profile-avatar-decoration"><img src="https://cdn.discordapp.com/avatar-decoration-presets/${escapeHtml(avatarDecorationAsset)}.png" alt="" onerror="this.parentElement.style.display='none'"></div>` : ''}
            </div>
          </div>
          <div class="profile-info-section">
            <div class="profile-name-row">
              <div class="profile-main-info">
                <h2>${safeDisplayName}</h2>
                <div class="username">@${safeUsername}</div>
              </div>
            </div>
            <p class="profile-bio">${bio}</p>
          </div>
        </div>
        <div id="spotify-now-playing" class="currently-playing-card" style="display:none;"></div>
        ${profile.hobbies && profile.hobbies.length > 0 ? `
        <div class="profile-hobbies">
          ${profile.hobbies.map(h => {
            const cfg = HOBBY_CONFIG[h];
            return cfg ? `<span class="hobby-pill-static"><i class="${cfg.icon}"></i> ${escapeHtml(cfg.label)}</span>` : '';
          }).join('')}
        </div>` : ''}
        <div class="links">${linksHtml}</div>
        ${embedSections.join('\n')}
        ${teamMembers && teamMembers.length > 0 ? `
        <section class="profile-team-members">
          <h3 class="team-members-title">Team Members</h3>
          <div class="team-members-grid">
            ${teamMembers.map(m => `
              <a href="/team/${escapeHtml(m.username)}/" class="team-member-card" style="--member-accent: ${escapeHtml(m.accentColor || '#5865F2')}">
                <img src="${escapeHtml(m.avatar)}" alt="${escapeHtml(m.displayName)}" class="team-member-avatar" loading="lazy">
                <div class="team-member-info">
                  <span class="team-member-name">${escapeHtml(m.displayName)}</span>
                  <span class="team-member-handle">@${escapeHtml(m.username)}</span>
                </div>
              </a>
            `).join('\n')}
          </div>
        </section>` : ''}
      </div>
    </section>
  </main>
  ${listeningScript}
</body>
</html>`;
}

// --- GET /api/team/profiles - Fetch all public profiles ---
router.get('/team/profiles', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT p.*, COALESCE(json_agg(pl) FILTER (WHERE pl.id IS NOT NULL), '[]') as links
             FROM profiles p
             LEFT JOIN profile_links pl ON p.user_id = pl.user_id
             WHERE p.visibility = $1 AND p.activated = $2
             GROUP BY p.user_id
             ORDER BY p.created_at DESC`,
            ['public', true]
        );

        const resolved = [];
        for (const profile of result.rows) {
            let avatar = profile.avatar;
            let role = { name: 'Member', color: '#5865F2' };

            try {
                const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${profile.user_id}`, BOT_TOKEN, 'Bot ');
                const avatarExt = member.user.avatar && member.user.avatar.startsWith('a_') ? 'gif' : 'png';
                avatar = member.user.avatar
                    ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.${avatarExt}?size=256`
                    : `https://cdn.discordapp.com/embed/avatars/${(parseInt(member.user.id) >> 22) % 6}.png`;

                const memberRoles = member.roles || [];
                const matchingRoles = TEAM_ROLES.filter(r => memberRoles.includes(r.id));
                if (matchingRoles.length > 0) {
                    role = matchingRoles.sort((a, b) => a.priority - b.priority)[0];
                }
            } catch (e) {}

            resolved.push({
                userId: profile.user_id,
                username: profile.username,
                displayName: profile.display_name,
                avatar,
                role,
                bio: profile.bio,
                accentColor: profile.accent_color,
                layout: profile.layout,
                featured: profile.featured
            });
        }

        res.json(resolved);
    } catch (err) {
        console.error('[PROFILES] Fetch all failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch profiles' });
    }
});

// --- GET /api/team/profiles/featured - Fetch featured profiles ---
router.get('/team/profiles/featured', async (req, res) => {
    try {
        const excludeUsername = (req.query.exclude || '').toString().toLowerCase();

        const result = await db.query(
            `SELECT p.*, COALESCE(json_agg(pl) FILTER (WHERE pl.id IS NOT NULL), '[]') as links
             FROM profiles p
             LEFT JOIN profile_links pl ON p.user_id = pl.user_id
             WHERE p.visibility = $1 AND p.featured = $2 AND p.activated = $3 AND LOWER(p.username) != $4
             GROUP BY p.user_id
             ORDER BY p.created_at DESC`,
            ['public', true, true, excludeUsername]
        );

        const resolved = [];
        for (const profile of result.rows) {
            let avatar = profile.avatar;
            let role = { name: 'Member', color: '#5865F2' };

            try {
                const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${profile.user_id}`, BOT_TOKEN, 'Bot ');
                const avatarExt = member.user.avatar && member.user.avatar.startsWith('a_') ? 'gif' : 'png';
                avatar = member.user.avatar
                    ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.${avatarExt}?size=256`
                    : `https://cdn.discordapp.com/embed/avatars/${(parseInt(member.user.id) >> 22) % 6}.png`;

                const memberRoles = member.roles || [];
                const matchingRoles = TEAM_ROLES.filter(r => memberRoles.includes(r.id));
                if (matchingRoles.length > 0) {
                    role = matchingRoles.sort((a, b) => a.priority - b.priority)[0];
                }
            } catch (e) {}

            resolved.push({
                userId: profile.user_id,
                username: profile.username,
                displayName: profile.display_name,
                avatar,
                role,
                bio: profile.bio,
                accentColor: profile.accent_color,
                layout: profile.layout,
                featured: profile.featured
            });
        }

        res.json(resolved);
    } catch (err) {
        console.error('[PROFILES] Fetch featured failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch featured profiles' });
    }
});

// --- GET /api/team/profiles/:username - Single profile ---
router.get('/team/profiles/:username', async (req, res) => {
    try {
        const { username } = req.params;

        const profileResult = await db.query(
            `SELECT * FROM profiles WHERE LOWER(username) = $1 AND activated = $2`,
            [username.toLowerCase(), true]
        );

        if (profileResult.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        const profile = profileResult.rows[0];

        if (profile.visibility === 'private') {
            return res.status(403).json({ error: 'This profile is private' });
        }

        const linksResult = await db.query(
            `SELECT * FROM profile_links WHERE user_id = $1 ORDER BY position ASC`,
            [profile.user_id]
        );

        let resolvedAvatar = profile.avatar;
        let resolvedBanner = profile.banner_value || null;
        let avatarDecorationAsset = null;

        try {
            const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${profile.user_id}`, BOT_TOKEN, 'Bot ');
            const avatarExt = member.user.avatar && member.user.avatar.startsWith('a_') ? 'gif' : 'png';
            resolvedAvatar = member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.${avatarExt}?size=256`
                : `https://cdn.discordapp.com/embed/avatars/${(parseInt(member.user.id) >> 22) % 6}.png`;

            const fullUser = await discordFetch(`https://discord.com/api/v10/users/${profile.user_id}`, BOT_TOKEN, 'Bot ');
            if (fullUser.banner && profile.banner_type === 'discord') {
                const ext = fullUser.banner.startsWith('a_') ? 'gif' : 'png';
                resolvedBanner = `https://cdn.discordapp.com/banners/${fullUser.id}/${fullUser.banner}.${ext}?size=600`;
            }
            if (fullUser.avatar_decoration_data && fullUser.avatar_decoration_data.asset) {
                avatarDecorationAsset = fullUser.avatar_decoration_data.asset;
            }
        } catch (e) {}

        const responseData = {
            user_id: profile.user_id,
            username: profile.username,
            displayName: profile.display_name,
            bio: profile.bio,
            avatar: resolvedAvatar,
            avatarDecorationAsset,
            banner: {
                type: profile.banner_type,
                value: resolvedBanner
            },
            accentColor: profile.accent_color,
            visibility: profile.visibility,
            featured: profile.featured,
            activated: profile.activated,
            layout: profile.layout,
            links: linksResult.rows,
            music: {
                spotifyEmbed: profile.spotify_embed,
                soundcloudEmbed: profile.soundcloud_embed,
                currentlyListeningEnabled: profile.currently_listening_enabled
            }
        };

        if (profile.currently_listening_enabled && profile.spotify_refresh_token) {
            const spotifyData = await getSpotifyCurrentlyListening(profile.spotify_refresh_token);
            if (spotifyData) {
                responseData.currentlyListening = spotifyData;
            }
        }

        if (profile.featured) {
            responseData.teamMembers = await fetchFeaturedTeamMembers(profile.user_id);
        }

        res.json(responseData);
    } catch (err) {
        console.error('[PROFILES] Fetch single failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// --- GET /api/admin/linktree - Get own profile ---
router.get('/admin/linktree', checkTeamRole, async (req, res) => {
    try {
        const profileResult = await db.query(
            `SELECT * FROM profiles WHERE user_id = $1`,
            [req.user.id]
        );

        let profile;
        if (profileResult.rows.length === 0) {
            // Create default profile
            const avatarExt = req.user.avatar && req.user.avatar.startsWith('a_') ? 'gif' : 'png';
            const avatarUrl = req.user.avatar
                ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.${avatarExt}?size=256`
                : `https://cdn.discordapp.com/embed/avatars/${(parseInt(req.user.id) >> 22) % 6}.png`;

            profile = {
                user_id: req.user.id,
                username: req.user.username.toLowerCase(),
                display_name: req.user.global_name || req.user.username,
                bio: 'Hey there! I am a proud team member of Disc-Tools.',
                avatar: avatarUrl,
                banner_type: 'discord',
                banner_value: null,
                accent_color: '#5865F2',
                visibility: 'private',
                featured: false,
                activated: false,
                show_avatar_decoration: true,
                layout: 'centered',
                spotify_refresh_token: null,
                spotify_embed: '',
                soundcloud_embed: '',
                currently_listening_enabled: false
            };
        } else {
            profile = profileResult.rows[0];
        }

        const linksResult = await db.query(
            `SELECT * FROM profile_links WHERE user_id = $1 ORDER BY position ASC`,
            [req.user.id]
        );

        let spotifyDisplayName = profile.spotify_display_name;

        // If connected but name is missing, try to fetch from Spotify API
        if (!spotifyDisplayName && profile.spotify_refresh_token) {
            try {
                const tokenRes = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: profile.spotify_refresh_token
                }), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')
                    }
                });
                const profileRes = await axios.get('https://api.spotify.com/v1/me', {
                    headers: { 'Authorization': `Bearer ${tokenRes.data.access_token}` }
                });
                spotifyDisplayName = profileRes.data.display_name || profileRes.data.id || null;
            } catch (e) {
                console.error('[SPOTIFY] Failed to fetch display name:', e.message);
            }
        }

        const responseData = {
            user_id: profile.user_id,
            userId: profile.user_id,
            username: profile.username,
            displayName: profile.display_name,
            bio: profile.bio,
            avatar: profile.avatar,
            layout: profile.layout,
            accentColor: profile.accent_color,
            banner: {
                type: profile.banner_type,
                value: profile.banner_value
            },
            visibility: profile.visibility,
            featured: profile.featured,
            activated: profile.activated,
            showAvatarDecoration: profile.show_avatar_decoration !== false,
            hobbies: profile.hobbies || [],
            links: linksResult.rows,
            verifiedOrder: Array.isArray(profile.verified_order) ? profile.verified_order : (typeof profile.verified_order === 'string' ? JSON.parse(profile.verified_order) : []),
            music: {
                spotifyEmbed: profile.spotify_embed,
                soundcloudEmbed: profile.soundcloud_embed,
                currentlyListeningEnabled: profile.currently_listening_enabled,
                spotifyConnected: !!profile.spotify_refresh_token,
                spotifyDisplayName,
                spotifyListeningLayout: profile.spotify_listening_layout || 'card'
            }
        };

        res.json(responseData);
    } catch (err) {
        console.error('[PROFILES] Get linktree failed:', err.message);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// --- POST /api/admin/linktree - Save/Update profile ---
router.post('/admin/linktree', checkTeamRole, async (req, res) => {
    try {
        const { username, displayName, bio, banner, accentColor, visibility, featured, showAvatarDecoration, layout, links, music, hobbies, verifiedOrder, spotifyListeningLayout } = req.body;

        let chosenUsername = username;
        if (!chosenUsername || typeof chosenUsername !== 'string') {
            return res.status(400).json({ error: 'Username is required.' });
        }

        chosenUsername = chosenUsername.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (chosenUsername.length < 3 || chosenUsername.length > 20) {
            return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
        }

        // Check uniqueness
        const duplicate = await db.query(
            `SELECT user_id FROM profiles WHERE username = $1 AND user_id != $2`,
            [chosenUsername, req.user.id]
        );

        if (duplicate.rows.length > 0) {
            return res.status(400).json({ error: 'This username is already taken.' });
        }

        // Get existing profile to preserve refresh token, activation, and old username
        const existingResult = await db.query(
            `SELECT spotify_refresh_token, activated, username FROM profiles WHERE user_id = $1`,
            [req.user.id]
        );

        const oldRefreshToken = existingResult.rows[0]?.spotify_refresh_token || null;
        const oldActivated = existingResult.rows[0]?.activated || false;
        const oldUsername = existingResult.rows[0]?.username || null;

        let resolvedAvatar = '';
        let resolvedBanner = '';
        let avatarDecorationAsset = null;

        try {
            const member = await discordFetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${req.user.id}`, BOT_TOKEN, 'Bot ');
            const avatarExt = member.user.avatar && member.user.avatar.startsWith('a_') ? 'gif' : 'png';
            resolvedAvatar = member.user.avatar
                ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.${avatarExt}?size=256`
                : `https://cdn.discordapp.com/embed/avatars/${(parseInt(req.user.id) >> 22) % 6}.png`;

            const fullUser = await discordFetch(`https://discord.com/api/v10/users/${req.user.id}`, BOT_TOKEN, 'Bot ');
            if (fullUser.banner) {
                const ext = fullUser.banner.startsWith('a_') ? 'gif' : 'png';
                resolvedBanner = `https://cdn.discordapp.com/banners/${fullUser.id}/${fullUser.banner}.${ext}?size=600`;
            }
            if (fullUser.avatar_decoration_data && fullUser.avatar_decoration_data.asset) {
                avatarDecorationAsset = fullUser.avatar_decoration_data.asset;
            }
        } catch (e) {
            console.error('[PROFILES] Discord fetch failed:', e.message);
        }

        // Upsert profile
        await db.query(
            `INSERT INTO profiles (user_id, username, display_name, bio, avatar, banner_type, banner_value, accent_color, visibility, featured, show_avatar_decoration, activated, layout, spotify_refresh_token, spotify_embed, soundcloud_embed, currently_listening_enabled, hobbies, verified_order, spotify_listening_layout, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET 
                username = $2, display_name = $3, bio = $4, avatar = $5, banner_type = $6, banner_value = $7,
                accent_color = $8, visibility = $9, featured = $10, show_avatar_decoration = $11, layout = $13, spotify_embed = $15, soundcloud_embed = $16,
                currently_listening_enabled = $17, hobbies = $18, verified_order = $19, spotify_listening_layout = $20, updated_at = NOW()`,
            [
                req.user.id,
                chosenUsername,
                (displayName || req.user.global_name || req.user.username).substring(0, 50),
                (bio || '').substring(0, 1000),
                resolvedAvatar,
                banner?.type || 'discord',
                banner?.type === 'color' ? (banner.value || '#111118') : (resolvedBanner || banner?.value || null),
                accentColor || '#5865F2',
                visibility === 'public' ? 'public' : 'private',
                !!featured,
                showAvatarDecoration !== false,
                oldActivated,
                ['centered', 'left', 'card'].includes(layout) ? layout : 'centered',
                oldRefreshToken,
                normalizeSpotifyEmbedUrl(music?.spotifyEmbed || music?.favoriteSpotify || ''),
                normalizeSoundcloudEmbedUrl(music?.soundcloudEmbed || ''),
                !!music?.currentlyListeningEnabled,
                Array.isArray(hobbies) ? hobbies : [],
                Array.isArray(verifiedOrder) ? JSON.stringify(verifiedOrder) : '[]',
                ['card', 'minimal', 'clean'].includes(spotifyListeningLayout) ? spotifyListeningLayout : 'card'
            ]
        );

        // Delete old links and insert new ones
        await db.query(`DELETE FROM profile_links WHERE user_id = $1`, [req.user.id]);

        if (Array.isArray(links) && links.length > 0) {
            for (const link of links) {
                if (link.url && !/^https?:\/\//i.test(link.url)) {
                    return res.status(400).json({ error: 'Invalid link URL – must start with http:// or https://' });
                }
                if (link.icon && !/^https?:\/\//i.test(link.icon)) {
                    return res.status(400).json({ error: 'Invalid icon URL – must start with http:// or https://' });
                }
                await db.query(
                    `INSERT INTO profile_links (id, user_id, platform, username, url, label, icon, position, type)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                    [
                        link.id || `${req.user.id}_${Date.now()}_${Math.random()}`,
                        req.user.id,
                        link.platform || null,
                        link.username || null,
                        link.url || null,
                        link.label || null,
                        link.icon || null,
                        links.indexOf(link),
                        link.type === 'custom' ? 'custom' : 'preset'
                    ]
                );
            }
        }

        // Remove stale folder when handle changed
        if (oldUsername && oldUsername.toLowerCase() !== chosenUsername) {
            const oldFolder = getTeamPageDir(oldUsername);
            if (fs.existsSync(oldFolder)) {
                fs.rmSync(oldFolder, { recursive: true, force: true });
            }
            const wrongApiFolder = getTeamPageDir(oldUsername);
            if (fs.existsSync(wrongApiFolder)) {
                fs.rmSync(wrongApiFolder, { recursive: true, force: true });
            }
        }

        const bannerForHtml = resolveBannerForHtml(banner, resolvedBanner);

        // Always regenerate HTML (written to /team/ - nginx document root)
        {
            const userFolder = getTeamPageDir(chosenUsername);
            fs.mkdirSync(userFolder, { recursive: true });

            const linksForHtml = links ? links.map((l, i) => ({ ...l, position: i })) : [];
            const musicData = {
                spotify_embed: normalizeSpotifyEmbedUrl(music?.spotifyEmbed || ''),
                soundcloud_embed: normalizeSoundcloudEmbedUrl(music?.soundcloudEmbed || ''),
                currently_listening_enabled: !!music?.currentlyListeningEnabled,
                spotify_refresh_token: oldRefreshToken
            };

            const profileForHtml = {
                user_id: req.user.id,
                username: chosenUsername,
                display_name: displayName || req.user.global_name || req.user.username,
                bio: bio || '',
                layout: layout || 'centered',
                accent_color: accentColor || '#5865F2',
                hobbies: Array.isArray(hobbies) ? hobbies : [],
                verified_order: verifiedOrder || [],
                spotify_listening_layout: spotifyListeningLayout || 'card'
            };

            let teamMembers = [];
            if (featured) {
                teamMembers = await fetchFeaturedTeamMembers(req.user.id);
            }

            const connections = await fetchConnections(req.user.id);
            const htmlContent = await generateProfileHtml(profileForHtml, resolvedAvatar, bannerForHtml, linksForHtml, musicData, teamMembers, avatarDecorationAsset, showAvatarDecoration !== false, connections);
            fs.writeFileSync(path.join(userFolder, 'index.html'), htmlContent, 'utf8');
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[PROFILES] Update failed:', err.message);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

// --- POST /api/admin/linktree/activate ---
router.post('/admin/linktree/activate', checkTeamRole, async (req, res) => {
    try {
        const { username } = req.body;
        let chosenUsername = username || req.user.username;

        if (typeof chosenUsername !== 'string') {
            return res.status(400).json({ error: 'Username must be a string.' });
        }

        chosenUsername = chosenUsername.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (chosenUsername.length < 3 || chosenUsername.length > 20) {
            return res.status(400).json({ error: 'Username must be between 3 and 20 characters.' });
        }

        // Check uniqueness
        const duplicate = await db.query(
            `SELECT user_id FROM profiles WHERE username = $1 AND user_id != $2`,
            [chosenUsername, req.user.id]
        );

        if (duplicate.rows.length > 0) {
            return res.status(400).json({ error: 'This username is already taken.' });
        }

        const avatarExt = req.user.avatar && req.user.avatar.startsWith('a_') ? 'gif' : 'png';
        const avatarUrl = req.user.avatar
            ? `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.${avatarExt}?size=256`
            : `https://cdn.discordapp.com/embed/avatars/${(parseInt(req.user.id) >> 22) % 6}.png`;

        // Activate profile
        await db.query(
            `INSERT INTO profiles (user_id, username, display_name, bio, avatar, banner_type, banner_value, accent_color, visibility, featured, activated, layout, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET username = $2, activated = true`,
            [
                req.user.id,
                chosenUsername,
                req.user.global_name || req.user.username,
                'Hey there! I am a proud team member of Disc-Tools.',
                avatarUrl,
                'discord',
                null,
                '#5865F2',
                'private',
                false,
                true,
                'centered'
            ]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[PROFILES] Activate failed:', err.message);
        res.status(500).json({ error: 'Failed to activate profile' });
    }
});

// --- POST /api/auth/spotify/disconnect ---
router.post('/auth/spotify/disconnect', checkTeamRole, async (req, res) => {
    try {
        const existing = await db.query(
            `SELECT spotify_refresh_token FROM profiles WHERE user_id = $1`,
            [req.user.id]
        );
        const oldToken = existing.rows[0]?.spotify_refresh_token;

        if (oldToken) {
            try {
                await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: oldToken
                }), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')
                    }
                });
            } catch {}
        }

        await db.query(
            `UPDATE profiles SET spotify_refresh_token = NULL, spotify_display_name = NULL, currently_listening_enabled = false WHERE user_id = $1`,
            [req.user.id]
        );
        await db.query(
            `DELETE FROM linked_accounts WHERE user_id = $1 AND provider = 'spotify'`,
            [req.user.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[SPOTIFY] Disconnect failed:', err.message);
        res.status(500).json({ error: 'Failed to disconnect Spotify' });
    }
});

// --- GET /api/auth/spotify ---
router.get('/auth/spotify', checkTeamRole, (req, res) => {
    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
    const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://disc-tools.de/api/auth/spotify/callback';

    if (!SPOTIFY_CLIENT_ID) {
        return res.status(503).send('Spotify Client ID not configured on server.');
    }

    const state = crypto.randomBytes(24).toString('hex');
    res.cookie('spotify_oauth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000
    });
    const scope = 'user-read-currently-playing user-read-playback-state user-top-read';
    const spotifyAuthUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${SPOTIFY_CLIENT_ID}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}&state=${state}&prompt=consent`;

    console.log('[SPOTIFY] Redirecting to:', spotifyAuthUrl.substring(0, 120) + '...');
    res.redirect(spotifyAuthUrl);
});

// --- GET /api/auth/spotify/callback ---
router.get('/auth/spotify/callback', async (req, res) => {
    const { code, state, error } = req.query;
    console.log('[SPOTIFY] Callback received - code:', !!code, 'error:', error, 'state:', !!state);
    if (!code) {
        console.log('[SPOTIFY] No code in callback, error:', error || 'unknown');
        return res.status(400).send('No code provided');
    }

    const expectedState = req.cookies.spotify_oauth_state;
    if (!state || !expectedState || state !== expectedState) {
        return res.status(403).send('Invalid OAuth state.');
    }
    res.clearCookie('spotify_oauth_state');

    const token = req.cookies.token;
    if (!token) return res.status(401).send('Unauthorized connection attempt.');

    let userId;
    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        userId = decoded.id;
    } catch (e) {
        return res.status(401).send('Unauthorized connection attempt.');
    }

    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
    const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://disc-tools.de/api/auth/spotify/callback';

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
        return res.status(503).send('Spotify credentials not configured on server.');
    }

    try {
        const tokenRes = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: SPOTIFY_REDIRECT_URI
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')
            }
        });

        const { refresh_token, access_token } = tokenRes.data;
        console.log('[SPOTIFY] Token exchange - has refresh_token:', !!refresh_token, 'has access_token:', !!access_token, 'keys:', Object.keys(tokenRes.data).join(','));

        let spotifyDisplayName = null;
        try {
            const profileRes = await axios.get('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${access_token}` }
            });
            spotifyDisplayName = profileRes.data.display_name || profileRes.data.id;
        } catch(e) {
            console.error('[SPOTIFY] Failed to fetch profile info:', e.message);
        }

        let finalRefreshToken = refresh_token;

        if (!finalRefreshToken) {
            const existingToken = await db.query(
                `SELECT spotify_refresh_token FROM profiles WHERE user_id = $1`,
                [userId]
            );
            finalRefreshToken = existingToken.rows[0]?.spotify_refresh_token || null;
            if (!finalRefreshToken) {
                console.log('[SPOTIFY] No refresh token available - cannot store');
                return res.redirect('/admin/linktree/?spotify=error');
            }
        }

        await db.query(
            `INSERT INTO profiles (user_id, username, display_name, bio, avatar, banner_type, accent_color, visibility, featured, activated, layout, spotify_refresh_token, spotify_display_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET spotify_refresh_token = $12, spotify_display_name = $13, currently_listening_enabled = false`,
            [
                userId,
                userId,
                userId,
                '',
                '',
                'discord',
                '#5865F2',
                'private',
                false,
                false,
                'centered',
                finalRefreshToken,
                spotifyDisplayName
            ]
        );

        try {
            await db.query(
                `INSERT INTO linked_accounts (user_id, provider, provider_account_id, provider_username, provider_avatar)
                 VALUES ($1, 'spotify', $2, $3, NULL)
                 ON CONFLICT (user_id, provider) DO UPDATE SET
                    provider_account_id = $2, provider_username = $3, linked_at = NOW()`,
                [userId, 'spotify', spotifyDisplayName]
            );
        } catch (e) {
            console.error('[SPOTIFY] Failed to add linked_account:', e.message);
        }

        res.redirect('/admin/linktree/?spotify=success');
    } catch (err) {
        console.error('[SPOTIFY] Token exchange failed:', err.message);
        res.redirect('/admin/linktree/?spotify=error');
    }
});

// --- GET /api/spotify/currently-playing ---
router.get('/spotify/currently-playing', async (req, res) => {
    try {
        let targetUserId = req.query.userId;

        if (!targetUserId) {
            const token = req.cookies.token;
            if (!token) return res.json({ currentlyListening: null });
            try {
                const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
                targetUserId = decoded.id;
            } catch (err) {
                return res.json({ currentlyListening: null });
            }
        } else if (!/^\d{17,20}$/.test(String(targetUserId))) {
            return res.json({ currentlyListening: null });
        }

        const profileResult = await db.query(
            `SELECT spotify_refresh_token, visibility, activated, currently_listening_enabled
             FROM profiles WHERE user_id = $1`,
            [targetUserId]
        );

        const profile = profileResult.rows[0];
        if (!profile || !profile.spotify_refresh_token) {
            return res.json({ currentlyListening: null });
        }

        // Admin preview bypasses the listening toggle check
        if (!profile.currently_listening_enabled && req.query.admin !== '1') {
            return res.json({ currentlyListening: null });
        }

        if (profile.visibility !== 'public' || !profile.activated) {
            const token = req.cookies.token;
            let isOwner = false;
            if (token) {
                try {
                    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
                    isOwner = decoded.id === targetUserId;
                } catch (e) {}
            }
            if (!isOwner) {
                return res.json({ currentlyListening: null });
            }
        }

        const spotifyData = await getSpotifyCurrentlyListening(profile.spotify_refresh_token);
        if (!spotifyData) return res.json({ currentlyListening: null });

        return res.json({ currentlyListening: spotifyData });
    } catch (err) {
        console.error('[SPOTIFY] Currently playing failed:', err.message);
        return res.json({ currentlyListening: null });
    }
});

async function fetchConnections(userId) {
    try {
        const result = await db.query(
            `SELECT provider, provider_username FROM linked_accounts WHERE user_id = $1`,
            [userId]
        );
        return result.rows;
    } catch {
        return [];
    }
}

async function fetchFeaturedTeamMembers(excludeUserId) {
    try {
        const result = await db.query(
            `SELECT user_id, username, display_name, avatar, accent_color, bio
             FROM profiles
             WHERE visibility = $1 AND featured = $2 AND activated = $3 AND user_id != $4
             ORDER BY display_name ASC`,
            ['public', true, true, excludeUserId]
        );
        return result.rows.map(row => ({
            userId: row.user_id,
            username: row.username,
            displayName: row.display_name,
            avatar: row.avatar,
            accentColor: row.accent_color,
            bio: row.bio
        }));
    } catch (err) {
        console.error('[PROFILES] Fetch featured team members failed:', err.message);
        return [];
    }
}

async function regenerateAllTeamPages() {
    const result = await db.query(
        `SELECT p.*, COALESCE(json_agg(pl) FILTER (WHERE pl.id IS NOT NULL), '[]') as links
         FROM profiles p
         LEFT JOIN profile_links pl ON p.user_id = pl.user_id
         WHERE p.visibility = $1 AND p.activated = $2
         GROUP BY p.user_id`,
        ['public', true]
    );

    let count = 0;
    for (const profile of result.rows) {
        const rawLinks = profile.links;
        const linkRows = Array.isArray(rawLinks) ? rawLinks : (rawLinks && typeof rawLinks === 'object' ? Object.values(rawLinks) : []);
        const links = linkRows.filter(l => l && l.id).map((l, i) => ({ ...l, position: l.position ?? i }));
        const musicData = {
            spotify_embed: profile.spotify_embed || '',
            soundcloud_embed: profile.soundcloud_embed || '',
            currently_listening_enabled: profile.currently_listening_enabled,
            spotify_refresh_token: profile.spotify_refresh_token
        };
        const bannerForHtml = resolveBannerForHtml(
            { type: profile.banner_type, value: profile.banner_value },
            profile.banner_type === 'discord' ? profile.banner_value : null
        );
        const profileForHtml = {
            user_id: profile.user_id,
            username: profile.username,
            display_name: profile.display_name,
            bio: profile.bio,
            layout: profile.layout || 'centered',
            accent_color: profile.accent_color || '#5865F2',
            hobbies: profile.hobbies || [],
            verified_order: profile.verified_order || [],
            spotify_listening_layout: profile.spotify_listening_layout || 'card'
        };
        const userFolder = getTeamPageDir(profile.username);
        fs.mkdirSync(userFolder, { recursive: true });

        let teamMembers = [];
        if (profile.featured) {
            teamMembers = await fetchFeaturedTeamMembers(profile.user_id);
        }

        let avatarDecorationAsset = null;
        try {
            const fu = await discordFetch(`https://discord.com/api/v10/users/${profile.user_id}`, BOT_TOKEN, 'Bot ');
            if (fu.avatar_decoration_data && fu.avatar_decoration_data.asset) {
                avatarDecorationAsset = fu.avatar_decoration_data.asset;
            }
        } catch (e) {}

        const connections = await fetchConnections(profile.user_id);
        const html = await generateProfileHtml(
            profileForHtml,
            profile.avatar,
            bannerForHtml,
            links,
            musicData,
            teamMembers,
            avatarDecorationAsset,
            profile.show_avatar_decoration !== false,
            connections
        );
        fs.writeFileSync(path.join(userFolder, 'index.html'), html, 'utf8');
        count++;
    }
    return count;
}

router.regenerateAllTeamPages = regenerateAllTeamPages;

module.exports = router;
