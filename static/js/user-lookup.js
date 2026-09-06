/* Disc-Tools: User Lookup — fetch Discord user by ID and render profile card */
(function () {
    'use strict';

    var form = document.getElementById('lookup-form');
    var input = document.getElementById('lookup-input');
    var submitBtn = document.getElementById('lookup-submit');
    var resultEl = document.getElementById('result');

    /* ---------- Badge definitions (bitwise) ---------- ----------
       Icons are the official badge icons from Discord's CDN
       (https://cdn.discordapp.com/badge-icons/<hash>.png, see https://gist.github.com/XYZenix/c45156b7c883b5301c9028e39d71b479).
       Badges without a CDN icon fall back to the local SVG copies. */
    var badgeIcon = function (hash) {
        return 'https://cdn.discordapp.com/badge-icons/' + hash + '.png?size=64';
    };
    var profileBadgeIcon = function (icon) {
        return icon ? 'https://cdn.discordapp.com/badge-icons/' + icon + '.png?size=64' : null;
    };
    var BADGES = [
        { value: 1 << 0,  id: 'staff',                  name: 'Discord Staff',       src: badgeIcon('5e74e9b61934fc1f67c65515d1f7e60d') },
        { value: 1 << 1,  id: 'partner',                name: 'Partnered Server',    src: badgeIcon('3f9748e53446a137a052f3454e2de41e') },
        { value: 1 << 2,  id: 'hypesquad',              name: 'HypeSquad Events',    src: badgeIcon('bf01d1073931f921909045f3a39fd264') },
        { value: 1 << 3,  id: 'bug_hunter_level_1',     name: 'Bug Hunter Lvl 1',    src: badgeIcon('2717692c7dca7289b35297368a940dd0') },
        { value: 1 << 6,  id: 'hypesquad_house_1',      name: 'House Bravery',      src: badgeIcon('8a88d63823d8a71cd5e390baa45efa02') },
        { value: 1 << 7,  id: 'hypesquad_house_2',      name: 'House Brilliance',   src: badgeIcon('011940fd013da3f7fb926e4a1cd2e618') },
        { value: 1 << 8,  id: 'hypesquad_house_3',      name: 'House Balance',      src: badgeIcon('3aa41de486fa12454c3761e8e223442e') },
        { value: 1 << 9,  id: 'early_supporter',        name: 'Early Supporter',    src: badgeIcon('7060786766c9c840eb3019e725d2b358') },
        { value: 1 << 10,                              name: 'Team User',          src: '/static/discord/badges/team-pseudo.svg' },
        { value: 1 << 14, id: 'bug_hunter_level_2',     name: 'Bug Hunter Lvl 2',   src: badgeIcon('848f79194d4be5ff5f81505cbd0ce1e6') },
        { value: 1 << 16,                              name: 'Verified Bot',        src: '/static/discord/badges/verified-bot.svg' },
        { value: 1 << 17, id: 'verified_developer',     name: 'Verified Developer',  src: badgeIcon('6df5892e0f35b051f8b61eace34f4967') },
        { value: 1 << 18, id: 'certified_moderator',    name: 'Certified Moderator', src: badgeIcon('fee1624003e2fee35cb398e125dc479b') },
        { value: 1 << 19,                              name: 'Uses HTTP Interac.',  src: '/static/discord/badges/http-interactions.svg' },
        { value: 1 << 22, id: 'active_developer',       name: 'Active Developer',    src: badgeIcon('6bdc42827a38498929a4920da12695d9') }
    ];

    var BOOSTER_ICONS = {
        1: '51040c70d4f20a921ad6674ff86fc95c',
        2: '0e4080d1d333bc7ad29ef6528b6f2fb7',
        3: '72bed924410c304dbe3d00a6e593ff59',
        4: 'df199d2050d3ed4ebf84d64ae83989f8',
        5: '996b3e870e8a22ce519b3a50e6bdd52f',
        6: '991c9f39ee33d7537d9f408c3e53141e',
        7: 'cb3ae83c15e970e8f3d410bc62cb8b99',
        8: '7142225d31238f6387d9f09efaa02759',
        9: 'ec92202290b48d0879b7413d2dde3bab'
    };

    function boosterLevel(premiumSince) {
        if (!premiumSince) return null;
        var start = new Date(premiumSince);
        if (isNaN(start.getTime())) return null;
        var months = (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        if (months < 2) return 1;
        if (months < 3) return 2;
        if (months < 6) return 3;
        if (months < 9) return 4;
        if (months < 12) return 5;
        if (months < 15) return 6;
        if (months < 18) return 7;
        if (months < 24) return 8;
        return 9;
    }

    var DISCORD_EPOCH_MS = 1420070400000;

    var DN_FONTS = { 11: 'gg Sans', 3: 'Sakura', 4: 'Jellybean', 6: 'Modern', 7: 'Medieval', 8: '8Bit', 10: 'Vampyre', 12: 'Tempo', 13: 'Monkey Bars', 14: 'Mainframe', 15: 'Headbang', 16: 'Journal' };
    var DN_EFFECTS = { 1: 'Solid', 2: 'Gradient', 3: 'Neon', 4: 'Toon', 5: 'Pop', 6: 'Glow', 7: 'Prism', 8: 'Gummy' };
    var DN_FONT_FAMILY = {
        3: '"Cherry Bomb One", cursive',
        4: '"Chicle", cursive',
        6: '"MuseoModerno", cursive',
        7: 'serif',
        8: '"Pixelify Sans", monospace',
        10: 'sans-serif',
        12: '"Zilla Slab", serif',
        13: '"Playpen Sans", cursive',
        14: '"Orbitron", sans-serif',
        15: '"New Rocker", cursive',
        16: '"Kalam", cursive'
    };

    function dnStyle(dns) {
        if (!dns) return '';
        var s = '';
        var colors = (dns.colors || []).map(function (n) { return intToHex(n); }).filter(Boolean);
        if (dns.font_id && DN_FONT_FAMILY[dns.font_id]) {
            s += 'font-family:' + DN_FONT_FAMILY[dns.font_id] + ';';
        }
        var c0 = colors[0] || '';
        var c1 = colors[1] || '';
        var eff = dns.effect_id || 1;
        switch (eff) {
            case 2:
                if (c0 && c1) {
                    s += 'background:linear-gradient(90deg,' + c0 + ',' + c1 + ');';
                    s += '-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;';
                } else if (c0) { s += 'color:' + c0 + ';'; }
                break;
            case 3:
                if (c0) { s += 'color:' + c0 + ';text-shadow:0 0 5px ' + c0 + ',0 0 10px ' + c0 + ',0 0 20px ' + c0 + ';'; }
                break;
            case 4:
                if (c0) s += 'color:' + c0 + ';';
                s += '-webkit-text-stroke:1.5px #000;';
                break;
            case 5:
                if (c0) s += 'color:' + c0 + ';';
                s += 'text-shadow:2px 2px 0 #000;';
                break;
            case 6:
                if (c0) s += 'color:' + c0 + ';text-shadow:0 0 8px ' + c0 + '99,0 0 16px ' + c0 + '66;';
                break;
            default:
                if (c0) s += 'color:' + c0 + ';';
        }
        return s;
    }

    /* ---------- Helpers ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function defaultAvatarURL(userId) {
        var idx = 0;
        try { idx = Number((BigInt(userId) >> 22n) % 6n); if (isNaN(idx) || idx < 0) idx = 0; } catch (e) {}
        return 'https://cdn.discordapp.com/embed/avatars/' + idx + '.png';
    }

    function avatarURL(userId, avatar, size) {
        size = size || 128;
        if (!avatar) return defaultAvatarURL(userId);
        var ext = avatar.startsWith('a_') ? 'gif' : 'webp';
        return 'https://cdn.discordapp.com/avatars/' + userId + '/' + avatar + '.' + ext + '?size=' + size;
    }

    function bannerURL(userId, banner) {
        if (!banner) return null;
        var ext = banner.startsWith('a_') ? 'gif' : 'webp';
        return 'https://cdn.discordapp.com/banners/' + userId + '/' + banner + '.' + ext + '?size=600';
    }

    function avatarDecorationURL(asset) {
        if (!asset) return null;
        return 'https://cdn.discordapp.com/avatar-decoration-presets/' + asset + '.png';
    }

    function clanBadgeURL(guildId, badge) {
        if (!guildId || !badge) return null;
        return 'https://cdn.discordapp.com/clan-badges/' + guildId + '/' + badge + '.png?size=16';
    }

    function intToHex(n) {
        if (n == null || n === 0) return null;
        return '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');
    }

    /* Snowflake -> Date using BigInt for accuracy (IDs exceed Number precision) */
    function snowflakeDate(id) {
        try {
            var ms = Number((BigInt(id) >> 22n) + BigInt(DISCORD_EPOCH_MS));
            return new Date(ms);
        } catch (e) { return null; }
    }

    function fmtDate(d) {
        if (!d || isNaN(d.getTime())) return 'Unknown';
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function fmtHex(n) {
        if (n == null) return null;
        return '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
    }

    function daysSince(d) {
        if (!d || isNaN(d.getTime())) return null;
        return Math.floor((Date.now() - d.getTime()) / 86400000);
    }

    function timeAgo(d) {
        if (!d || isNaN(d.getTime())) return null;
        var days = daysSince(d);
        if (days == null) return null;
        var yrs = days / 365.25;
        if (yrs >= 1) {
            var whole = Math.floor(yrs);
            var rem = Math.floor((yrs - whole) * 365.25);
            return whole + (whole === 1 ? ' year' : ' years') + ', ' + rem + ' days ago';
        }
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        return days + ' days ago';
    }

    function getBadges(flags) {
        return BADGES.filter(function (b) { return (flags & b.value) === b.value; });
    }

    /* Discord <t:timestamp:micros> format example */
    function discordTimestamp(d) {
        if (!d || isNaN(d.getTime())) return null;
        return '<t:' + Math.floor(d.getTime() / 1000) + '>';
    }

    /* ---------- Render helpers ---------- */
    function loadingHTML(msg) {
        return '<div class="lookup-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>' + esc(msg) + '</div>';
    }

    function errorHTML(msg) {
        return '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>' + esc(msg) + '</p></div>';
    }

    function infoItem(safeLabel, safeValue, sub) {
        return '<div class="result-info-item">' +
            '<span class="result-info-label">' + safeLabel + '</span>' +
            '<span class="result-info-value">' + safeValue + '</span>' +
            (sub != null ? '<span class="result-info-sub">' + sub + '</span>' : '') +
        '</div>';
    }

    function copyRow(label, value) {
        return '<div class="result-copy-row" data-value="' + esc(value) + '">' +
            '<span class="result-copy-label">' + esc(label) + '</span>' +
            '<span class="result-copy-value">' + esc(value) + '</span>' +
            '<button type="button" class="btn-copy" aria-label="Copy ' + esc(label) + '"><i class="fa-solid fa-copy"></i></button>' +
        '</div>';
    }

    /* ---------- Render result ---------- */
    function renderResult(u) {
        var avatar = avatarURL(u.id, u.avatar, 256);
        var banner = bannerURL(u.id, u.banner);
        var accent = intToHex(u.accent_color) || u.banner_color || null;
        var created = snowflakeDate(u.id);
        var decoration = u.avatar_decoration_data && u.avatar_decoration_data.asset
            ? avatarDecorationURL(u.avatar_decoration_data.asset) : null;
        var clan = (u.clan && u.clan.identity_enabled && u.clan.tag) ? u.clan : null;
        var clanBadge = (clan && clan.badge) ? clanBadgeURL(clan.identity_guild_id, clan.badge) : null;

        var bannerStyle = banner
            ? 'background-image:url(\'' + esc(banner) + '\');background-size:cover;background-position:center;'
            : accent
                ? 'background:' + esc(accent) + ';'
                : 'background:linear-gradient(135deg,var(--surface-2),var(--bg));';

        var profileBadges = Array.isArray(u.badges) ? u.badges.filter(function (b) { return b && b.icon; }) : [];
        var profileIds = {};
        profileBadges.forEach(function (b) { if (b.id) profileIds[b.id] = true; });
        var flagBadges = getBadges(u.public_flags || 0).filter(function (b) { return !b.id || !profileIds[b.id]; });

        if (u.premium_since) {
            var bLvl = boosterLevel(u.premium_since);
            if (bLvl && BOOSTER_ICONS[bLvl]) {
                var bStart = new Date(u.premium_since);
                flagBadges.push({
                    name: 'Server Booster · Lvl ' + bLvl + ' · since ' + fmtDate(bStart),
                    src: badgeIcon(BOOSTER_ICONS[bLvl])
                });
            }
        }

        var badgeHTML;
        if (profileBadges.length || flagBadges.length) {
            var badgeItems = profileBadges.map(function (b) {
                var icon = profileBadgeIcon(b.icon);
                return '<span class="result-badge" title="' + esc(b.description || '') + '">' +
                    '<img src="' + esc(icon) + '" alt="' + esc(b.description || '') + '" width="26" height="26">' +
                '</span>';
            });
            badgeItems = badgeItems.concat(flagBadges.map(function (b) {
                return '<span class="result-badge" title="' + esc(b.name) + '">' +
                    '<img src="' + esc(b.src) + '" alt="' + esc(b.name) + '" width="22" height="22">' +
                '</span>';
            }));
            badgeHTML = badgeItems.join('');
        } else {
            badgeHTML = '<span class="result-badge-none">No public badges</span>';
        }

        var display = u.global_name || u.display_name || u.username || 'Unknown';
        var dnStyling = dnStyle(u.display_name_styles);
        var displayHTML = dnStyling
            ? '<span class="result-dn-styled" style="' + esc(dnStyling) + '">' + esc(display) + '</span>'
            : esc(display);
        var username = '@' + (u.username || '?') + (u.discriminator && u.discriminator !== '0' ? '#' + u.discriminator : '');
        var isBot = u.bot ? '<span class="result-bot-flag"><i class="fa-solid fa-robot"></i> Bot</span>' : '';
        var clanTagHTML = clan
            ? '<span class="result-clan-tag">' +
                (clanBadge ? '<img src="' + esc(clanBadge) + '" alt="" class="result-clan-badge">' : '') +
                esc(clan.tag) +
              '</span>'
            : '';

        /* Account date */
        var createdStr = created ? esc(fmtDate(created)) : 'Unknown';
        var agoStr = created ? esc(timeAgo(created)) : '';
        var daysOld = created ? (esc(daysSince(created)) + ' days old') : '';
        var discordTs = created ? discordTimestamp(created) : null;

        /* Info items */
        var infoItems = '';
        infoItems += infoItem(
            '<i class="fa-solid fa-calendar"></i> Account created',
            createdStr,
            (agoStr || daysOld ? '<i class="fa-solid fa-hourglass-half"></i> ' + agoStr + (agoStr && daysOld ? ' &middot; ' + daysOld : daysOld) : '')
        );
        infoItems += infoItem(
            '<i class="fa-solid fa-hashtag"></i> User ID',
            '<span class="result-info-mono">' + esc(u.id) + '</span>',
            null
        );
        if (accent) {
            infoItems += infoItem(
                '<i class="fa-solid fa-palette"></i> Accent color',
                '<span class="result-info-mono">' + esc(accent.toUpperCase()) + '</span>',
                '<span class="result-swatch" style="background:' + esc(accent) + '"></span>'
            );
        } else if (u.banner_color) {
            infoItems += infoItem(
                '<i class="fa-solid fa-palette"></i> Banner color',
                '<span class="result-info-mono">' + esc(u.banner_color.toUpperCase()) + '</span>',
                '<span class="result-swatch" style="background:' + esc(u.banner_color) + '"></span>'
            );
        }
        if (u.public_flags != null && u.public_flags !== 0) {
            infoItems += infoItem(
                '<i class="fa-solid fa-flag"></i> Public flags',
                '<span class="result-info-mono">' + esc(u.public_flags) + ' (dec)</span>',
                '<span class="result-info-mono">' + esc(fmtHex(u.public_flags)) + ' (hex)</span>'
            );
        }
        if (u.avatar) {
            infoItems += infoItem(
                '<i class="fa-solid fa-image"></i> Avatar hash',
                '<span class="result-info-mono">' + esc(u.avatar) + '</span>',
                (u.avatar.startsWith('a_') ? 'Animated' : 'Static')
            );
        }
        if (u.banner) {
            infoItems += infoItem(
                '<i class="fa-solid fa-image"></i> Banner hash',
                '<span class="result-info-mono">' + esc(u.banner) + '</span>',
                (u.banner.startsWith('a_') ? 'Animated' : 'Static')
            );
        }
        if (clan) {
            infoItems += infoItem(
                '<i class="fa-solid fa-guilded"></i> Clan tag',
                '<span class="result-clan-tag">' +
                    (clanBadge ? '<img src="' + esc(clanBadge) + '" alt="" class="result-clan-badge">' : '') +
                    esc(clan.tag) +
                '</span>',
                'Guild: <span class="result-info-mono">' + esc(clan.identity_guild_id) + '</span>'
            );
        }
        if (decoration) {
            infoItems += infoItem(
                '<i class="fa-solid fa-sparkles"></i> Avatar decoration',
                '<span class="result-info-mono">' + esc(u.avatar_decoration_data.asset) + '</span>',
                null
            );
        }
        if (u.display_name_styles) {
            var dns = u.display_name_styles;
            var dnsColors = (dns.colors || []).map(intToHex).filter(Boolean);
            if (dnsColors.length) {
                var swatches = dnsColors.map(function (c) {
                    return '<span class="result-swatch" style="background:' + esc(c) + '"></span>';
                }).join('');
                infoItems += infoItem(
                    '<i class="fa-solid fa-palette"></i> Display name color',
                    '<span class="result-info-mono">' + dnsColors.map(function (c) { return esc(c.toUpperCase()); }).join(' &middot; ') + '</span>',
                    swatches
                );
            }
            var dnsFont = DN_FONTS[dns.font_id] || ('Font ' + dns.font_id);
            var dnsEffect = DN_EFFECTS[dns.effect_id] || ('Effect ' + dns.effect_id);
            infoItems += infoItem(
                '<i class="fa-solid fa-text-height"></i> Display name style',
                esc(dnsFont),
                esc(dnsEffect)
            );
        }
        if (u.collectibles && u.collectibles.nameplate) {
            var nm = u.collectibles.nameplate;
            infoItems += infoItem(
                '<i class="fa-solid fa-id-badge"></i> Nameplate',
                esc((nm.label || 'Custom').replace('COLLECTIBLES_NAMEPLATES_', '').replace('_A11Y', '').replace(/_/g, ' ')),
                'Palette: ' + esc(nm.palette || '?')
            );
        }

        /* Copy rows */
        var copyRows = '';
        copyRows += copyRow('User ID', u.id || '');
        copyRows += copyRow('Username', (u.username || '') + (u.discriminator && u.discriminator !== '0' ? '#' + u.discriminator : ''));
        if (u.avatar) copyRows += copyRow('Avatar URL', avatarURL(u.id, u.avatar, 4096));
        if (banner) copyRows += copyRow('Banner URL', bannerURL(u.id, u.banner));
        if (discordTs) copyRows += copyRow('Discord Timestamp', discordTs);

        var externalLink = 'https://discord.com/users/' + encodeURIComponent(u.id);

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-banner"' + (banner ? '' : ' data-noimg') + ' style="' + bannerStyle + '"></div>' +
                '<div class="result-body">' +
                    '<div class="result-head">' +
                        '<div class="result-avatar-wrap">' +
                            '<img class="result-avatar" src="' + esc(avatar) + '" alt="' + esc(display) + '">' +
                            (decoration ? '<img class="result-avatar-decoration" src="' + esc(decoration) + '" alt="" aria-hidden="true">' : '') +
                        '</div>' +
                        '<div class="result-name-block">' +
                            '<h2 class="result-display">' + displayHTML + ' ' + clanTagHTML + ' ' + isBot + '</h2>' +
                            '<p class="result-username">' + esc(username) + '</p>' +
                            '<div class="result-badges">' + badgeHTML + '</div>' +
                        '</div>' +
                    '</div>' +

                    '<div class="result-info-grid">' + infoItems + '</div>' +

                    '<div class="result-links">' +
                        '<h3 class="result-links-title">Quick links &amp; copy</h3>' +
                        '<div class="result-copy-list">' +
                            copyRows +
                            '<a class="result-external-link" href="' + esc(externalLink) + '" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> View profile on Discord</a>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        /* Bind copy buttons */
        Array.prototype.forEach.call(resultEl.querySelectorAll('.result-copy-row'), function (row) {
            var btn = row.querySelector('.btn-copy');
            if (!btn) return;
            btn.addEventListener('click', function () {
                var val = row.getAttribute('data-value');
                navigator.clipboard && navigator.clipboard.writeText(val).then(function () {
                    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                    setTimeout(function () { btn.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 1500);
                }).catch(function () {});
            });
        });

        /* Reveal animation */
        var card = resultEl.querySelector('.result-card');
        if (card) card.classList.add('result-card-in');
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ---------- Lookup logic ---------- */
    function lookup(id) {
        if (!/^\d{17,20}$/.test(id)) {
            resultEl.innerHTML = errorHTML('That doesn\'t look like a valid Discord user ID. IDs are 17-20 digits long.');
            return;
        }

        history.replaceState(null, '', '/tools/user-lookup/?userid=' + id);
        resultEl.innerHTML = loadingHTML('Looking up...');

        fetch('/api/users/' + encodeURIComponent(id))
            .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
            .then(function (res) {
                if (!res.ok || !res.body || res.body.error) {
                    var msg = res.body && res.body.error;
                    if (msg && /400|invalid/i.test(msg)) msg = 'Invalid user ID.';
                    else if (!msg || /500|failed/i.test(msg)) msg = 'Failed to fetch user.';
                    throw msg;
                }
                renderResult(res.body);
            })
            .catch(function (err) {
                resultEl.innerHTML = errorHTML(err || 'Failed to fetch user.');
            });
    }

    /* ---------- Events ---------- */
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var id = (input.value || '').trim();
        if (!id) return;
        lookup(id);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.hint-example'), function (el) {
        el.addEventListener('click', function () {
            input.value = el.getAttribute('data-id');
            form.dispatchEvent(new Event('submit'));
        });
    });

    /* Prefill from URL (?userid=) */
    var params = new URLSearchParams(location.search);
    var prefilled = params.get('userid') || params.get('id');
    if (prefilled && /^\d{17,20}$/.test(prefilled)) {
        input.value = prefilled;
        history.replaceState(null, '', '/tools/user-lookup/?userid=' + prefilled);
        lookup(prefilled);
    }

    input.focus();
})();