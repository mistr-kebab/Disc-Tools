/* Disc-Tools: Color Picker — HEX / RGB / HSL / integer conversions */
(function () {
    'use strict';

    var nativeInput = document.getElementById('cp-native');
    var sliders = {
        r: document.getElementById('cp-r'),
        g: document.getElementById('cp-g'),
        b: document.getElementById('cp-b')
    };
    var sliderVals = {
        r: document.getElementById('cp-r-val'),
        g: document.getElementById('cp-g-val'),
        b: document.getElementById('cp-b-val')
    };
    var hexInput = document.getElementById('cp-hex');
    var rgbEl = document.getElementById('cp-rgb');
    var hslEl = document.getElementById('cp-hsl');
    var intEl = document.getElementById('cp-int');
    var preview = document.getElementById('cp-preview');
    var previewHex = document.getElementById('cp-preview-hex');

    var rgb = { r: 88, g: 101, b: 242 };

    /* ---------- Helpers ---------- */
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* ---------- Conversions ---------- */
    function clamp(v, min, max) {
        return Math.min(max, Math.max(min, v));
    }

    function toHex(c) {
        return '#' + [c.r, c.g, c.b].map(function (v) {
            return v.toString(16).toUpperCase().padStart(2, '0');
        }).join('');
    }

    function toRgbString(c) {
        return 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
    }

    function toHsl(c) {
        var r = c.r / 255, g = c.g / 255, b = c.b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
            else if (max === g) h = ((b - r) / d + 2);
            else h = ((r - g) / d + 4);
            h *= 60;
        }

        var hs = (Math.round(h * 10) / 10);
        var ss = Math.round(s * 1000) / 10;
        var ls = Math.round(l * 1000) / 10;
        if (ss === 0) hs = 0;
        return 'hsl(' + hs + ', ' + ss + '%, ' + ls + '%)';
    }

    function toInt(c) {
        return (c.r << 16) | (c.g << 8) | c.b;
    }

    function luminance(c) {
        var r = c.r / 255, g = c.g / 255, b = c.b / 255;
        var lin = function (v) {
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }

    function parseHex(str) {
        var m = String(str).trim().match(/^#?([0-9a-fA-F]{6})$/);
        if (!m) return null;
        return {
            r: parseInt(m[1].slice(0, 2), 16),
            g: parseInt(m[1].slice(2, 4), 16),
            b: parseInt(m[1].slice(4, 6), 16)
        };
    }

    /* ---------- Render ---------- */
    function update() {
        var hex = toHex(rgb);
        var hexStr = hex;

        nativeInput.value = hexStr;
        sliders.r.value = rgb.r;
        sliders.g.value = rgb.g;
        sliders.b.value = rgb.b;
        sliderVals.r.textContent = rgb.r;
        sliderVals.g.textContent = rgb.g;
        sliderVals.b.textContent = rgb.b;

        if (document.activeElement !== hexInput) hexInput.value = hexStr;
        rgbEl.textContent = toRgbString(rgb);
        hslEl.textContent = toHsl(rgb);
        intEl.textContent = toInt(rgb);

        preview.style.background = hexStr;
        previewHex.textContent = hexStr;
        previewHex.style.color = luminance(rgb) > 0.5 ? '#0a0d13' : '#ffffff';

        Array.prototype.forEach.call(document.querySelectorAll('.cp-copy[data-copy]'), function (btn) {
            var target = btn.getAttribute('data-copy');
            if (btn.parentElement.querySelector('#cp-hex') === hexInput) btn.setAttribute('data-copy', hexStr);
            else if (btn.parentElement.querySelector('#cp-rgb') === rgbEl) btn.setAttribute('data-copy', toRgbString(rgb));
            else if (btn.parentElement.querySelector('#cp-hsl') === hslEl) btn.setAttribute('data-copy', toHsl(rgb));
            else if (btn.parentElement.querySelector('#cp-int') === intEl) btn.setAttribute('data-copy', String(toInt(rgb)));
        });

        scheduleSave();
    }

    /* ---------- Presets ---------- */
    var PRESETS = [
        { hex: '#5865F2', name: 'Blurple' },
        { hex: '#4752C4', name: 'Blurple strong' },
        { hex: '#7C85F0', name: 'Blurple soft' },
        { hex: '#4ECB8D', name: 'Success' },
        { hex: '#F0B232', name: 'Premium gold' },
        { hex: '#ED4245', name: 'Danger' },
        { hex: '#0A0D13', name: 'Site background' },
        { hex: '#12161F', name: 'Surface' },
        { hex: '#171C29', name: 'Surface 2' },
        { hex: '#232C40', name: 'Border' },
        { hex: '#EDF1FA', name: 'Text' },
        { hex: '#9AA5BC', name: 'Text muted' },
        { hex: '#000000', name: 'Black' },
        { hex: '#FFFFFF', name: 'White' }
    ];

    var recentEl = document.getElementById('cp-recent');
    var recentHint = document.getElementById('cp-recent-hint');
    var recentCount = document.getElementById('cp-recent-count');
    var loggedIn = false;
    var recentColors = [];
    var saveTimer = null;
    var lastSavedHex = null;

    /* ---------- Swatches ---------- */
    function swatchHTML(hex, title) {
        return '<div class="cp-swatch" data-apply="' + esc(hex) + '" title="Apply ' + esc(title || hex) + '">' +
            '<span class="cp-swatch-color" aria-hidden="true" style="background:' + esc(hex) + '"></span>' +
            '<span class="cp-swatch-hex">' + esc(hex) + '</span>' +
            '<button type="button" class="cp-swatch-copy" data-copy="' + esc(hex) + '" aria-label="Copy ' + esc(hex) + '"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>' +
        '</div>';
    }

    function renderPresets() {
        document.getElementById('cp-presets').innerHTML = PRESETS.map(function (p) {
            return swatchHTML(p.hex, p.name + ' — ' + p.hex);
        }).join('');
    }

    function renderRecent() {
        if (!loggedIn) {
            recentHint.textContent = 'Log in with Discord to keep your last 5 colors here.';
            recentHint.hidden = false;
        } else if (recentColors.length === 0) {
            recentHint.textContent = 'Pick a color and it will be saved here automatically.';
            recentHint.hidden = false;
        } else {
            recentHint.hidden = true;
        }
        recentCount.textContent = recentColors.length + '/5';
        recentEl.innerHTML = recentColors.map(function (hex) {
            return swatchHTML(hex, 'Recent — ' + hex);
        }).join('');
    }

    /* ---------- History API ---------- */
    function loadHistory() {
        fetch('/api/color-picker/history')
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (res) {
                loggedIn = !!res.isLoggedIn;
                recentColors = Array.isArray(res.colors) ? res.colors.slice(0, 5) : [];
                renderRecent();
            });
    }

    function saveColor() {
        var hex = toHex(rgb);
        if (!loggedIn || hex === lastSavedHex) return;
        lastSavedHex = hex;
        fetch('/api/color-picker/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: hex })
        })
            .then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (res) {
                if (res.isLoggedIn && Array.isArray(res.colors)) {
                    loggedIn = true;
                    recentColors = res.colors.slice(0, 5);
                    renderRecent();
                }
            })
            .catch(function () {});
    }

    function scheduleSave() {
        if (!loggedIn) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveColor, 700);
    }

    function applyColor(hex) {
        var parsed = parseHex(hex);
        if (!parsed) return;
        rgb = parsed;
        update();
    }

    /* ---------- Copy ---------- */
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

    function flashCheck(btn) {
        var original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
        btn.classList.add('copied');
        setTimeout(function () {
            btn.innerHTML = original;
            btn.classList.remove('copied');
        }, 1600);
    }

    /* ---------- Events ---------- */
    nativeInput.addEventListener('input', function () {
        var parsed = parseHex(nativeInput.value);
        if (parsed) {
            rgb = parsed;
            update();
        }
    });

    Object.keys(sliders).forEach(function (channel) {
        sliders[channel].addEventListener('input', function () {
            rgb[channel] = parseInt(sliders[channel].value, 10);
            update();
        });
    });

    hexInput.addEventListener('input', function () {
        var parsed = parseHex(hexInput.value);
        if (parsed) {
            rgb = parsed;
            update();
        }
    });

    hexInput.addEventListener('blur', function () {
        hexInput.value = toHex(rgb);
    });

    document.getElementById('cp-random').addEventListener('click', function () {
        rgb = {
            r: Math.floor(Math.random() * 256),
            g: Math.floor(Math.random() * 256),
            b: Math.floor(Math.random() * 256)
        };
        update();
    });

    Array.prototype.forEach.call(document.querySelectorAll('.cp-copy'), function (btn) {
        btn.addEventListener('click', function () {
            copyText(btn.getAttribute('data-copy'), btn);
        });
    });

    /* ---------- Swatch events (delegated, swatches re-render) ---------- */
    document.addEventListener('click', function (e) {
        var copyBtn = e.target.closest('[data-copy]');
        if (copyBtn) {
            if (copyBtn.classList.contains('cp-swatch-copy')) flashCheck(copyBtn);
            else copyText(copyBtn.getAttribute('data-copy'), copyBtn);
            return;
        }
        var applyBtn = e.target.closest('[data-apply]');
        if (applyBtn) {
            applyColor(applyBtn.getAttribute('data-apply'));
        }
    });

    renderPresets();
    loadHistory();
    update();
})();