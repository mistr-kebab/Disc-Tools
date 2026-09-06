/* Disc-Tools: Username History — premium-only username change lookup */
(function () {
    'use strict';

    var form = document.getElementById('history-form');
    var input = document.getElementById('history-input');
    var submitBtn = document.getElementById('history-submit');
    var resultEl = document.getElementById('result');
    var gateEl = document.getElementById('gate');

    var isUnlocked = false;

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return 'Unknown';
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function renderGate(reason, data) {
        var icon, title, msg, btn, secondary;

        if (reason === 'login_required' || !data.isLoggedIn) {
            icon = 'fa-right-to-bracket';
            title = 'Login required';
            msg = 'Log in with Discord and upgrade to <strong>Premium</strong> to look up username histories.';
            btn = '<a href="/api/auth/login?redirect=/tools/username-history/" class="btn btn-primary"><i class="fa-brands fa-discord"></i> Login with Discord</a>';
            secondary = '<a href="https://dash.disc-tools.de/premium" rel="noopener">Learn about Premium &rarr;</a>';
        } else if (reason === 'optout' || data.optedOut) {
            icon = 'fa-eye-slash';
            title = 'You\'ve opted out';
            msg = 'You opted out of username history lookups via your dashboard settings. Opt back in to use this tool.<br><br>Your history is <strong>still being recorded</strong> while opted out — only lookups are hidden.';
            btn = '<a href="https://dash.disc-tools.de/profile/settings" class="btn btn-primary" rel="noopener"><i class="fa-solid fa-gear"></i> Go to Settings</a>';
            secondary = '';
        } else if (reason === 'premium_required') {
            icon = 'fa-crown';
            title = 'Premium feature';
            msg = 'Username History is exclusive to <strong>Premium</strong> members. Upgrade to unlock unlimited lookups of past usernames for any Discord user.';
            btn = '<a href="https://dash.disc-tools.de/premium" class="btn btn-primary" rel="noopener"><i class="fa-solid fa-crown"></i> Get Premium</a>';
            secondary = '<a href="/api/auth/login?redirect=/tools/username-history/">Already have Premium? Login &rarr;</a>';
        } else {
            icon = 'fa-circle-exclamation';
            title = 'Access denied';
            msg = 'You cannot use this tool at this time.';
            btn = '';
            secondary = '';
        }

        gateEl.innerHTML =
            '<div class="uh-gate-card">' +
                '<div class="uh-gate-icon-wrap"><i class="fa-solid ' + icon + '"></i></div>' +
                '<h2>' + esc(title) + '</h2>' +
                '<p>' + msg + '</p>' +
                (btn ? btn : '') +
                (secondary ? '<span class="uh-gate-secondary">' + secondary + '</span>' : '') +
            '</div>';
    }

    function checkEligibility() {
        gateEl.innerHTML =
            '<div class="uh-gate-card">' +
                '<div class="uh-gate-icon-wrap"><i class="fa-solid fa-spinner fa-spin"></i></div>' +
                '<h2>Checking access...</h2>' +
            '</div>';

        fetch('/api/username-history/eligibility', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.eligible) {
                    gateEl.innerHTML = '';
                    gateEl.hidden = true;
                    isUnlocked = true;
                    input.focus();

                    var params = new URLSearchParams(location.search);
                    var prefilled = params.get('userid') || params.get('id');
                    if (prefilled && /^\d{17,20}$/.test(prefilled)) {
                        input.value = prefilled;
                        form.dispatchEvent(new Event('submit'));
                    }
                    return;
                }
                isUnlocked = false;
                renderGate(data.reason, data);
            })
            .catch(function () {
                renderGate('error', { isLoggedIn: false });
            });
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

    function renderUserHeader(user) {
        var display = user.global_name || user.display_name || user.username || 'Unknown';
        var uname = '@' + (user.username || '?') + (user.discriminator && user.discriminator !== '0' ? '#' + user.discriminator : '');
        var avatar = avatarURL(user.id, user.avatar, 128);
        var isBot = user.bot ? '<span class="result-bot-flag"><i class="fa-solid fa-robot"></i> Bot</span>' : '';

        return '<div class="uh-user-header">' +
            '<img class="uh-user-avatar" src="' + esc(avatar) + '" alt="' + esc(display) + '">' +
            '<div class="uh-user-info">' +
                '<h2 class="uh-user-display">' + esc(display) + ' ' + isBot + '</h2>' +
                '<p class="uh-user-username">' + esc(uname) + '</p>' +
                '<p class="uh-user-id"><span class="result-info-mono">' + esc(user.id) + '</span></p>' +
            '</div>' +
            '<a class="uh-user-link" href="https://discord.com/users/' + encodeURIComponent(user.id) + '" target="_blank" rel="noopener" title="Open in Discord"><i class="fa-brands fa-discord"></i></a>' +
        '</div>';
    }

    function renderHistory(data, user) {
        if (data.optedOut) {
            resultEl.innerHTML = '<div class="lookup-error"><i class="fa-solid fa-eye-slash"></i><p>This user has opted out of username history lookups.</p></div>';
            return;
        }

        var INITIAL_SHOW = 3;
        var history = data.history || [];
        var html = '';

        if (user) {
            html += renderUserHeader(user);
        }

        if (!history.length) {
            html += '<div class="lookup-error"><i class="fa-solid fa-circle-info"></i><p>No username changes found for this user. Either they have never changed their username, or tracking started after their last change.</p></div>';
            resultEl.innerHTML = html;
            return;
        }

        html += '<div class="uh-card">';
        html += '<div class="uh-card-header"><i class="fa-solid fa-clock-rotate-left"></i> <span>' + history.length + ' username ' + (history.length === 1 ? 'change' : 'changes') + '</span></div>';
        html += '<div class="uh-timeline" id="uh-timeline">';

        history.forEach(function (entry, i) {
            var isLatest = i === 0;
            var hidden = i >= INITIAL_SHOW;

            html += '<div class="uh-timeline-item' + (isLatest ? ' uh-timeline-latest' : '') + (hidden ? ' uh-timeline-hidden' : '') + '">';
            html += '<div class="uh-timeline-dot"></div>';
            html += '<div class="uh-timeline-content">';
            html += '<div class="uh-timeline-names">';

            html += '<span class="uh-name-old">' + esc(entry.old_username) + '</span>';
            html += '<i class="fa-solid fa-arrow-right uh-arrow"></i>';
            html += '<span class="' + (isLatest ? 'uh-name-current' : 'uh-name-past') + '">' + esc(entry.new_username) + '</span>';
            if (isLatest) {
                html += '<span class="uh-name-label">Current</span>';
            }

            html += '</div>';
            html += '<div class="uh-timeline-date"><i class="fa-regular fa-clock"></i> ' + esc(fmtDate(entry.changed_at)) + '</div>';
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';

        if (history.length > INITIAL_SHOW) {
            html += '<button class="uh-show-more" id="uh-show-more" type="button"><i class="fa-solid fa-chevron-down"></i> Show ' + (history.length - INITIAL_SHOW) + ' more</button>';
            html += '<button class="uh-show-less" id="uh-show-less" type="button" hidden><i class="fa-solid fa-chevron-up"></i> Show less</button>';
        }

        html += '</div>';

        resultEl.innerHTML = html;

        var showMoreBtn = resultEl.querySelector('#uh-show-more');
        var showLessBtn = resultEl.querySelector('#uh-show-less');
        if (showMoreBtn) {
            showMoreBtn.addEventListener('click', function () {
                Array.prototype.forEach.call(resultEl.querySelectorAll('.uh-timeline-hidden'), function (el) {
                    el.classList.remove('uh-timeline-hidden');
                    el.classList.add('uh-timeline-revealed');
                });
                showMoreBtn.hidden = true;
                showLessBtn.hidden = false;
            });
        }
        if (showLessBtn) {
            showLessBtn.addEventListener('click', function () {
                Array.prototype.forEach.call(resultEl.querySelectorAll('.uh-timeline-revealed'), function (el) {
                    el.classList.add('uh-timeline-hidden');
                    el.classList.remove('uh-timeline-revealed');
                });
                showLessBtn.hidden = true;
                showMoreBtn.hidden = false;
                resultEl.querySelector('#uh-timeline').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        }

        var card = resultEl.querySelector('.uh-card');
        if (card) card.classList.add('result-card-in');
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function search(id) {
        if (!/^\d{17,20}$/.test(id)) {
            resultEl.innerHTML = '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>That doesn\'t look like a valid Discord user ID. IDs are 17-20 digits long.</p></div>';
            return;
        }

        history.replaceState(null, '', '/tools/username-history/?userid=' + id);
        resultEl.innerHTML = '<div class="lookup-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>Fetching history...</div>';

        Promise.all([
            fetch('/api/users/' + encodeURIComponent(id), { credentials: 'include' }).then(function (r) { return r.json(); }).catch(function () { return null; }),
            fetch('/api/username-history/' + encodeURIComponent(id), { credentials: 'include' }).then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
        ]).then(function (results) {
            var userInfo = results[0];
            var res = results[1];

            if (!res.ok || !res.body || res.body.error) {
                if (res.body && res.body.reason === 'premium_required') {
                    renderGate('premium_required', { isLoggedIn: true });
                    resultEl.innerHTML = '';
                    return;
                }
                if (res.body && res.body.reason === 'login_required') {
                    renderGate('login_required', { isLoggedIn: false });
                    resultEl.innerHTML = '';
                    return;
                }
                if (res.body && res.body.reason === 'optout') {
                    renderGate('optout', { isLoggedIn: true, optedOut: true });
                    resultEl.innerHTML = '';
                    return;
                }
                throw (res.body && res.body.error) || 'Failed to fetch history.';
            }
            renderHistory(res.body, userInfo);
        })
            .catch(function (err) {
                resultEl.innerHTML = '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>' + esc(err || 'Failed to fetch history.') + '</p></div>';
            });
    }

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!isUnlocked) return;
        var id = (input.value || '').trim();
        if (!id) return;
        search(id);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.hint-example'), function (el) {
        el.addEventListener('click', function () {
            if (!isUnlocked) return;
            input.value = el.getAttribute('data-id');
            form.dispatchEvent(new Event('submit'));
        });
    });

    checkEligibility();
})();
