/* Disc-Tools: Alt Account Lookup — premium-only alt account detection via IP hash linking (like bot /alt) */
(function () {
    'use strict';

    var gateEl = document.getElementById('gate');
    var form = document.getElementById('lookup-form');
    var input = document.getElementById('lookup-input');
    var resultEl = document.getElementById('result');

    /* ---------- Helpers ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function avatarURL(userId, avatar) {
        if (!avatar) {
            var idx = 0;
            try { idx = Number((BigInt(userId) >> 22n) % 6n); if (isNaN(idx) || idx < 0) idx = 0; } catch (e) {}
            return 'https://cdn.discordapp.com/embed/avatars/' + idx + '.png';
        }
        var ext = avatar.startsWith('a_') ? 'gif' : 'webp';
        return 'https://cdn.discordapp.com/avatars/' + userId + '/' + avatar + '.' + ext + '?size=256';
    }

    function gateHTML(title, text, btn, href) {
        return '<div class="alt-gate">' +
            '<i class="fa-solid fa-crown alt-gate-icon" aria-hidden="true"></i>' +
            '<h2>' + esc(title) + '</h2>' +
            '<p>' + esc(text) + '</p>' +
            '<a class="btn btn-primary" href="' + esc(href) + '">' + btn + '</a>' +
        '</div>';
    }

    function loadingHTML(msg) {
        return '<div class="lookup-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>' + esc(msg) + '</div>';
    }

    function errorHTML(msg) {
        return '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>' + esc(msg) + '</p></div>';
    }

    /* ---------- Render ---------- */
    function renderResult(body) {
        var links = body.links || { ipHashes: 0, linkedAccounts: [], totalLinked: 0, truncated: false };
        var t = body;
        var display = t.global_name || t.username || 'Unknown user';
        var username = '@' + (t.username || '?');
        var isBot = t.bot ? '<span class="result-bot-flag"><i class="fa-solid fa-robot"></i> Bot</span>' : '';

        var listHTML;
        if (links.linkedAccounts.length > 0) {
            listHTML = '<ul class="lk-account-list">' + links.linkedAccounts.map(function (a) {
                var name = a.globalName || a.username || 'Unknown user';
                var uname = a.username ? '@' + a.username : '';
                var botFlag = a.bot ? '<span class="lk-account-bot"><i class="fa-solid fa-robot"></i></span>' : '';
                var share = '<span class="lk-share">' +
                    '<i class="fa-solid fa-fingerprint" aria-hidden="true"></i> ' + a.sharedHashes +
                    ' shared IP hash' + (a.sharedHashes === 1 ? '' : 'es') + '</span>';
                return '<li class="lk-account">' +
                    '<img class="lk-account-avatar" src="' + esc(avatarURL(a.userId, a.avatar)) + '" alt="">' +
                    '<div class="lk-account-main">' +
                        '<span class="lk-account-name">' + esc(name) + ' ' + botFlag + '</span>' +
                        '<span class="lk-account-uname">' + esc(uname) + ' <span class="lk-account-id">' + esc(a.userId) + '</span></span>' +
                    '</div>' +
                    '<div class="lk-account-side">' +
                        share +
                        '<a class="lk-account-link" href="/tools/user-lookup/?userid=' + esc(a.userId) + '" title="Open in User Lookup"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></a>' +
                    '</div>' +
                '</li>';
            }).join('') + '</ul>';
        } else if (links.ipHashes > 0) {
            listHTML = '<p class="lk-empty">No other accounts share an IP hash with this user.</p>';
        } else {
            listHTML = '<p class="lk-empty">No IP hashes on record for this user — they never verified on this site, so no alt accounts can be derived from IP data.</p>';
        }

        var truncatedNote = links.truncated
            ? '<p class="lk-truncated"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Only the first ' + links.linkedAccounts.length + ' of ' + links.totalLinked + ' linked accounts are shown.</p>'
            : '';

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-body">' +
                    '<div class="result-head">' +
                        '<div class="result-avatar-wrap">' +
                            '<img class="result-avatar" src="' + esc(avatarURL(t.id, t.avatar)) + '" alt="' + esc(display) + '">' +
                        '</div>' +
                        '<div class="result-name-block">' +
                            '<h2 class="result-display">' + esc(display) + ' ' + isBot + '</h2>' +
                            '<p class="result-username">' + esc(username) + ' &middot; ' + esc(t.id) + '</p>' +
                        '</div>' +
                    '</div>' +

                    '<div class="lk-stats">' +
                        '<div class="lk-stat">' +
                            '<i class="fa-solid fa-fingerprint" aria-hidden="true"></i>' +
                            '<span class="lk-stat-label">IP hashes on record</span>' +
                            '<span class="lk-stat-value">' + links.ipHashes + '</span>' +
                        '</div>' +
                        '<div class="lk-stat">' +
                            '<i class="fa-solid fa-user-group" aria-hidden="true"></i>' +
                            '<span class="lk-stat-label">Alt accounts found</span>' +
                            '<span class="lk-stat-value">' + links.totalLinked + '</span>' +
                        '</div>' +
                    '</div>' +

                    '<div class="alt-section">' +
                        '<h3 class="result-links-title"><i class="fa-solid fa-link"></i> Alt accounts <span class="lk-badge">' + links.totalLinked + '</span></h3>' +
                        listHTML +
                        truncatedNote +
                    '</div>' +
                '</div>' +
            '</div>';

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

        history.replaceState(null, '', '/tools/alt-account-lookup/?userid=' + id);
        resultEl.innerHTML = loadingHTML('Checking IP hash records...');

        fetch('/api/alt-lookup/' + encodeURIComponent(id))
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
                    if (res.status === 401) msg = 'You need to be logged in to use Alt Account Lookup.';
                    else if (res.status === 403) msg = 'Alt Account Lookup is a Premium feature.';
                    else if (res.status === 404) msg = 'User not found.';
                    else if (!msg || /500|failed/i.test(msg)) msg = 'Failed to fetch user.';
                    throw msg;
                }
                renderResult(res.body);
            })
            .catch(function (err) {
                resultEl.innerHTML = errorHTML(err || 'Failed to fetch user.');
            });
    }

    /* ---------- Premium gate ---------- */
    function checkGate() {
        fetch('/api/alt-lookup/eligibility')
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (res) {
                if (!res.isLoggedIn) {
                    gateEl.innerHTML = gateHTML(
                        'Login required',
                        'Alt Account Lookup is a Premium feature. Log in with Discord to check if your account is eligible.',
                        '<i class="fa-solid fa-right-to-bracket"></i> Login with Discord',
                        '/api/auth/login?redirect=/tools/alt-account-lookup/'
                    );
                    return;
                }
                if (!res.isPremium) {
                    gateEl.innerHTML = gateHTML(
                        'Premium feature',
                        'Alt Account Lookup is only available to Premium members. Upgrade to unlock alt account detection and more tools.',
                        '<i class="fa-solid fa-crown"></i> Get Premium',
                        'https://dash.disc-tools.de/premium'
                    );
                    return;
                }
                gateEl.style.display = 'none';
                form.hidden = false;

                var params = new URLSearchParams(location.search);
                var prefilled = params.get('userid') || params.get('id');
                if (prefilled && /^\d{17,20}$/.test(prefilled)) {
                    input.value = prefilled;
                    history.replaceState(null, '', '/tools/alt-account-lookup/?userid=' + prefilled);
                    lookup(prefilled);
                }
                input.focus();
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

    checkGate();
})();