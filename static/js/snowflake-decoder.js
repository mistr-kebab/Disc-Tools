/* Disc-Tools: Snowflake Decoder — client-side, no API needed */
(function () {
    'use strict';

    var EPOCH = 1420070400000n; /* Discord epoch: 2015-01-01T00:00:00.000Z */
    var MASK_5 = (1n << 5n) - 1n;
    var MASK_12 = (1n << 12n) - 1n;
    var MASK_10 = (1n << 10n) - 1n;

    var form = document.getElementById('decode-form');
    var input = document.getElementById('decode-input');
    var result = document.getElementById('result');

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function decode(idStr) {
        var id = BigInt(idStr);
        if (id < 0n || id >= 1n << 64n) return { error: 'This number does not fit in 64 bits — not a valid Discord snowflake.' };

        var increment = id & MASK_12;
        var workerId = (id >> 12n) & MASK_5;
        var processId = (id >> 17n) & MASK_5;
        var internal = (id >> 12n) & MASK_10;
        var timestampMs = id >> 22n;
        var epochMs = Number(timestampMs + EPOCH);

        if (timestampMs < 0n) return { error: 'Invalid snowflake — timestamp is negative.' };
        if (epochMs < Number(EPOCH)) return { error: 'This ID predates the Discord epoch (2015-01-01) — not a Discord snowflake.' };

        var bin64 = id.toString(2).padStart(64, '0');
        var tsBits = bin64.slice(0, 42);
        var workerBits = bin64.slice(42, 47);
        var processBits = bin64.slice(47, 52);
        var incBits = bin64.slice(52);

        var date = new Date(epochMs);

        return {
            id: idStr,
            epochMs: epochMs,
            seconds: Math.floor(epochMs / 1000),
            dateIso: date.toISOString(),
            dateLocal: date.toLocaleString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }),
            workerId: Number(workerId),
            processId: Number(processId),
            increment: Number(increment),
            internal: Number(internal),
            bin64: bin64,
            tsBits: tsBits,
            workerBits: workerBits,
            processBits: processBits,
            incBits: incBits
        };
    }

    function stat(label, value, copy) {
        return '<div class="sd-stat">' +
            '<span class="sd-stat-label">' + esc(label) + '</span>' +
            '<div class="sd-stat-value">' +
            '<span class="sd-stat-text">' + value + '</span>' +
            (copy ? '<button type="button" class="sd-copy" data-copy="' + esc(copy) + '" aria-label="Copy ' + esc(label) + '"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>' : '') +
            '</div></div>';
    }

    function render(d) {
        var html = '';
        html += '<div class="sd-card">';
        html += '<div class="sd-date">' +
            '<i class="fa-solid fa-calendar-days" aria-hidden="true"></i>' +
            '<div><div class="sd-date-main">' + esc(d.dateLocal) + '</div>' +
            '<div class="sd-date-sub">' + esc(d.dateIso) + '</div></div>' +
            '<button type="button" class="sd-copy" data-copy="' + esc(d.dateIso) + '" aria-label="Copy ISO date"><i class="fa-solid fa-copy" aria-hidden="true"></i></button>' +
            '</div>';
        html += '</div>';

        html += '<div class="sd-card">';
        html += '<div class="sd-grid">';
        html += stat('Timestamp (ms)', d.epochMs.toLocaleString('en-US'), String(d.epochMs));
        html += stat('Timestamp (s)', d.seconds.toLocaleString('en-US'), String(d.seconds));
        html += stat('Worker ID', String(d.workerId));
        html += stat('Process ID', String(d.processId));
        html += stat('Increment', String(d.increment), String(d.increment));
        html += stat('Internal (worker + process)', String(d.internal));
        html += '</div>';
        html += '</div>';

        html += '<div class="sd-card">';
        html += '<div class="sd-bits-title"><i class="fa-solid fa-binary" aria-hidden="true"></i> 64-bit breakdown</div>';
        html += '<div class="sd-bits" dir="ltr">' +
            '<span class="sd-bits-ts" title="Timestamp — 42 bits">' + esc(d.tsBits) + '</span>' +
            '<span class="sd-bits-worker" title="Worker ID — 5 bits">' + esc(d.workerBits) + '</span>' +
            '<span class="sd-bits-process" title="Process ID — 5 bits">' + esc(d.processBits) + '</span>' +
            '<span class="sd-bits-inc" title="Increment — 12 bits">' + esc(d.incBits) + '</span>' +
            '</div>';
        html += '<div class="sd-legend">' +
            '<span><i class="sd-dot sd-dot-ts"></i> Timestamp (42 bits)</span>' +
            '<span><i class="sd-dot sd-dot-worker"></i> Worker (5 bits)</span>' +
            '<span><i class="sd-dot sd-dot-process"></i> Process (5 bits)</span>' +
            '<span><i class="sd-dot sd-dot-inc"></i> Increment (12 bits)</span>' +
            '</div>';
        html += '<div class="sd-bits-copy"><button type="button" class="sd-copy" data-copy="' + esc(d.bin64) + '" aria-label="Copy binary"><i class="fa-solid fa-copy" aria-hidden="true"></i> Copy binary</button></div>';
        html += '</div>';

        result.innerHTML = html;
        result.classList.add('has-result');
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

    result.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-copy]');
        if (btn) {
            copyText(btn.getAttribute('data-copy'));
            flash(btn);
        }
    });

    form.addEventListener('submit', function (e) {
        e.preventDefault();
        var raw = input.value.trim();
        if (!/^\d{17,20}$/.test(raw)) {
            result.innerHTML = '<div class="sd-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Please enter a valid Discord ID (17-20 digits).</div>';
            result.classList.add('has-result');
            input.focus();
            return;
        }
        var d = decode(raw);
        if (d.error) {
            result.innerHTML = '<div class="sd-error"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ' + esc(d.error) + '</div>';
            result.classList.add('has-result');
            return;
        }
        render(d);
    });

    document.addEventListener('click', function (e) {
        var hint = e.target.closest('.hint-example');
        if (hint) {
            input.value = hint.getAttribute('data-id');
            input.dispatchEvent(new Event('input'));
            form.dispatchEvent(new Event('submit'));
        }
    });
})();