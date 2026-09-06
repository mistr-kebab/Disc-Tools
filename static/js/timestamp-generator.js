/* Disc-Tools: Timestamp Generator — <t:> formats + decode, client-side */
(function () {
    'use strict';

    var MAX_UNIX = 253402300799; /* 9999-12-31T23:59:59Z */

    var datetimeInput = document.getElementById('tg-datetime');
    var tzSelect = document.getElementById('tg-tz');
    var rowsEl = document.getElementById('tg-rows');
    var nowBtn = document.getElementById('tg-now');
    var decodeInput = document.getElementById('tg-decode');
    var decodeBtn = document.getElementById('tg-decode-btn');
    var decodeResult = document.getElementById('tg-decode-result');
    var lastSec = null;

    setInterval(function () {
        var el = document.getElementById('tg-r-example');
        if (el && lastSec !== null) el.textContent = relative(lastSec);
    }, 1000);

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    /* Wall-clock components of ms in a given IANA timezone */
    function wall(ms, tz) {
        var p = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(new Date(ms));
        var o = {};
        p.forEach(function (x) { if (x.type !== 'literal') o[x.type] = parseInt(x.value, 10); });
        o.hour = o.hour === 24 ? 0 : o.hour;
        return o;
    }

    /* Offset in minutes of tz at a given ms (positive = ahead of UTC) */
    function tzOffsetMin(ms, tz) {
        var w = wall(ms, tz);
        var utc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
        return Math.round((utc - ms) / 60000);
    }

    /* Convert local wall time (components) interpreted in tz to unix seconds */
    function toUnixSec(y, mo, d, h, mi, tz) {
        if (tz === 'local') {
            return Math.floor(new Date(y, mo - 1, d, h, mi, 0, 0).getTime() / 1000);
        }
        var utc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
        var ms = utc - tzOffsetMin(utc, tz) * 60000;
        var off2 = tzOffsetMin(ms, tz);
        if (off2 !== tzOffsetMin(utc, tz)) ms = utc - off2 * 60000;
        return Math.floor(ms / 1000);
    }

    function fmt(ms, tz, opts) {
        return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz, hour12: false }, opts)).format(new Date(ms));
    }

    function shortTime(ms, tz) {
        var s = fmt(ms, tz, { hour: '2-digit', minute: '2-digit' });
        return s === '24:00' ? '00:00' : s;
    }

    function shortDate(ms, tz) {
        return fmt(ms, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function longDate(ms, tz) {
        return fmt(ms, tz, { day: 'numeric', month: 'long', year: 'numeric' });
    }

    function weekday(ms, tz) {
        return fmt(ms, tz, { weekday: 'long' });
    }

    function relative(sec) {
        var diff = sec * 1000 - Date.now();
        var abs = Math.abs(diff);
        var units = [
            [31536000000, 'year'], [2592000000, 'month'], [604800000, 'week'],
            [86400000, 'day'], [3600000, 'hour'], [60000, 'minute'], [1000, 'second']
        ];
        for (var i = 0; i < units.length; i++) {
            if (abs >= units[i][0]) {
                var n = Math.round(abs / units[i][0]);
                var label = units[i][1] + (n === 1 ? '' : 's');
                return (diff < 0 ? n + ' ' + label + ' ago' : 'in ' + n + ' ' + label);
            }
        }
        return 'now';
    }

    function formatRow(letter, name, example, sec, code) {
        return '<div class="tg-row">' +
            '<div class="tg-row-label">' +
            '<span class="tg-format-badge">' + esc(letter) + '</span>' +
            '<span class="tg-format-name">' + esc(name) + '</span>' +
            '</div>' +
            '<div class="tg-row-example"' + (letter === 'R' ? ' id="tg-r-example"' : '') + '>' + esc(example) + '</div>' +
            '<div class="tg-row-code">' +
            '<code>' + esc(code) + '</code>' +
            '<button type="button" class="tg-copy" data-copy="' + esc(code) + '" aria-label="Copy ' + esc(code) + '"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>' +
            '</div>' +
            '</div>';
    }

    function generate() {
        var val = datetimeInput.value;
        if (!val) return;
        var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(val);
        if (!m) return;
        var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10),
            h = parseInt(m[4], 10), mi = parseInt(m[5], 10);
        if (y < 1970 || y > 9999) return;
        var tz = tzSelect.value;
        var sec = toUnixSec(y, mo, d, h, mi, tz);
        var ms = sec * 1000;

        var t = shortTime(ms, tz);
        var secs = pad(wall(ms, tz).second);
        var T = t + ':' + secs;
        var dd = shortDate(ms, tz);
        var D = longDate(ms, tz);
        var f = D + ' ' + t;
        var F = weekday(ms, tz) + ', ' + f;
        var R = relative(sec);

        var rows = '';
        rows += formatRow('t', 'Short Time', t, sec, '<t:' + sec + ':t>');
        rows += formatRow('T', 'Long Time', T, sec, '<t:' + sec + ':T>');
        rows += formatRow('d', 'Short Date', dd, sec, '<t:' + sec + ':d>');
        rows += formatRow('D', 'Long Date', D, sec, '<t:' + sec + ':D>');
        rows += formatRow('f', 'Short Date/Time', f, sec, '<t:' + sec + ':f>');
        rows += formatRow('F', 'Long Date/Time', F, sec, '<t:' + sec + ':F>');
        rows += formatRow('R', 'Relative Time', R, sec, '<t:' + sec + ':R>');
        rowsEl.innerHTML = rows;
        lastSec = sec;
    }

    function flash(btn) {
        var original = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
        btn.classList.add('copied');
        setTimeout(function () {
            btn.innerHTML = original;
            btn.classList.remove('copied');
        }, 1600);
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
        } else {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    rowsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-copy]');
        if (btn) {
            copyText(btn.getAttribute('data-copy'));
            flash(btn);
        }
    });

    function decode() {
        var raw = decodeInput.value.trim();
        var m = /^(?:<t:)?(\d{1,13})(?::[tTdDfFR])?>?$/.exec(raw);
        if (!m) {
            decodeResult.innerHTML = '<div class="tg-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Enter a Unix timestamp (e.g. 1778263293) or a Discord code like <code>&lt;t:1778263293:f&gt;</code>.</div>';
            return;
        }
        var sec = parseInt(m[1], 10);
        if (sec > MAX_UNIX) {
            decodeResult.innerHTML = '<div class="tg-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> That timestamp is out of range (max 253402300799 = 9999-12-31).</div>';
            return;
        }
        var ms = sec * 1000;
        var date = new Date(ms);
        var iso = date.toISOString();
        var local = date.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        decodeResult.innerHTML =
            '<div class="tg-decode-grid">' +
            '<div class="tg-decode-item"><span class="tg-decode-label">UTC</span><span class="tg-decode-value">' + esc(iso) + '</span><button type="button" class="tg-copy" data-copy="' + esc(iso) + '" aria-label="Copy UTC"><i class="fa-solid fa-copy" aria-hidden="true"></i></button></div>' +
            '<div class="tg-decode-item"><span class="tg-decode-label">Local</span><span class="tg-decode-value">' + esc(local) + '</span></div>' +
            '<div class="tg-decode-item"><span class="tg-decode-label">Seconds</span><span class="tg-decode-value">' + sec.toLocaleString('en-US') + '</span><button type="button" class="tg-copy" data-copy="' + sec + '" aria-label="Copy seconds"><i class="fa-solid fa-copy" aria-hidden="true"></i></button></div>' +
            '<div class="tg-decode-item"><span class="tg-decode-label">Milliseconds</span><span class="tg-decode-value">' + ms.toLocaleString('en-US') + '</span><button type="button" class="tg-copy" data-copy="' + ms + '" aria-label="Copy milliseconds"><i class="fa-solid fa-copy" aria-hidden="true"></i></button></div>' +
            '</div>';
    }

    decodeResult.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-copy]');
        if (btn) {
            copyText(btn.getAttribute('data-copy'));
            flash(btn);
        }
    });

    datetimeInput.addEventListener('input', generate);
    tzSelect.addEventListener('change', generate);
    nowBtn.addEventListener('click', function () {
        tzSelect.value = 'local';
        var d = new Date();
        d.setSeconds(0, 0);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        datetimeInput.value = d.toISOString().slice(0, 16);
        generate();
    });
    decodeBtn.addEventListener('click', decode);
    decodeInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') decode();
    });

    var now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    datetimeInput.value = now.toISOString().slice(0, 16);
    generate();
})();