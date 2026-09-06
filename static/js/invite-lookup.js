/* Disc-Tools: Invite Lookup — fetch invite metadata by code and render guild card */
(function () {
    'use strict';

    var form = document.getElementById('lookup-form');
    var input = document.getElementById('lookup-input');
    var submitBtn = document.getElementById('lookup-submit');
    var resultEl = document.getElementById('result');

    var VERIFICATION_LEVELS = {
        0: 'None',
        1: 'Low',
        2: 'Medium',
        3: 'High',
        4: 'Very High'
    };

    var TIER_NAMES = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };

    var CHANNEL_TYPES = {
        0: 'Text channel',
        2: 'Voice channel',
        4: 'Forum',
        5: 'Announcement channel',
        13: 'Stage channel',
        14: 'Directory',
        15: 'Media channel',
        16: 'Voice stage'
    };

    /* ---------- Helpers ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtCount(n) {
        n = Number(n) || 0;
        if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    function fmtDate(iso) {
        if (!iso) return null;
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function timeUntil(iso) {
        if (!iso) return null;
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        var diff = d.getTime() - Date.now();
        if (diff <= 0) return 'Expired';
        var hours = Math.floor(diff / 3600000);
        var days = Math.floor(hours / 24);
        if (days > 0) return 'Expires in ' + days + ' day' + (days === 1 ? '' : 's');
        if (hours > 0) return 'Expires in ' + hours + ' hour' + (hours === 1 ? '' : 's');
        var mins = Math.floor(diff / 60000);
        return 'Expires in ' + mins + ' min';
    }

    function parseCode(raw) {
        var s = String(raw || '').trim();
        var m = s.match(/(?:discord(?:app)?\.com\/invite\/|discord\.gg\/)([A-Za-z0-9_-]+)/i);
        if (m) return m[1];
        if (/^[A-Za-z0-9_-]{1,20}$/.test(s)) return s;
        return null;
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

    function setSplash(url) {
        var layer = document.getElementById('server-bg-layer');
        if (!url) {
            if (layer) layer.style.backgroundImage = '';
            return;
        }
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'server-bg-layer';
            document.body.appendChild(layer);
        }
        layer.style.backgroundImage = 'url(\'' + esc(url) + '\')';
    }

    /* ---------- Render result ---------- */
    function renderResult(data) {
        var g = data.guild || {};
        var inviter = data.inviter || null;
        var channel = data.channel || null;

        var bannerBg = g.banner_url || null;
        var bannerStyle = bannerBg
            ? 'background-image:url(\'' + esc(bannerBg) + '\');background-size:cover;background-position:center;'
            : 'background:linear-gradient(135deg,var(--surface-2),var(--bg));';

        setSplash(g.splash_url);

        var iconHTML = g.icon_url
            ? '<img class="result-avatar" src="' + esc(g.icon_url) + '" alt="' + esc(g.name) + '">'
            : '<div class="result-avatar result-avatar-fallback"><i class="fa-solid fa-server" aria-hidden="true"></i></div>';

        var infoItems = '';
        if (data.member_count != null) {
            infoItems += infoItem(
                '<i class="fa-solid fa-users"></i> Member count',
                '<span class="result-info-mono">' + esc(fmtCount(data.member_count)) + '</span>',
                null
            );
        }
        if (data.presence_count != null) {
            infoItems += infoItem(
                '<i class="fa-solid fa-user-check"></i> Online',
                '<span class="result-info-mono">' + esc(fmtCount(data.presence_count)) + '</span>',
                null
            );
        }
        if (g.boost_count != null) {
            infoItems += infoItem(
                '<i class="fa-solid fa-gem"></i> Server boosts',
                '<span class="result-info-mono">' + esc(fmtCount(g.boost_count)) + '</span>',
                g.premium_tier ? 'Boost level: ' + esc(TIER_NAMES[g.premium_tier] || ('Tier ' + g.premium_tier)) : null
            );
        }
        if (g.verification_level != null) {
            infoItems += infoItem(
                '<i class="fa-solid fa-shield-halved"></i> Verification',
                '<span class="result-info-mono">' + esc(VERIFICATION_LEVELS[g.verification_level] || g.verification_level) + '</span>',
                null
            );
        }
        if (g.nsfw) {
            infoItems += infoItem(
                '<i class="fa-solid fa-triangle-exclamation"></i> NSFW',
                '<span class="result-info-mono">Yes</span>',
                null
            );
        }
        if (channel && channel.name) {
            infoItems += infoItem(
                '<i class="fa-solid fa-hashtag"></i> Channel',
                '<span class="result-info-mono">' + esc(channel.name) + '</span>',
                CHANNEL_TYPES[channel.type] ? esc(CHANNEL_TYPES[channel.type]) : null
            );
        }
        if (inviter) {
            var inviterName = inviter.global_name || inviter.username || 'Unknown';
            infoItems += infoItem(
                '<i class="fa-solid fa-user-pen"></i> Inviter',
                esc(inviterName),
                inviter.bot ? 'Bot account' : null
            );
        }
        if (data.expires_at) {
            infoItems += infoItem(
                '<i class="fa-solid fa-hourglass-half"></i> Expiry',
                '<span class="result-info-mono">' + esc(fmtDate(data.expires_at)) + '</span>',
                esc(timeUntil(data.expires_at))
            );
        } else {
            infoItems += infoItem(
                '<i class="fa-solid fa-infinity"></i> Expiry',
                '<span class="result-info-mono">Never</span>',
                'No expiry set'
            );
        }
        if (g.features && g.features.length) {
            infoItems += infoItem(
                '<i class="fa-solid fa-star"></i> Features',
                '<span class="result-info-mono">' + esc(g.features.length) + '</span>',
                esc(g.features.slice(0, 6).join(' · '))
            );
        }

        var copyRows = '';
        copyRows += copyRow('Invite code', data.code || '');
        if (g.id) copyRows += copyRow('Server ID', g.id);
        copyRows += copyRow('Invite URL', 'https://discord.gg/' + (data.code || ''));
        if (g.vanity_url_code) copyRows += copyRow('Vanity URL', 'https://discord.gg/' + g.vanity_url_code);
        if (inviter && inviter.id) copyRows += copyRow('Inviter ID', inviter.id);
        if (channel && channel.id) copyRows += copyRow('Channel ID', channel.id);

        var inviterHTML = '';
        if (inviter) {
            var inviterAvatar = inviter.avatar_url
                ? '<img class="invite-inviter-avatar" src="' + esc(inviter.avatar_url) + '" alt="">'
                : '<span class="invite-inviter-avatar invite-inviter-avatar-none"><i class="fa-solid fa-user" aria-hidden="true"></i></span>';
            inviterHTML =
                '<div class="server-section">' +
                    '<h3 class="result-links-title"><i class="fa-solid fa-user-pen"></i> Created by</h3>' +
                    '<div class="invite-inviter">' +
                        inviterAvatar +
                        '<div class="invite-inviter-meta">' +
                            '<span class="invite-inviter-name">' + esc(inviter.global_name || inviter.username || 'Unknown') +
                                (inviter.bot ? ' <span class="result-bot-flag"><i class="fa-solid fa-robot"></i> Bot</span>' : '') +
                            '</span>' +
                            '<span class="invite-inviter-user">@' + esc(inviter.username || '?') +
                                '<span class="result-info-mono">' + ' · ' + esc(inviter.id || '') + '</span>' +
                            '</span>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        }

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-banner"' + (bannerBg ? '' : ' data-noimg') + ' style="' + bannerStyle + '"></div>' +
                '<div class="result-body">' +
                    '<div class="result-head">' +
                        '<div class="result-avatar-wrap server-icon">' + iconHTML + '</div>' +
                        '<div class="result-name-block">' +
                            '<h2 class="result-display">' +
                                '<i class="fa-solid fa-link invite-head-icon" aria-hidden="true"></i> ' + esc(g.name || 'Unknown server') +
                            '</h2>' +
                            '<p class="result-username">discord.gg/' + esc(data.code || '') + '</p>' +
                        '</div>' +
                    '</div>' +

                    (g.description
                        ? '<p class="server-description">' + esc(g.description) + '</p>'
                        : '') +

                    '<div class="result-info-grid">' + infoItems + '</div>' +

                    inviterHTML +

                    '<div class="result-links">' +
                        '<h3 class="result-links-title">Quick links &amp; copy</h3>' +
                        '<div class="result-copy-list">' +
                            copyRows +
                            '<a class="result-external-link" href="https://discord.gg/' + esc(data.code || '') + '" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> Join server</a>' +
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
    function lookup(code) {
        var parsed = parseCode(code);
        if (!parsed) {
            resultEl.innerHTML = errorHTML('That doesn\'t look like a valid invite code.');
            return;
        }

        history.replaceState(null, '', '/tools/invite-lookup/?code=' + encodeURIComponent(parsed));
        setSplash(null);
        resultEl.innerHTML = loadingHTML('Looking up...');

        fetch('/api/invite-lookup/' + encodeURIComponent(parsed))
            .then(function (r) {
                var ct = r.headers.get('content-type') || '';
                if (ct.indexOf('application/json') === -1) {
                    throw new Error('Unexpected server response (please try again).');
                }
                return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
            })
            .then(function (res) {
                if (!res.ok || !res.body || res.body.error) {
                    var msg = res.body && res.body.error;
                    if (res.status === 401) msg = 'You need to be logged in to use Invite Lookup.';
                    else if (res.status === 403) msg = 'You\'ve reached the free limit of 3 lookups. Premium members have unlimited lookups.';
                    else if (res.status === 404) msg = 'Invite not found or expired.';
                    else if (!msg || /500|failed/i.test(msg)) msg = 'Failed to fetch invite.';
                    throw msg;
                }
                renderResult(res.body);
            })
            .catch(function (err) {
                resultEl.innerHTML = errorHTML(err || 'Failed to fetch invite.');
            });
    }

    /* ---------- Events ---------- */
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = (input.value || '').trim();
        if (!code) return;
        lookup(code);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.hint-example'), function (el) {
        el.addEventListener('click', function () {
            input.value = el.getAttribute('data-id');
            form.dispatchEvent(new Event('submit'));
        });
    });

    /* Prefill from URL (?code=) */
    var params = new URLSearchParams(location.search);
    var prefilled = params.get('code') || params.get('invite');
    if (prefilled) {
        input.value = prefilled;
        lookup(prefilled);
    }

    input.focus();
})();