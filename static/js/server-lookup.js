/* Disc-Tools: Server Lookup — fetch guild widget by ID and render server card */
(function () {
    'use strict';

    var form = document.getElementById('lookup-form');
    var input = document.getElementById('lookup-input');
    var submitBtn = document.getElementById('lookup-submit');
    var resultEl = document.getElementById('result');

    var STATUS_ICONS = {
        online: 'fa-solid fa-circle status-online',
        idle: 'fa-solid fa-circle status-idle',
        dnd: 'fa-solid fa-circle status-dnd',
        offline: 'fa-solid fa-circle status-offline',
        streaming: 'fa-solid fa-tower-broadcast status-streaming'
    };

    var VERIFICATION_LEVELS = {
        0: 'None',
        1: 'Low',
        2: 'Medium',
        3: 'High',
        4: 'Very High'
    };

    var TIER_NAMES = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' };

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

    function fmtInviteExpiry(iso) {
        if (!iso) return null;
        var d = new Date(iso);
        if (isNaN(d.getTime())) return null;
        var diff = d.getTime() - Date.now();
        if (diff <= 0) return 'Expired';
        var hours = Math.floor(diff / 3600000);
        var days = Math.floor(hours / 24);
        if (days > 0) return 'Expires in ' + days + ' day' + (days === 1 ? '' : 's');
        if (hours > 0) return 'Expires in ' + hours + ' hour' + (hours === 1 ? '' : 's');
        return 'Expires soon';
    }

    function copyRow(label, value) {
        return '<div class="result-copy-row" data-value="' + esc(value) + '">' +
            '<span class="result-copy-label">' + esc(label) + '</span>' +
            '<span class="result-copy-value">' + esc(value) + '</span>' +
            '<button type="button" class="btn-copy" aria-label="Copy ' + esc(label) + '"><i class="fa-solid fa-copy"></i></button>' +
        '</div>';
    }

    function memberStatusIcon(status) {
        return STATUS_ICONS[status] || STATUS_ICONS.offline;
    }

    function activityText(member) {
        var a = member.activity;
        if (!a) return '';
        if (a.type === 4) return a.state || '';
        var parts = [];
        if (a.name) parts.push(a.name);
        if (a.details) parts.push(a.details);
        if (a.state) parts.push(a.state);
        return parts.join(' · ');
    }

    function avatarFor(member) {
        if (member.avatar_url) return member.avatar_url;
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }

    function channelHTML(channels) {
        if (!channels || !channels.length) {
            return '<div class="server-list-empty">No public channels to display.</div>';
        }
        var items = channels
            .slice()
            .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
            .map(function (c) {
                return '<li class="server-channel">' +
                    '<i class="fa-solid fa-hashtag" aria-hidden="true"></i>' +
                    '<span class="server-channel-name">' + esc(c.name) + '</span>' +
                    '<span class="server-channel-id">' + esc(c.id) + '</span>' +
                '</li>';
            })
            .join('');
        return '<ul class="server-channel-list">' + items + '</ul>';
    }

    function membersHTML(members) {
        if (!members || !members.length) {
            return '<div class="server-list-empty">No members sharing presence to display.</div>';
        }
        var items = members.map(function (m) {
            var act = activityText(m);
            return '<li class="server-member">' +
                '<span class="server-member-avatar">' +
                    '<img src="' + esc(avatarFor(m)) + '" alt="" loading="lazy">' +
                    '<i class="' + memberStatusIcon(m.status) + '" aria-hidden="true"></i>' +
                '</span>' +
                '<span class="server-member-meta">' +
                    '<span class="server-member-name">' + esc(m.username) + '</span>' +
                    (act ? '<span class="server-member-activity">' + esc(act) + '</span>' : '') +
                '</span>' +
            '</li>';
        }).join('');
        return '<ul class="server-member-list">' + items + '</ul>';
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
    function renderResult(g) {
        var infoItems = '';
        infoItems += infoItem(
            '<i class="fa-solid fa-hashtag"></i> Server ID',
            '<span class="result-info-mono">' + esc(g.id) + '</span>',
            null
        );
        if (g.member_count != null) {
            infoItems += infoItem(
                '<i class="fa-solid fa-users"></i> Member count',
                '<span class="result-info-mono">' + esc(fmtCount(g.member_count)) + '</span>',
                null
            );
        }
        infoItems += infoItem(
            '<i class="fa-solid fa-user-check"></i> Presence',
            '<span class="result-info-mono">' + esc(fmtCount(g.presence_count)) + '</span>',
            'Members sharing presence'
        );
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
        infoItems += infoItem(
            '<i class="fa-solid fa-hashtag"></i> Public channels',
            '<span class="result-info-mono">' + esc(g.channels.length) + '</span>',
            null
        );
        infoItems += infoItem(
            '<i class="fa-solid fa-user-group"></i> Visible members',
            '<span class="result-info-mono">' + esc(g.members.length) + '</span>',
            null
        );
        if (g.features && g.features.length) {
            infoItems += infoItem(
                '<i class="fa-solid fa-star"></i> Features',
                '<span class="result-info-mono">' + esc(g.features.length) + '</span>',
                esc(g.features.slice(0, 6).join(' · '))
            );
        }

        var copyRows = '';
        copyRows += copyRow('Server ID', g.id || '');
        if (g.instant_invite) copyRows += copyRow('Invite URL', g.instant_invite);
        copyRows += copyRow('Widget JSON', g.widget_url || '');

        var bannerBg = g.banner_url || null;
        var bannerStyle = bannerBg
            ? 'background-image:url(\'' + esc(bannerBg) + '\');background-size:cover;background-position:center;'
            : 'background:linear-gradient(135deg,var(--surface-2),var(--bg));';

        setSplash(g.splash_url);

        var iconHTML = g.icon_url
            ? '<img class="result-avatar" src="' + esc(g.icon_url) + '" alt="' + esc(g.name) + '">'
            : '<div class="result-avatar result-avatar-fallback"><i class="fa-solid fa-server" aria-hidden="true"></i></div>';

        var inviteExpiry = fmtInviteExpiry(g.invite_expires_at);

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-banner"' + (bannerBg ? '' : ' data-noimg') + ' style="' + bannerStyle + '"></div>' +
                '<div class="result-body">' +
                    '<div class="result-head">' +
                        '<div class="result-avatar-wrap server-icon">' + iconHTML + '</div>' +
                        '<div class="result-name-block">' +
                            '<h2 class="result-display">' + esc(g.name) + '</h2>' +
                            '<p class="result-username">' + esc(g.id) + '</p>' +
                        '</div>' +
                    '</div>' +

                    (g.description
                        ? '<p class="server-description">' + esc(g.description) + '</p>'
                        : '') +

                    '<div class="result-info-grid">' + infoItems + '</div>' +

                    (g.instant_invite
                        ? '<div class="server-invite">' +
                            '<div class="server-invite-main">' +
                                '<i class="fa-brands fa-discord" aria-hidden="true"></i>' +
                                '<div>' +
                                    '<span class="server-invite-label">Instant invite</span>' +
                                    '<span class="server-invite-code">' + esc(g.instant_invite.replace(/^https?:\/\/(www\.)?discord(app)?\.com\/invite\//i, '')) + '</span>' +
                                    (inviteExpiry ? '<span class="server-invite-expiry">' + esc(inviteExpiry) + '</span>' : '') +
                                '</div>' +
                            '</div>' +
                            '<a class="btn btn-primary btn-sm" href="' + esc(g.instant_invite) + '" target="_blank" rel="noopener">Join <i class="fa-solid fa-arrow-right"></i></a>' +
                        '</div>'
                        : '<div class="server-invite server-invite-none">' +
                            '<i class="fa-solid fa-ban" aria-hidden="true"></i> No instant invite available for this server.' +
                        '</div>') +

                    '<div class="server-section">' +
                        '<h3 class="result-links-title"><i class="fa-solid fa-hashtag"></i> Public channels</h3>' +
                        channelHTML(g.channels) +
                    '</div>' +

                    '<div class="server-section">' +
                        '<h3 class="result-links-title"><i class="fa-solid fa-user-group"></i> Members sharing presence</h3>' +
                        membersHTML(g.members) +
                    '</div>' +

                    '<div class="result-links">' +
                        '<h3 class="result-links-title">Quick links &amp; copy</h3>' +
                        '<div class="result-copy-list">' +
                            copyRows +
                            '<a class="result-external-link" href="https://discord.com/servers/' + esc(g.id) + '" target="_blank" rel="noopener"><i class="fa-brands fa-discord"></i> View server on Discord</a>' +
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
            resultEl.innerHTML = errorHTML('That doesn\'t look like a valid Discord server ID. IDs are 17-20 digits long.');
            return;
        }

        history.replaceState(null, '', '/tools/server-lookup/?serverid=' + id);
        setSplash(null);
        resultEl.innerHTML = loadingHTML('Looking up...');

        fetch('/api/server-lookup/' + encodeURIComponent(id))
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
                    if (res.status === 401) msg = 'You need to be logged in to use Server Lookup.';
                    else if (res.status === 403) msg = 'You\'ve reached the free limit of 3 lookups. Premium members have unlimited lookups.';
                    else if (res.status === 404) msg = 'Server not found or its widget is disabled.';
                    else if (!msg || /500|failed/i.test(msg)) msg = 'Failed to fetch server.';
                    throw msg;
                }
                renderResult(res.body);
            })
            .catch(function (err) {
                resultEl.innerHTML = errorHTML(err || 'Failed to fetch server.');
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

    /* Prefill from URL (?serverid=) */
    var params = new URLSearchParams(location.search);
    var prefilled = params.get('serverid') || params.get('id');
    if (prefilled && /^\d{17,20}$/.test(prefilled)) {
        input.value = prefilled;
        history.replaceState(null, '', '/tools/server-lookup/?serverid=' + prefilled);
        lookup(prefilled);
    }

    input.focus();
})();
