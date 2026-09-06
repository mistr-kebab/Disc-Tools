/* Disc-Tools: Account Checker — free with login, alt risk score from public account signals */
(function () {
    'use strict';

    var form = document.getElementById('lookup-form');
    var input = document.getElementById('lookup-input');
    var resultEl = document.getElementById('result');

    var DISCORD_EPOCH_MS = 1420070400000;

    /* ---------- Helpers ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function snowflakeDate(id) {
        try {
            var ms = Number((BigInt(id) >> 22n) + BigInt(DISCORD_EPOCH_MS));
            return new Date(ms);
        } catch (e) { return null; }
    }

    function daysOld(id) {
        var d = snowflakeDate(id);
        if (!d || isNaN(d.getTime())) return null;
        return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    }

    function fmtDate(d) {
        if (!d || isNaN(d.getTime())) return 'Unknown';
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    function defaultAvatarURL(userId) {
        var idx = 0;
        try { idx = Number((BigInt(userId) >> 22n) % 6n); if (isNaN(idx) || idx < 0) idx = 0; } catch (e) {}
        return 'https://cdn.discordapp.com/embed/avatars/' + idx + '.png';
    }

    function avatarURL(userId, avatar) {
        if (!avatar) return defaultAvatarURL(userId);
        var ext = avatar.startsWith('a_') ? 'gif' : 'webp';
        return 'https://cdn.discordapp.com/avatars/' + userId + '/' + avatar + '.' + ext + '?size=256';
    }

    function loadingHTML(msg) {
        return '<div class="lookup-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>' + esc(msg) + '</div>';
    }

    function errorHTML(msg) {
        return '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>' + esc(msg) + '</p></div>';
    }

    /* ---------- Alt scoring ---------- */
    function computeScore(u, manualBadges) {
        var factors = [];
        var score = 0;

        var days = daysOld(u.id);

        if (days != null) {
            if (days < 7) { score += 35; factors.push({ label: 'Account is only ' + days + ' day' + (days === 1 ? '' : 's') + ' old', points: 35, type: 'bad' }); }
            else if (days < 30) { score += 25; factors.push({ label: 'Account is under a month old (' + days + ' days)', points: 25, type: 'bad' }); }
            else if (days < 90) { score += 15; factors.push({ label: 'Account is under 3 months old (' + days + ' days)', points: 15, type: 'bad' }); }
            else if (days < 180) { score += 8; factors.push({ label: 'Account is under 6 months old (' + days + ' days)', points: 8, type: 'bad' }); }
            else if (days < 365) { score += 4; factors.push({ label: 'Account is under a year old (' + days + ' days)', points: 4, type: 'bad' }); }
            else { factors.push({ label: 'Account is ' + days + ' days old', points: 0, type: 'good' }); }
        }

        if (!u.avatar) { score += 15; factors.push({ label: 'Default avatar (no custom avatar set)', points: 15, type: 'bad' }); }
        else { factors.push({ label: 'Has a custom avatar', points: 0, type: 'good' }); }

        var badgeCount = (u.public_flags ? 1 : 0) + (Array.isArray(u.badges) ? u.badges.length : 0) + (manualBadges || 0);
        if (u.bot) {
            factors.push({ label: 'Bot account', points: 0, type: 'neutral' });
        } else if (badgeCount === 0) {
            score += 10; factors.push({ label: 'No badges on the account', points: 10, type: 'bad' });
        } else if (manualBadges) {
            factors.push({ label: 'Has ' + badgeCount + ' badge' + (badgeCount === 1 ? '' : 's') + ' (incl. ' + manualBadges + ' added manually)', points: 0, type: 'good' });
        } else {
            factors.push({ label: 'Has ' + badgeCount + ' badge' + (badgeCount === 1 ? '' : 's'), points: 0, type: 'good' });
        }

        if (u.premium_since) {
            score -= 15;
            factors.push({ label: 'Boosting a server (invested in the account)', points: -15, type: 'good' });
        }

        if (u._guildMember) {
            score -= 10;
            factors.push({ label: 'Member of the Disc-Tools community', points: -10, type: 'good' });
        }

        if (u.avatar_decoration_data && u.avatar_decoration_data.asset) {
            score -= 5;
            factors.push({ label: 'Has an avatar decoration', points: -5, type: 'good' });
        }

        if (u.display_name_styles && u.display_name_styles.font_id) {
            score -= 5;
            factors.push({ label: 'Custom display name styling', points: -5, type: 'good' });
        }

        if (u.clan && u.clan.tag) {
            score -= 5;
            factors.push({ label: 'Member of a clan', points: -5, type: 'good' });
        }

        if (u.bot) score = 0;

        return { score: score, factors: factors, days: days };
    }

    function verdict(score) {
        if (score <= 0) return { label: 'Looks legit', cls: 'alt-verdict-good', icon: 'fa-circle-check' };
        if (score <= 20) return { label: 'Probably fine', cls: 'alt-verdict-good', icon: 'fa-circle-check' };
        if (score <= 40) return { label: 'Suspicious', cls: 'alt-verdict-warn', icon: 'fa-circle-exclamation' };
        if (score <= 60) return { label: 'Very suspicious', cls: 'alt-verdict-warn', icon: 'fa-circle-exclamation' };
        return { label: 'Very likely an alt', cls: 'alt-verdict-danger', icon: 'fa-circle-xmark' };
    }

    function verdictColor(value) {
        if (value >= 80) return '#23a55a';
        if (value >= 60) return '#f0b232';
        if (value >= 40) return '#f07c22';
        return '#ed4245';
    }

    /* ---------- Render ---------- */
    function renderResult(u) {
        var res = computeScore(u);
        var badSum = 0;
        res.factors.forEach(function (f) { if (f.type === 'bad') badSum += f.points; });
        var value = Math.max(0, Math.min(100, 100 - badSum));
        var v = verdict(badSum);
        var color = verdictColor(value);

        var display = u.global_name || u.display_name || u.username || 'Unknown';
        var username = '@' + (u.username || '?') + (u.discriminator && u.discriminator !== '0' ? '#' + u.discriminator : '');
        var created = snowflakeDate(u.id);
        var isBot = u.bot ? '<span class="result-bot-flag"><i class="fa-solid fa-robot"></i> Bot</span>' : '';
        var premiumFlag = u.premium_since ? '<span class="alt-flag alt-flag-boost"><i class="fa-solid fa-gem"></i> Boosting a server</span>' : '';
        var memberFlag = u._guildMember ? '<span class="alt-flag alt-flag-member"><i class="fa-solid fa-user-check"></i> In the community</span>' : '';

        var factorItems = res.factors.map(function (f) {
            var cls = f.type === 'bad' ? 'alt-factor-bad' : (f.type === 'good' ? 'alt-factor-good' : 'alt-factor-neutral');
            var icon = f.type === 'bad' ? 'fa-circle-minus' : (f.type === 'good' ? 'fa-circle-plus' : 'fa-circle');
            var pts = f.points > 0 ? '-' + f.points : (f.points < 0 ? '+' + (-f.points) : '0');
            return '<li class="alt-factor ' + cls + '">' +
                '<i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
                '<span class="alt-factor-label">' + esc(f.label) + '</span>' +
                '<span class="alt-factor-points">' + pts + '</span>' +
            '</li>';
        }).join('');

        var ringLabel = String(value);
        var ringSub = '/ 100';

        var GAUGE_C = 2 * Math.PI * 45;
        var GAUGE_PX = GAUGE_C / 100;
        var GAUGE_GAP = 18;
        var RING_PATH = 'M 50 5 A 45 45 0 1 1 50 95 A 45 45 0 1 1 50 5';
        var gapPx = (GAUGE_GAP / 360) * GAUGE_C;
        var pArc = Math.max(0, Math.min(100, value));
        var scale = badSum > 0 ? 0.9 : 1;
        var greenPct = pArc * scale;
        var redPct = badSum * scale;
        var greenOffset = -(gapPx.toFixed(2));
        var redOffset = -((gapPx + greenPct * GAUGE_PX).toFixed(2));
        var primaryDash = (greenPct * GAUGE_PX).toFixed(2) + ' ' + GAUGE_C.toFixed(2);
        var redDash = (redPct * GAUGE_PX).toFixed(2) + ' ' + GAUGE_C.toFixed(2);
        var gaugeSecDash = (((90 - greenPct - redPct) * GAUGE_PX).toFixed(2)) + ' ' + GAUGE_C.toFixed(2);
        var gaugeSec = ((90 - greenPct - redPct) > 0)
            ? '<path d="' + RING_PATH + '" fill="none" stroke-width="10" class="alt-ring-track" style="stroke-dasharray:' + (((90 - greenPct - redPct) * GAUGE_PX).toFixed(2)) + ' ' + GAUGE_C.toFixed(2) + ';stroke-dashoffset:-' + ((gapPx + (greenPct + redPct) * GAUGE_PX).toFixed(2)) + ';"/>'
            : '';

        var badgesSection = u.bot ? '' :
            '<div class="alt-section alt-badges">' +
                '<h3 class="result-links-title"><i class="fa-solid fa-medal"></i> Badges</h3>' +
                '<button type="button" class="alt-badges-toggle" aria-expanded="false">' +
                    '<i class="fa-solid fa-circle-info" aria-hidden="true"></i> The bot can\'t see every badge — what\'s missing?' +
                    '<i class="fa-solid fa-chevron-down alt-badges-chev" aria-hidden="true"></i>' +
                '</button>' +
                '<div class="alt-badges-info" hidden>' +
                    '<p>As a bot we can only see Discord system badges: Staff, Partner, HypeSquad, Bug Hunter Lvl 1/2, Early Supporter, Verified Bot, Verified Developer, Certified Moderator and Active Developer.</p>' +
                    '<p>Badges like <strong>Nitro</strong>, <strong>Server Boosting</strong>, <strong>Server Supporter</strong> or custom profile badges are <strong>not visible</strong> — so the badge factor may not be accurate. Add badges you can see on the profile:</p>' +
                    '<div class="alt-badge-options">' +
                        '<label class="alt-badge-option"><input type="checkbox" value="nitro"><span><i class="fa-solid fa-gem" aria-hidden="true"></i> Nitro subscription</span></label>' +
                        '<label class="alt-badge-option"><input type="checkbox" value="boost"><span><i class="fa-solid fa-rocket" aria-hidden="true"></i> Server Boosting</span></label>' +
                        '<label class="alt-badge-option"><input type="checkbox" value="supporter"><span><i class="fa-solid fa-handshake-angle" aria-hidden="true"></i> Server Supporter</span></label>' +
                        '<label class="alt-badge-option"><input type="checkbox" value="profile"><span><i class="fa-solid fa-id-badge" aria-hidden="true"></i> Profile badge (collectible / unique)</span></label>' +
                    '</div>' +
                    '<p class="alt-badges-note">The score updates automatically.</p>' +
                '</div>' +
            '</div>';

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-body alt-body">' +
                    '<div class="result-head">' +
                        '<div class="result-avatar-wrap">' +
                            '<img class="result-avatar" src="' + esc(avatarURL(u.id, u.avatar)) + '" alt="' + esc(display) + '">' +
                        '</div>' +
                        '<div class="result-name-block">' +
                            '<h2 class="result-display">' + esc(display) + ' ' + isBot + '</h2>' +
                            '<p class="result-username">' + esc(username) + '</p>' +
                            '<div class="alt-flags">' + premiumFlag + memberFlag + '</div>' +
                        '</div>' +
                    '</div>' +

                    '<div class="alt-score-wrap">' +
                        '<div class="alt-ring">' +
                            '<svg viewBox="0 0 100 100" width="150" height="150" aria-hidden="true">' +
                                gaugeSec +
                                '<path d="' + RING_PATH + '" fill="none" stroke-width="10" class="alt-ring-bad" stroke="#ed4245" style="stroke-dasharray:0 ' + GAUGE_C.toFixed(2) + ';stroke-dashoffset:' + redOffset + ';"/>' +
                                '<path d="' + RING_PATH + '" fill="none" stroke-width="10" class="alt-ring-value" stroke="' + color + '" style="stroke-dasharray:0 ' + GAUGE_C.toFixed(2) + ';stroke-dashoffset:' + greenOffset + ';"/>' +
                            '</svg>' +
                            '<div class="alt-ring-score">' +
                                '<span class="alt-ring-number" style="color:' + color + '">' + ringLabel + '</span>' +
                                '<span class="alt-ring-label">' + ringSub + '</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="alt-summary">' +
                            '<span class="alt-verdict ' + v.cls + '"><i class="fa-solid ' + v.icon + '" aria-hidden="true"></i> ' + esc(v.label) + '</span>' +
                            '<p class="alt-summary-text">Based on public signals. A low score means the account shows typical fake account signs — not a guarantee.</p>' +
                        '</div>' +
                    '</div>' +

                    '<div class="alt-section">' +
                        '<h3 class="result-links-title"><i class="fa-solid fa-scale-balanced"></i> Risk factors</h3>' +
                        '<ul class="alt-factor-list">' + factorItems + '</ul>' +
                    '</div>' +

                    badgesSection +

                    '<div class="result-info-grid">' +
                        '<div class="result-info-item">' +
                            '<span class="result-info-label"><i class="fa-solid fa-calendar"></i> Account created</span>' +
                            '<span class="result-info-value">' + (created ? esc(fmtDate(created)) : 'Unknown') + '</span>' +
                            '<span class="result-info-sub">' + (res.days != null ? esc(res.days + ' days ago') : '') + '</span>' +
                        '</div>' +
                        '<div class="result-info-item">' +
                            '<span class="result-info-label"><i class="fa-solid fa-hashtag"></i> User ID</span>' +
                            '<span class="result-info-value result-info-mono">' + esc(u.id) + '</span>' +
                            '<span class="result-info-sub">Snowflake ID — use it in any lookup tool</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';

        var card = resultEl.querySelector('.result-card');
        if (card) card.classList.add('result-card-in');

        var arcElInit = resultEl.querySelector('.alt-ring-value');
        var secElInit = resultEl.querySelector('.alt-ring-track');
        var badElInit = resultEl.querySelector('.alt-ring-bad');
        var numElInit = resultEl.querySelector('.alt-ring-number');
        if (arcElInit) {
            setTimeout(function () {
                arcElInit.style.strokeDasharray = primaryDash;
                if (secElInit) secElInit.style.strokeDasharray = gaugeSecDash;
                if (badElInit) badElInit.style.strokeDasharray = redDash;
            }, 60);
        }
        if (numElInit) {
            numElInit.style.animation = 'none';
            void numElInit.offsetWidth;
            numElInit.style.animation = '';
        }

        /* ---------- Badges section: toggle + live rescore ---------- */
        var badgeChecks = resultEl.querySelectorAll('.alt-badge-options input');
        if (badgeChecks.length > 0) {
            var toggleBtn = resultEl.querySelector('.alt-badges-toggle');
            var infoBox = resultEl.querySelector('.alt-badges-info');

            toggleBtn.addEventListener('click', function () {
                var open = infoBox.hidden;
                infoBox.hidden = !open;
                toggleBtn.setAttribute('aria-expanded', String(open));
                toggleBtn.classList.toggle('alt-badges-open', open);
            });

            var numberEl = resultEl.querySelector('.alt-ring-number');
            var labelEl = resultEl.querySelector('.alt-ring-label');
            var arcEl = resultEl.querySelector('.alt-ring-value');
            var secEl = resultEl.querySelector('.alt-ring-track');
            var badEl = resultEl.querySelector('.alt-ring-bad');
            var verdictEl = resultEl.querySelector('.alt-verdict');
            var factorListEl = resultEl.querySelector('.alt-factor-list');

            function gaugeSet(good, bad) {
                var sc = bad > 0 ? 0.9 : 1;
                var g = Math.max(0, Math.min(100, good)) * sc;
                var b = Math.max(0, Math.min(100, bad)) * sc;
                arcEl.style.strokeDasharray = (g * GAUGE_PX).toFixed(2) + ' ' + GAUGE_C.toFixed(2);
                if (badEl) {
                    badEl.style.strokeDasharray = (b * GAUGE_PX).toFixed(2) + ' ' + GAUGE_C.toFixed(2);
                    badEl.style.strokeDashoffset = -((gapPx + g * GAUGE_PX).toFixed(2));
                }
                if (secEl) {
                    var rest = 90 - g - b;
                    secEl.style.strokeDasharray = (rest > 0 ? (rest * GAUGE_PX).toFixed(2) : '0') + ' ' + GAUGE_C.toFixed(2);
                    secEl.style.strokeDashoffset = -((gapPx + (g + b) * GAUGE_PX).toFixed(2));
                }
            }

            function refreshScore() {
                var manual = 0;
                Array.prototype.forEach.call(badgeChecks, function (c) { if (c.checked) manual++; });
                var r = computeScore(u, manual);
                var bad = 0;
                r.factors.forEach(function (f) { if (f.type === 'bad') bad += f.points; });
                var val = Math.max(0, Math.min(100, 100 - bad));
                var vv = verdict(bad);
                var cc = verdictColor(val);

                numberEl.textContent = String(val);
                numberEl.style.color = cc;
                labelEl.textContent = '/ 100';
                arcEl.setAttribute('stroke', cc);
                gaugeSet(val, bad);

                verdictEl.className = 'alt-verdict ' + vv.cls;
                verdictEl.innerHTML = '<i class="fa-solid ' + vv.icon + '" aria-hidden="true"></i> ' + esc(vv.label);

                factorListEl.innerHTML = r.factors.map(function (f) {
                    var cls = f.type === 'bad' ? 'alt-factor-bad' : (f.type === 'good' ? 'alt-factor-good' : 'alt-factor-neutral');
                    var icon = f.type === 'bad' ? 'fa-circle-minus' : (f.type === 'good' ? 'fa-circle-plus' : 'fa-circle');
                    var pts = f.points > 0 ? '-' + f.points : (f.points < 0 ? '+' + (-f.points) : '0');
                    return '<li class="alt-factor ' + cls + '">' +
                        '<i class="fa-solid ' + icon + '" aria-hidden="true"></i>' +
                        '<span class="alt-factor-label">' + esc(f.label) + '</span>' +
                        '<span class="alt-factor-points">' + pts + '</span>' +
                    '</li>';
                }).join('');

                numberEl.style.animation = 'none';
                void numberEl.offsetWidth;
                numberEl.style.animation = '';
            }

            Array.prototype.forEach.call(badgeChecks, function (c) {
                c.addEventListener('change', refreshScore);
            });
        }

        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* ---------- Lookup logic ---------- */
    function lookup(id) {
        if (!/^\d{17,20}$/.test(id)) {
            resultEl.innerHTML = errorHTML('That doesn\'t look like a valid Discord user ID. IDs are 17-20 digits long.');
            return;
        }

        history.replaceState(null, '', '/tools/account-checker/?userid=' + id);
        resultEl.innerHTML = loadingHTML('Looking up...');

        fetch('/api/user-lookup/' + encodeURIComponent(id))
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
                    if (res.status === 401) msg = 'You need to be logged in to use Account Checker.';
                    else if (res.status === 403) msg = 'You\'ve reached the free limit of 3 lookups. Premium members have unlimited lookups.';
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

    /* ---------- Prefill from URL ---------- */
    function prefill() {
        var params = new URLSearchParams(location.search);
        var prefilled = params.get('userid') || params.get('id');
        if (prefilled && /^\d{17,20}$/.test(prefilled)) {
            input.value = prefilled;
            history.replaceState(null, '', '/tools/account-checker/?userid=' + prefilled);
            lookup(prefilled);
        }
        input.focus();
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

    prefill();
})();