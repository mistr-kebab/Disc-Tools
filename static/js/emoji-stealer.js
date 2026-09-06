/* Disc-Tools: Emoji Stealer — free CDN links for emojis & stickers */
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

    function loadingHTML(msg) {
        return '<div class="lookup-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>' + esc(msg) + '</div>';
    }

    function errorHTML(msg) {
        return '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>' + esc(msg) + '</p></div>';
    }

    function copyText(text, btn) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                flash(btn);
            }).catch(function () {
                fallbackCopy(text, btn);
            });
        } else {
            fallbackCopy(text, btn);
        }
    }

    function fallbackCopy(text, btn) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            flash(btn);
        } catch (e) {}
        document.body.removeChild(ta);
    }

    function flash(btn) {
        var original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
        btn.classList.add('copied');
        setTimeout(function () {
            btn.innerHTML = original;
            btn.classList.remove('copied');
        }, 1600);
    }

    function badge(label, cls, icon) {
        return '<span class="es-badge ' + cls + '">' +
            (icon ? '<i class="fa-solid fa-' + icon + '" aria-hidden="true"></i> ' : '') +
            esc(label) + '</span>';
    }

    /* ---------- Render ---------- */
    function renderResult(t) {
        var isSticker = t.type === 'sticker';
        var displayName = t.name || (isSticker ? 'Sticker ' + t.id : 'Emoji ' + t.id);
        var typeBadge = isSticker ? badge('Sticker', 'es-badge-sticker', 'face-grin-wide')
            : badge('Emoji', 'es-badge-emoji', 'face-smile');
        var animBadge = t.animated ? badge('Animated', 'es-badge-animated', 'wand-magic-sparkles') : '';

        var preview = '<div class="es-preview-wrap">' +
            '<img class="es-preview" src="' + esc(t.previewUrl) + '" alt="' + esc(displayName) + '" loading="lazy">' +
        '</div>';

        var meta = '<div class="es-meta">' +
            '<div class="es-name-row">' +
                '<h2 class="es-name">' + esc(displayName) + '</h2>' + typeBadge + animBadge +
            '</div>' +
            '<p class="es-id">ID: <code>' + esc(t.id) + '</code></p>' +
            (t.guildId ? '<p class="es-guild"><i class="fa-solid fa-server" aria-hidden="true"></i> From guild <code>' + esc(t.guildId) + '</code> — <a href="/tools/server-lookup/?serverid=' + esc(t.guildId) + '">look it up</a></p>' : '') +
            (t.description ? '<p class="es-desc">' + esc(t.description) + '</p>' : '') +
            (!t.name ? '<p class="es-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Pasted as plain ID — paste the full emoji (e.g. <code>&lt;:name:id&gt;</code>) to get its name.</p>' : '') +
            (t.managed ? '<p class="es-note"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Managed emoji — may only be usable in its home server.</p>' : '') +
        '</div>';

        var markup = '';
        if (!isSticker && t.markup) {
            markup = '<div class="es-copy-row">' +
                '<input class="es-copy-input" type="text" value="' + esc(t.markup) + '" readonly>' +
                '<button type="button" class="btn btn-ghost btn-sm es-copy-btn" data-copy="' + esc(t.markup) + '"><i class="fa-solid fa-copy" aria-hidden="true"></i> Copy markup</button>' +
            '</div>';
        }

        var links = '<div class="es-links">' +
            '<h3 class="es-links-title"><i class="fa-solid fa-link" aria-hidden="true"></i> Direct CDN links</h3>' +
            '<div class="es-link-list">' + t.formats.map(function (f) {
                var sizeLabel = f.size ? ' · ' + f.size + 'px' : '';
                return '<div class="es-link-item">' +
                    '<span class="es-link-format">' + esc(f.format) + sizeLabel + '</span>' +
                    '<a class="es-link-url" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.url) + '</a>' +
                    '<div class="es-link-actions">' +
                        '<button type="button" class="btn btn-ghost btn-sm es-copy-btn" data-copy="' + esc(f.url) + '"><i class="fa-solid fa-copy" aria-hidden="true"></i> Copy</button>' +
                        '<a class="btn btn-primary btn-sm" href="' + esc(f.url) + '" download="' + esc(t.name) + '-' + esc(f.format.toLowerCase()) + (f.size ? '-' + f.size : '') + '"><i class="fa-solid fa-download" aria-hidden="true"></i> Download</a>' +
                    '</div>' +
                '</div>';
            }).join('') + '</div>' +
        '</div>';

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-body">' +
                    '<div class="es-grid">' + preview + meta + '</div>' +
                    markup +
                    links +
                '</div>' +
            '</div>';

        var card = resultEl.querySelector('.result-card');
        if (card) card.classList.add('result-card-in');
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        Array.prototype.forEach.call(resultEl.querySelectorAll('.es-copy-btn'), function (btn) {
            btn.addEventListener('click', function () {
                copyText(btn.getAttribute('data-copy'), btn);
            });
        });
    }

    /* ---------- Lookup logic ---------- */
    function lookup(raw) {
        var value = String(raw || '').trim();
        var markup = value.match(/^<(a)?:(\w+):(\d{17,20})>$/);
        var legacy = value.match(/^:(\w+):(\d{17,20})$/);
        var plain = value.match(/^\d{17,20}$/);
        var loose = value.match(/(\d{17,20})/);

        if (!markup && !legacy && !plain && !loose) {
            resultEl.innerHTML = errorHTML('That doesn\'t look like an emoji or sticker. Paste something like <code>&lt;:DiscTools:1502521062544506940&gt;</code>, <code>&lt;a:wave:123456789012345678&gt;</code> or a plain ID.');
            return;
        }

        var query = markup || legacy ? value : plain ? value : loose[1];

        history.replaceState(null, '', '/tools/emoji-stealer/?id=' + encodeURIComponent(query));
        resultEl.innerHTML = loadingHTML('Fetching asset from Discord...');

        fetch('/api/emoji-stealer/' + encodeURIComponent(query))
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
                    if (res.status === 404 && res.body && res.body.hint) msg = res.body.hint;
                    else if (res.status === 404) msg = 'Emoji or sticker not found.';
                    else if (res.status === 422) msg = 'Lottie stickers cannot be downloaded as images.';
                    else if (!msg || /500|failed/i.test(msg)) msg = 'Failed to fetch asset.';
                    throw msg;
                }
                renderResult(res.body);
            })
            .catch(function (err) {
                resultEl.innerHTML = errorHTML(err || 'Failed to fetch asset.');
            });
    }

    /* ---------- Init (free, no gate) ---------- */
    function init() {
        if (gateEl) gateEl.style.display = 'none';
        if (form) form.hidden = false;

        var params = new URLSearchParams(location.search);
        var prefilled = params.get('id') || params.get('emoji');
        if (prefilled) {
            input.value = prefilled;
            lookup(prefilled);
        }
        if (input) input.focus();
    }

    /* ---------- Events ---------- */
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var value = (input.value || '').trim();
            if (!value) return;
            lookup(value);
        });
    }

    Array.prototype.forEach.call(document.querySelectorAll('.hint-example'), function (el) {
        el.addEventListener('click', function () {
            input.value = el.getAttribute('data-value');
            if (form) form.dispatchEvent(new Event('submit'));
        });
    });

    init();
})();
