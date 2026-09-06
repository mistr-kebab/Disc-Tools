/* Disc-Tools: Markdown Generator — Discord markdown with live preview */
(function () {
    'use strict';

    var input = document.getElementById('mg-input');
    var preview = document.getElementById('mg-preview');
    var rawEl = document.getElementById('mg-raw');
    var countEl = document.getElementById('mg-count');
    var copyBtn = document.getElementById('mg-copy');
    var clearBtn = document.getElementById('mg-clear');

    var LIMIT = 2000;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function copyText(text, btn) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { flash(btn); }).catch(function () { fallback(text, btn); });
        } else {
            fallback(text, btn);
        }
    }

    function fallback(text, btn) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); flash(btn); } catch (e) {}
        document.body.removeChild(ta);
    }

    function flash(btn) {
        if (!btn) return;
        var orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
        btn.classList.add('copied');
        setTimeout(function () { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1400);
    }

    function flashText(btn, origText) {
        var orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
        btn.classList.add('copied');
        setTimeout(function () { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1400);
    }

    /* ---------- Selection helpers ---------- */
    function getSel() {
        return { start: input.selectionStart, end: input.selectionEnd, value: input.value };
    }

    function setSel(start, end) {
        input.focus();
        input.setSelectionRange(start, end);
    }

    function wrapSelection(prefix, suffix, placeholder) {
        var s = getSel();
        var start = s.start, end = s.end, v = s.value;
        var selected = v.slice(start, end) || placeholder || 'text';
        var before = v.slice(0, start);
        var after = v.slice(end);
        var next = before + prefix + selected + suffix + after;
        // Enforce limit
        if (next.length > LIMIT) next = next.slice(0, LIMIT);
        input.value = next;
        var selStart = start + prefix.length;
        var selEnd = selStart + selected.length;
        input.dispatchEvent(new Event('input'));
        setTimeout(function () { setSel(selStart, selEnd); update(); }, 0);
    }

    function prefixLine(prefix) {
        var s = getSel();
        var start = s.start, end = s.end, v = s.value;
        // Find line start for selection
        var lineStart = v.lastIndexOf('\n', start - 1) + 1;
        var lineEndIdx = v.indexOf('\n', end);
        if (lineEndIdx === -1) lineEndIdx = v.length;
        var before = v.slice(0, lineStart);
        var selectedBlock = v.slice(lineStart, lineEndIdx);
        var after = v.slice(lineEndIdx);

        var lines = selectedBlock.split('\n');
        var newLines = lines.map(function (line) {
            // Toggle: if already has prefix, remove it
            if (line.startsWith(prefix)) {
                return line.slice(prefix.length);
            }
            // Special handling for headings: remove other heading prefixes
            if (prefix.match(/^#{1,3} $/)) {
                line = line.replace(/^#{1,3}\s+/, '');
                line = line.replace(/^-#\s+/, '');
                line = line.replace(/^>\s?/, '');
                line = line.replace(/^[-*]\s+/, '');
                line = line.replace(/^\d+\.\s+/, '');
            }
            if (prefix === '> ') {
                line = line.replace(/^#{1,3}\s+/, '');
                line = line.replace(/^-#\s+/, '');
            }
            if (prefix === '-# ') {
                line = line.replace(/^#{1,3}\s+/, '');
            }
            return prefix + line;
        });

        var newBlock = newLines.join('\n');
        var next = before + newBlock + after;
        if (next.length > LIMIT) next = next.slice(0, LIMIT);
        input.value = next;
        input.dispatchEvent(new Event('input'));
        setTimeout(function () {
            // Select new block
            setSel(lineStart, lineStart + newBlock.length);
            update();
        }, 0);
    }

    function prefixLineOrdered() {
        var s = getSel();
        var start = s.start, end = s.end, v = s.value;
        var lineStart = v.lastIndexOf('\n', start -1) + 1;
        var lineEndIdx = v.indexOf('\n', end);
        if (lineEndIdx === -1) lineEndIdx = v.length;
        var before = v.slice(0, lineStart);
        var block = v.slice(lineStart, lineEndIdx);
        var after = v.slice(lineEndIdx);
        var lines = block.split('\n');
        var newLines = lines.map(function (line, idx) {
            if (/^\d+\.\s+/.test(line)) return line.replace(/^\d+\.\s+/, '');
            line = line.replace(/^#{1,3}\s+/, '').replace(/^-#\s+/, '').replace(/^>\s?/, '').replace(/^[-*]\s+/, '');
            return (idx + 1) + '. ' + line;
        });
        var newBlock = newLines.join('\n');
        var next = before + newBlock + after;
        if (next.length > LIMIT) next = next.slice(0, LIMIT);
        input.value = next;
        input.dispatchEvent(new Event('input'));
        setTimeout(function () { setSel(lineStart, lineStart + newBlock.length); update(); }, 0);
    }

    function insertAtCursor(text) {
        var s = getSel();
        var start = s.start, end = s.end, v = s.value;
        var next = v.slice(0, start) + text + v.slice(end);
        if (next.length > LIMIT) next = next.slice(0, LIMIT);
        input.value = next;
        input.dispatchEvent(new Event('input'));
        var pos = start + text.length;
        setTimeout(function () { setSel(pos, pos); update(); }, 0);
    }

    /* ---------- Discord markdown render ---------- */
    function renderDiscordMarkdown(raw) {
        if (!raw || !raw.trim()) return '';

        // Extract code blocks
        var codeBlocks = [];
        var withPlaceholders = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, function (m, lang, code) {
            var idx = codeBlocks.length;
            codeBlocks.push({ lang: (lang || '').trim(), code: code });
            return '{{CB' + idx + '}}';
        });

        // Extract inline code
        var inlineCodes = [];
        withPlaceholders = withPlaceholders.replace(/`([^`\n]+?)`/g, function (m, code) {
            var idx = inlineCodes.length;
            inlineCodes.push(code);
            return '{{IC' + idx + '}}';
        });

        // Split raw lines (with placeholders still raw) for block handling — do NOT escape before detecting block markers (e.g. > would become &gt;)
        var lines = withPlaceholders.split('\n');
        var htmlLines = [];
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];
            // Handle code block placeholder lines alone
            if (/^\{\{CB\d+\}\}$/.test(line.trim())) {
                htmlLines.push(line);
                i++;
                continue;
            }

            // Subtext: -# ...
            var mSub = line.match(/^-#\s+(.*)$/);
            if (mSub) {
                htmlLines.push('<div class="mg-subtext">' + inlineFormat(esc(mSub[1])) + '</div>');
                i++;
                continue;
            }

            // Headings: # , ## , ###
            var mH = line.match(/^(#{1,3})\s+(.*)$/);
            if (mH) {
                var level = mH[1].length;
                var cls = level === 1 ? 'mg-h1' : level === 2 ? 'mg-h2' : 'mg-h3';
                htmlLines.push('<div class="' + cls + '">' + inlineFormat(esc(mH[2])) + '</div>');
                i++;
                continue;
            }

            // Quote: > or >>>
            var mQ = line.match(/^(?:>>>|>)\s?(.*)$/);
            if (mQ) {
                var qLines = [];
                while (i < lines.length && /^(?:>>>|>)\s?(.*)$/.test(lines[i])) {
                    var qm = lines[i].match(/^(?:>>>|>)\s?(.*)$/);
                    qLines.push(inlineFormat(esc(qm[1])));
                    i++;
                }
                htmlLines.push('<blockquote>' + qLines.join('<br>') + '</blockquote>');
                continue;
            }

            // Bullet list grouping
            if (/^[-*]\s+(.+)$/.test(line)) {
                var bItems = [];
                while (i < lines.length && /^[-*]\s+(.+)$/.test(lines[i])) {
                    var bm = lines[i].match(/^[-*]\s+(.+)$/);
                    bItems.push('<div class="mg-bullet">' + inlineFormat(esc(bm[1])) + '</div>');
                    i++;
                }
                htmlLines.push(bItems.join(''));
                continue;
            }

            // Ordered list grouping
            if (/^\d+\.\s+(.+)$/.test(line)) {
                var oItems = [];
                var num = 1;
                while (i < lines.length && /^\d+\.\s+(.+)$/.test(lines[i])) {
                    var om = lines[i].match(/^\d+\.\s+(.+)$/);
                    oItems.push('<div class="mg-ordered">' + (num) + '. ' + inlineFormat(esc(om[1])) + '</div>');
                    num++;
                    i++;
                }
                htmlLines.push(oItems.join(''));
                continue;
            }

            // Empty line -> break
            if (line.trim() === '') {
                htmlLines.push('<div style="height:0.6em"></div>');
                i++;
                continue;
            }

            // Default paragraph line
            htmlLines.push('<div>' + inlineFormat(esc(line)) + '</div>');
            i++;
        }

        var html = htmlLines.join('');

        // Restore inline code
        html = html.replace(/\{\{IC(\d+)\}\}/g, function (m, idx) {
            var code = inlineCodes[parseInt(idx, 10)];
            return '<code class="inline">' + esc(code) + '</code>';
        });

        // Restore code blocks
        html = html.replace(/\{\{CB(\d+)\}\}/g, function (m, idx) {
            var cb = codeBlocks[parseInt(idx, 10)];
            var code = esc(cb.code);
            // Remove trailing newline if needed
            return '<pre><code>' + code + '</code></pre>';
        });

        return html;
    }

    function formatTs(sec, style) {
        style = style || 'f';
        var s = parseInt(sec, 10);
        if (isNaN(s) || s <= 0 || s > 253402300799) return null;
        var ms = s * 1000;
        if (style === 'R') {
            var diff = ms - Date.now();
            var abs = Math.abs(diff);
            var units = [[31536000000, 'year'], [2592000000, 'month'], [604800000, 'week'], [86400000, 'day'], [3600000, 'hour'], [60000, 'minute'], [1000, 'second']];
            for (var j = 0; j < units.length; j++) {
                if (abs >= units[j][0]) {
                    var n = Math.round(abs / units[j][0]);
                    var label = units[j][1] + (n === 1 ? '' : 's');
                    return diff < 0 ? n + ' ' + label + ' ago' : 'in ' + n + ' ' + label;
                }
            }
            return 'now';
        }
        var d = new Date(ms);
        var timeShort = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
        if (timeShort === '24:00') timeShort = '00:00';
        var timeLong = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
        if (timeLong.indexOf('24:') === 0) timeLong = '00' + timeLong.slice(2);
        var dateShort = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
        var dateLong = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
        var weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(d);
        switch (style) {
            case 't': return timeShort;
            case 'T': return timeLong;
            case 'd': return dateShort;
            case 'D': return dateLong;
            case 'f': return dateLong + ' ' + timeShort;
            case 'F': return weekday + ', ' + dateLong + ' ' + timeShort;
            default: return dateLong + ' ' + timeShort;
        }
    }

    function inlineFormat(text) {
        // text is already escaped (esc() was called on each line slice)
        // Timestamps: &lt;t:unix[:style]&gt; → rendered Discord timestamp preview
        text = text.replace(/&lt;t:(\d{1,13})(?::([tTdDfFR]))?&gt;/g, function (m, sec, style) {
            var fmt = formatTs(sec, style || 'f');
            if (fmt === null) return m;
            var raw = '&lt;t:' + sec + (style ? ':' + style : '') + '&gt;';
            return '<span class="mg-timestamp" title="' + raw + '"><i class="fa-solid fa-clock" aria-hidden="true"></i>' + esc(fmt) + '</span>';
        });

        // Links: [label](https://...)
        text = text.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s\)]+)\)/g, function (m, label, url) {
            var href = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            var hrefEsc = esc(href);
            return '<a href="' + hrefEsc + '" target="_blank" rel="noopener">' + label + '</a>';
        });

        // Spoiler: ||...|| (non-greedy, allow spaces)
        text = text.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="mg-spoiler" tabindex="0">$1</span>');

        // Bold + Italic combined ***
        text = text.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        // Alternative ___ for bold+italic+underline? In Discord ___ is underline+italic? We'll ignore complex combos.

        // Bold **
        text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');

        // Underline __
        text = text.replace(/__([\s\S]+?)__/g, '<u>$1</u>');

        // Strikethrough ~~
        text = text.replace(/~~([\s\S]+?)~~/g, '<del>$1</del>');

        // Italic single * (avoid ** already handled)
        text = text.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');

        // Italic underscore _ (single underscore) — simple, after __ already handled
        text = text.replace(/_([^_\n]+?)_/g, '<em>$1</em>');

        return text;
    }

    function update() {
        var val = input.value;
        var len = val.length;
        countEl.textContent = len + ' / ' + LIMIT;
        countEl.classList.remove('warn', 'bad');
        if (len > LIMIT * 0.85 && len <= LIMIT * 0.95) countEl.classList.add('warn');
        else if (len > LIMIT * 0.95) countEl.classList.add('bad');
        rawEl.textContent = val || '(empty)';
        if (!val.trim()) {
            preview.innerHTML = '<div class="mg-preview-empty"><i class="fa-solid fa-eye" aria-hidden="true"></i> Preview will appear here — start typing or use the toolbar.</div>';
            return;
        }
        var html = renderDiscordMarkdown(val);
        preview.innerHTML = html;

        // Attach spoiler toggle
        var spoilers = preview.querySelectorAll('.mg-spoiler');
        spoilers.forEach(function (el) {
            el.addEventListener('click', function () { el.classList.toggle('revealed'); });
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.classList.toggle('revealed'); }
            });
        });
    }

    /* ---------- Toolbar events ---------- */
    document.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var action = btn.getAttribute('data-action');
            switch (action) {
                case 'bold':
                    wrapSelection('**', '**', 'bold');
                    break;
                case 'italic':
                    wrapSelection('*', '*', 'italic');
                    break;
                case 'underline':
                    wrapSelection('__', '__', 'underline');
                    break;
                case 'strike':
                    wrapSelection('~~', '~~', 'strikethrough');
                    break;
                case 'spoiler':
                    wrapSelection('||', '||', 'spoiler');
                    break;
                case 'code':
                    wrapSelection('`', '`', 'code');
                    break;
                case 'codeblock':
                    // Wrap selection or insert template
                    var s = getSel();
                    if (s.start !== s.end) {
                        wrapSelection('```\n', '\n```', '');
                    } else {
                        insertAtCursor('```js\nconsole.log("hello");\n```');
                    }
                    break;
                case 'quote':
                    prefixLine('> ');
                    break;
                case 'subtext':
                    prefixLine('-# ');
                    break;
                case 'h1':
                    prefixLine('# ');
                    break;
                case 'h2':
                    prefixLine('## ');
                    break;
                case 'h3':
                    prefixLine('### ');
                    break;
                case 'bullet':
                    prefixLine('- ');
                    break;
                case 'ordered':
                    prefixLineOrdered();
                    break;
                case 'link':
                    // If selection, wrap as [selection](url), else insert template
                    var sel = getSel();
                    var selText = input.value.slice(sel.start, sel.end) || 'text';
                    var url = 'https://example.com';
                    // Simple: if selection is url-like, invert?
                    // Insert and select url part
                    var before = input.value.slice(0, sel.start);
                    var after = input.value.slice(sel.end);
                    var insertion = '[' + selText + '](' + url + ')';
                    var next = before + insertion + after;
                    if (next.length > LIMIT) next = next.slice(0, LIMIT);
                    input.value = next;
                    input.dispatchEvent(new Event('input'));
                    var urlStart = sel.start + selText.length + 2; // position of url
                    var urlEnd = urlStart + url.length;
                    setTimeout(function () { setSel(urlStart, urlEnd); update(); }, 0);
                    break;
                case 'timestamp':
                    // Insert timestamp placeholder; use current time as example?
                    var now = Math.floor(Date.now() / 1000);
                    insertAtCursor('<t:' + now + ':f>');
                    break;
                default:
                    break;
            }
        });
    });

    // Cheat sheets
    document.querySelectorAll('.mg-cheat').forEach(function (el) {
        el.addEventListener('click', function () {
            var code = el.getAttribute('data-insert');
            if (!code) {
                code = el.querySelector('.mg-cheat-code') ? el.querySelector('.mg-cheat-code').textContent.trim() : '';
            }
            if (code) {
                // Insert example text: e.g. **bold** -> insert with placeholder text?
                // If textarea empty, just set code with sample, otherwise insert at cursor
                if (!input.value.trim()) {
                    // Provide sample with text inside
                    // Keep code as is but replace generic with demo word?
                    input.value = code.replace('text', 'hello').replace('code', 'code').replace('quote', 'quote');
                    // For some codes like -# subtext, keep
                    input.dispatchEvent(new Event('input'));
                    update();
                    input.focus();
                } else {
                    insertAtCursor(code.replace('text', 'hello') + ' ');
                }
            }
        });
    });

    // Editor events
    input.addEventListener('input', update);
    input.addEventListener('keydown', function (e) {
        // Tab: insert 2 spaces or handle code?
        if (e.key === 'Tab') {
            e.preventDefault();
            insertAtCursor('  ');
        }
        // Ctrl/Cmd + B/I/U etc
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            var k = e.key.toLowerCase();
            if (k === 'b') { e.preventDefault(); wrapSelection('**', '**', 'bold'); }
            else if (k === 'i') { e.preventDefault(); wrapSelection('*', '*', 'italic'); }
            else if (k === 'u') { e.preventDefault(); wrapSelection('__', '__', 'underline'); }
            else if (k === 'e') { e.preventDefault(); wrapSelection('`', '`', 'code'); }
        }
    });

    copyBtn.addEventListener('click', function () {
        var text = input.value;
        if (!text) return;
        copyText(text, copyBtn);
        // Also animate text?
        var orig = copyBtn.innerHTML;
        copyBtn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
        copyBtn.classList.add('copied');
        setTimeout(function () { copyBtn.innerHTML = orig; copyBtn.classList.remove('copied'); }, 1400);
    });

    clearBtn.addEventListener('click', function () {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        update();
        input.focus();
    });

    // Copy raw button inside preview card
    var copyPreviewBtn = document.getElementById('mg-copy-preview');
    if (copyPreviewBtn) {
        copyPreviewBtn.addEventListener('click', function () {
            copyText(input.value, copyPreviewBtn);
        });
    }

    // Init empty — no example text in editor, preview stays empty
    update();

    // Handle spoiler click delegation (fallback)
    preview.addEventListener('click', function (e) {
        var sp = e.target.closest('.mg-spoiler');
        if (sp) sp.classList.toggle('revealed');
    });
})();
