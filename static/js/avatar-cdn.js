/* Disc-Tools: Avatar CDN — free CDN links for any Discord avatar */
(function () {
    'use strict';

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

    /* ---------- Custom dropdown registry ---------- */
    var ddClosers = [];
    function closeAllDDs() {
        ddClosers.forEach(function (fn) { fn(); });
    }
    document.addEventListener('click', closeAllDDs);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeAllDDs();
    });

    /* ---------- Render ---------- */
    function renderResult(t) {
        var display = t.globalName || t.username || 'Unknown user';
        var animBadge = t.animated ? badge('Animated', 'es-badge-animated', 'wand-magic-sparkles') : '';
        var defaultBadge = !t.hasAvatar ? badge('Default avatar', 'es-badge-emoji', 'user') : '';

        var preview = '<div class="es-preview-wrap es-preview-avatar">' +
            '<img class="es-preview" id="ac-preview-img" src="' + esc(t.previewUrl) + '" alt="' + esc(display) + '" loading="lazy">' +
        '</div>';

        var meta = '<div class="es-meta">' +
            '<div class="es-name-row">' +
                '<h2 class="es-name">' + esc(display) + '</h2>' + animBadge + defaultBadge +
            '</div>' +
            '<p class="es-id">ID: <code>' + esc(t.id) + '</code> &middot; <a href="/tools/user-lookup/?userid=' + esc(t.id) + '">open in User Lookup</a></p>' +
            (!t.hasAvatar ? '<p class="es-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> This user has no custom avatar — showing Discord\'s default avatar.</p>' : '') +
        '</div>';

        // Build format/size options from the server response
        var formats = [];
        var sizes = [];
        t.formats.forEach(function (f) {
            if (formats.indexOf(f.format) === -1) formats.push(f.format);
            if (sizes.indexOf(f.size) === -1) sizes.push(f.size);
        });
        var defaultSize = sizes.indexOf(256) !== -1 ? 256 : sizes[0];
        var defaultFormat = formats[0];

        function findEntry(format, size) {
            for (var i = 0; i < t.formats.length; i++) {
                if (t.formats[i].format === format && t.formats[i].size === size) return t.formats[i];
            }
            return t.formats[0];
        }

        function ddOptionHTML(value, selected, label) {
            var cls = selected ? ' ac-dd-option-selected' : '';
            return '<button type="button" class="ac-dd-option' + cls + '" data-dd-opt="' + esc(value) + '">' +
                '<i class="fa-solid fa-check ac-dd-check" aria-hidden="true"></i>' +
                '<span>' + esc(label(value)) + '</span>' +
            '</button>';
        }

        function ddHTML(id, label, values, selected, labelFn) {
            var options = values.map(function (v) {
                return ddOptionHTML(v, v === selected, labelFn);
            }).join('');
            return '<div class="ac-picker-field">' + label +
                '<div class="ac-dd" data-dd="' + id + '">' +
                    '<button type="button" class="ac-dd-btn" data-dd-btn aria-haspopup="listbox" aria-expanded="false">' +
                        '<span data-dd-label>' + esc(labelFn(selected)) + '</span>' +
                        '<i class="fa-solid fa-chevron-down ac-dd-chev" aria-hidden="true"></i>' +
                    '</button>' +
                    '<div class="ac-dd-menu" data-dd-menu role="listbox">' + options + '</div>' +
                '</div>' +
            '</div>';
        }

        function wireDropdown(dd, onChange) {
            var btn = dd.querySelector('[data-dd-btn]');
            var menu = dd.querySelector('[data-dd-menu]');
            var label = dd.querySelector('[data-dd-label]');
            var options = Array.prototype.slice.call(dd.querySelectorAll('[data-dd-opt]'));

            function open() {
                dd.classList.add('is-open');
                btn.setAttribute('aria-expanded', 'true');
                btn.classList.add('ac-dd-open');
            }
            function close() {
                dd.classList.remove('is-open');
                btn.setAttribute('aria-expanded', 'false');
                btn.classList.remove('ac-dd-open');
            }

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (dd.classList.contains('is-open')) close();
                else { closeAllDDs(); open(); }
            });

            options.forEach(function (opt) {
                opt.addEventListener('click', function (e) {
                    e.stopPropagation();
                    options.forEach(function (o) { o.classList.remove('ac-dd-option-selected'); });
                    opt.classList.add('ac-dd-option-selected');
                    label.textContent = opt.querySelector('span').textContent;
                    onChange(opt.getAttribute('data-dd-opt'));
                    close();
                });
            });

            return close;
        }

        var picker = '<div class="ac-picker">' +
            ddHTML('ac-dd-format', 'Format', formats, defaultFormat, function (f) { return f; }) +
            ddHTML('ac-dd-size', 'Size', sizes, defaultSize, function (s) { return s + 'px'; }) +
        '</div>';

        var links = '<div class="es-links">' +
            '<h3 class="es-links-title"><i class="fa-solid fa-link" aria-hidden="true"></i> Direct CDN link</h3>' +
            '<div class="es-link-item" id="ac-link-item">' +
                '<span class="es-link-format" id="ac-link-format"></span>' +
                '<a class="es-link-url" id="ac-link-url" href="#" target="_blank" rel="noopener"></a>' +
                '<div class="es-link-actions">' +
                    '<button type="button" class="btn btn-ghost btn-sm es-copy-btn" id="ac-copy-btn"><i class="fa-solid fa-copy" aria-hidden="true"></i> Copy</button>' +
                    '<a class="btn btn-primary btn-sm" id="ac-download-btn" href="#"><i class="fa-solid fa-download" aria-hidden="true"></i> Download</a>' +
                '</div>' +
            '</div>' +
        '</div>';

        resultEl.innerHTML =
            '<div class="result-card">' +
                '<div class="result-body">' +
                    '<div class="es-grid">' + preview + meta + '</div>' +
                    picker +
                    links +
                '</div>' +
            '</div>';

        var card = resultEl.querySelector('.result-card');
        if (card) card.classList.add('result-card-in');
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        var formatSel = document.getElementById('ac-format');
        var sizeSel = document.getElementById('ac-size');
        var linkItem = document.getElementById('ac-link-item');
        var formatLabel = document.getElementById('ac-link-format');
        var linkUrl = document.getElementById('ac-link-url');
        var copyBtn = document.getElementById('ac-copy-btn');
        var downloadBtn = document.getElementById('ac-download-btn');
        var previewImg = document.getElementById('ac-preview-img');

        var currentFormat = defaultFormat;
        var currentSize = defaultSize;

        function updateLink() {
            var entry = findEntry(currentFormat, currentSize);
            formatLabel.textContent = entry.format + ' · ' + entry.size + 'px';
            linkUrl.href = entry.url;
            linkUrl.textContent = entry.url;
            copyBtn.setAttribute('data-copy', entry.url);
            downloadBtn.href = entry.url;
            downloadBtn.setAttribute('download', 'avatar-' + t.id + '-' + entry.format.toLowerCase() + '-' + entry.size);
            previewImg.src = entry.url;
        }

        ddClosers.push(wireDropdown(document.querySelector('[data-dd="ac-dd-format"]'), function (v) {
            currentFormat = v;
            updateLink();
        }));
        ddClosers.push(wireDropdown(document.querySelector('[data-dd="ac-dd-size"]'), function (v) {
            currentSize = Number(v);
            updateLink();
        }));

        copyBtn.addEventListener('click', function () {
            copyText(copyBtn.getAttribute('data-copy'), copyBtn);
        });

        updateLink();
    }

    /* ---------- Lookup logic ---------- */
    function lookup(id) {
        if (!/^\d{17,20}$/.test(id)) {
            resultEl.innerHTML = errorHTML('That doesn\'t look like a valid Discord user ID. IDs are 17-20 digits long.');
            return;
        }

        history.replaceState(null, '', '/tools/avatar-cdn/?userid=' + id);
        resultEl.innerHTML = loadingHTML('Fetching user from Discord...');

        fetch('/api/avatar-cdn/' + encodeURIComponent(id))
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
                    if (res.status === 404) msg = 'User not found.';
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
    form.hidden = false;

    var params = new URLSearchParams(location.search);
    var prefilled = params.get('userid') || params.get('id');
    if (prefilled && /^\d{17,20}$/.test(prefilled)) {
        input.value = prefilled;
        history.replaceState(null, '', '/tools/avatar-cdn/?userid=' + prefilled);
        lookup(prefilled);
    }
    input.focus();

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
})();