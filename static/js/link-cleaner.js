/* Disc-Tools: Link Cleaner — removes tracking params, TikTok-aware, 100% client-side */
(function () {
    'use strict';
    var input = document.getElementById('lc-input');
    var btnClean = document.getElementById('lc-clean');
    var btnPaste = document.getElementById('lc-paste');
    var btnClear = document.getElementById('lc-clear');
    var fileInput = document.getElementById('lc-file');
    var countEl = document.getElementById('lc-count');
    var resultsEl = document.getElementById('lc-results');
    var outputCard = document.getElementById('lc-output-card');
    var statsEl = document.getElementById('lc-stats');
    var btnCopyAll = document.getElementById('lc-copy-all');
    var btnDownload = document.getElementById('lc-download');

    // --- Tracker definitions by category ---
    var TRACKERS = {
        utm: [/^utm_[a-z_]+$/i],
        social: [
            /^fbclid$/i, /^fb_action_ids$/i, /^fb_comment_id$/i, /^fb_source$/i,
            /^gclid$/i, /^gclsrc$/i, /^dclid$/i, /^gbraid$/i, /^wbraid$/i,
            /^msclkid$/i, /^twclid$/i, /^tw_click_id$/i,
            /^igsh$/i, /^igshid$/i,
            /^ttclid$/i, /^tt_medium$/i, /^tt_content$/i,
            /^mc_cid$/i, /^mc_eid$/i,
            /^_hsenc$/i, /^_hsmi$/i, /^hsCtaTracking$/i,
            /^epik$/i, /^yclid$/i
        ],
        tiktok: [
            /^is_from_webapp$/i, /^sender_device$/i, /^sender_web_id$/i, /^web_id$/i,
            /^is_copy_url$/i, /^browser$/i, /^aid$/i, /^app_language$/i, /^lang$/i,
            /^u_code$/i, /^ugbiz_name$/i, /^sec_uid$/i, /^sec_user_id$/i,
            /^share_app_id$/i, /^sharer_language$/i, /^source$/i, /^checksum$/i,
            /^sec_uid$/i, /^share_author_id$/i, /^social_sharing$/i,
            /^_r$/i, /^_d$/i, /^_t$/i, /^timestamp$/i,
            /^from_webapp$/i, /^sender_type$/i, /^enter_from$/i,
            /^previous_page$/i, /^from_page$/i
        ],
        youtube: [
            /^si$/i, /^feature$/i, /^pp$/i, /^ebc$/i, /^embeds_referring_euri$/i,
            /^embeds_referring_origin$/i, /^source_ve_path$/i
        ],
        amazon: [
            /^tag$/i, /^ref$/i, /^pf_rd_r$/i, /^pf_rd_p$/i, /^pf_rd_s$/i, /^pf_rd_t$/i, /^pf_rd_m$/i, /^pf_rd_i$/i,
            /^pd_rd_r$/i, /^pd_rd_w$/i, /^pd_rd_wg$/i, /^pd_rd_i$/i,
            /^psc$/i, /^smid$/i, /^ie$/i, /^qid$/i, /^sr$/i, /^keywords$/i, /^sprefix$/i, /^crid$/i,
            /^linkCode$/i, /^linkId$/i, /^camp$/i, /^creative$/i, /^contentId$/i,
            /^dchild$/i, /^ts_id$/i, /^__mk_.*$/i, /^ref_.*$/i
        ],
        other: [
            /^srsltid$/i, /^zanpid$/i, /^mkclid$/i, /^mkeid$/i, /^pvid$/i,
            /^sc_cid$/i, /^vero_conv$/i, /^vero_id$/i, /^rb_clickid$/i,
            /^oly_anon_id$/i, /^oly_enc_id$/i, /^el$/i, /^epi$/i,
            /^_openstat$/i, /^wickedid$/i, /^ap_id$/i, /^spm$/i,
            /^ScCid$/i, /^at_medium$/i, /^at_campaign$/i
        ]
    };

    function isTrackingParam(name, opts) {
        var lname = name.toLowerCase();
        // check each enabled category
        for (var cat in TRACKERS) {
            if (!opts[cat]) continue;
            var list = TRACKERS[cat];
            for (var i = 0; i < list.length; i++) {
                if (list[i].test(lname)) return true;
            }
        }
        return false;
    }

    function getOpts() {
        var opts = {};
        document.querySelectorAll('.lc-opt input[data-opt]').forEach(function (cb) {
            opts[cb.getAttribute('data-opt')] = cb.checked;
        });
        return opts;
    }

    function normalizeUrl(raw) {
        raw = raw.trim();
        if (!raw) return null;
        // Extract URL from text - handle markdown [label](url) or plain
        var m = raw.match(/https?:\/\/[^\s<>\[\]"]+/i);
        if (m) raw = m[0];
        // Add protocol if missing (e.g. www.tiktok.com/...)
        if (!/^https?:\/\//i.test(raw) && /^([a-z0-9-]+\.)+[a-z]{2,}\//i.test(raw)) {
            raw = 'https://' + raw;
        }
        // Handle bare domain without path? Still try
        if (!/^https?:\/\//i.test(raw)) {
            // invalid
            return null;
        }
        // Trim trailing punctuation
        raw = raw.replace(/[.,;!?]+$/, '');
        raw = raw.replace(/[)\]]+$/, '');
        return raw;
    }

    function cleanSingleUrl(raw, opts) {
        var normalized = normalizeUrl(raw);
        if (!normalized) return { original: raw, cleaned: raw, removed: [], error: 'Invalid URL' };
        var url;
        try {
            url = new URL(normalized);
        } catch (e) {
            return { original: raw, cleaned: raw, removed: [], error: 'Invalid URL' };
        }
        var removed = [];
        var kept = [];
        // Collect params to inspect - need to handle duplicate keys
        var params = Array.from(url.searchParams.entries());
        // Build new searchParams from scratch
        url.search = '';
        params.forEach(function (kv) {
            var k = kv[0], v = kv[1];
            if (isTrackingParam(k, opts)) {
                removed.push(k + (v ? '=' + v : ''));
            } else {
                kept.push(k);
                url.searchParams.append(k, v);
            }
        });
        // Also handle hash fragment tracking? Sometimes # with utm? Keep hash but clean if it contains tracking
        // For now keep hash as is, but could clean hash query-like part
        // TikTok: if domain is tiktok and no kept params, ensure we strip empty ?
        var cleaned = url.toString();
        // Remove trailing ? if empty
        if (cleaned.endsWith('?')) cleaned = cleaned.slice(0, -1);
        // Remove trailing ?# edge
        // Also, for tiktok short links vm.tiktok.com, keep as is but cleaned
        // For Amazon, if path is /dp/ASIN, we could canonicalize? Keep simple
        return { original: raw, cleaned: cleaned, removed: removed, error: null, kept: kept };
    }

    function extractUrls(text) {
        // Split by whitespace, newline, comma, semicolon
        var parts = text.split(/[\n\r]+/);
        var urls = [];
        parts.forEach(function (line) {
            line = line.trim();
            if (!line) return;
            // If line contains multiple URLs separated by spaces/commas
            var tokens = line.split(/[\s,;|]+/);
            tokens.forEach(function (tok) {
                tok = tok.trim();
                if (!tok) return;
                // Filter to look like URL
                if (/https?:\/\//i.test(tok) || /^([a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(tok)) {
                    var n = normalizeUrl(tok);
                    if (n) urls.push(tok);
                    else if (tok) urls.push(tok);
                } else if (tok.length > 5) {
                    // Maybe plain text with URL inside?
                    var m = tok.match(/https?:\/\/[^\s]+/i);
                    if (m) urls.push(m[0]);
                }
            });
            // Fallback: if line is single line with spaces but we already split, handle line with no split?
            if (tokens.length === 0 && line) {
                var m2 = line.match(/https?:\/\/[^\s]+/gi);
                if (m2) m2.forEach(function (u) { urls.push(u); });
            }
        });
        // If input is single URL with no newline but we missed, fallback to whole text as one
        if (urls.length === 0 && text.trim()) {
            var cand = normalizeUrl(text.trim());
            if (cand) urls.push(text.trim());
        }
        // Deduplicate preserving order? Keep all
        return urls;
    }

    function renderResults(list) {
        resultsEl.innerHTML = '';
        var totalRemoved = 0;
        var changedCount = 0;
        list.forEach(function (res, idx) {
            var changed = res.cleaned !== res.original && !res.error;
            if (changed) changedCount++;
            totalRemoved += res.removed.length;
            var wrap = document.createElement('div');
            wrap.className = 'lc-result';
            var head = '<div class="lc-result-head"><span class="lc-index">' + (idx + 1) + '</span><span>' + (res.error ? 'Invalid' : (changed ? 'Cleaned' : 'Already clean')) + '</span>' +
                (changed ? '<span class="lc-saved">-' + res.removed.length + ' param' + (res.removed.length !== 1 ? 's' : '') + '</span>' : '<span class="lc-saved lc-nochange">no change</span>') + '</div>';
            var origRow = '<div class="lc-url-row"><span class="lc-url-label">Original</span><div class="lc-url">' + esc(res.original) + '</div></div>';
            var cleanRow = '<div class="lc-url-row"><span class="lc-url-label">Cleaned ' + (res.error ? '' : '<span style="opacity:0.6;font-weight:400">· copy-ready</span>') + '</span><div class="lc-url cleaned" id="lc-cleaned-' + idx + '">' + esc(res.cleaned) + '</div>' +
                (res.removed.length ? '<div class="lc-url-removed"><i class="fa-solid fa-broom"></i> Removed: ' + res.removed.map(function (r) { return '<code>' + esc(r) + '</code>'; }).join(' ') + '</div>' : '') +
                (res.error ? '<div class="lc-url-removed" style="color:#ff5a5a"><i class="fa-solid fa-circle-exclamation"></i> ' + esc(res.error) + '</div>' : '') +
                '</div>';
            var actions = '<div class="lc-result-actions">' +
                '<button type="button" class="btn btn-ghost btn-sm lc-copy" data-copy="' + esc(res.cleaned) + '"><i class="fa-solid fa-copy"></i> Copy</button>' +
                '<a class="btn btn-ghost btn-sm" href="' + esc(res.cleaned) + '" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</a>' +
                (changed ? '<button type="button" class="btn btn-ghost btn-sm lc-compare" data-idx="' + idx + '"><i class="fa-solid fa-code-compare"></i> Show diff</button>' : '') +
                '</div>';
            wrap.innerHTML = head + origRow + cleanRow + actions;
            resultsEl.appendChild(wrap);
        });
        statsEl.textContent = changedCount + ' cleaned · ' + totalRemoved + ' params removed';
        outputCard.hidden = false;
        outputCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // Wire copy buttons
        resultsEl.querySelectorAll('.lc-copy').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var text = btn.getAttribute('data-copy');
                copyText(text, btn);
            });
        });
    }

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function copyText(text, btn) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { flash(btn); }).catch(function () { fallbackCopy(text, btn); });
        } else fallbackCopy(text, btn);
    }
    function fallbackCopy(text, btn) {
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); flash(btn); } catch (e) {}
        document.body.removeChild(ta);
    }
    function flash(btn) {
        var orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        btn.classList.add('copied');
        setTimeout(function () { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1600);
    }

    function doClean() {
        var text = input.value.trim();
        if (!text) {
            input.focus();
            input.style.boxShadow = 'inset 0 0 0 2px #ff5a5a';
            setTimeout(function () { input.style.boxShadow = ''; }, 1200);
            return;
        }
        var opts = getOpts();
        var urls = extractUrls(text);
        if (urls.length === 0) {
            // treat whole input as one url
            urls = [text];
        }
        var results = urls.map(function (u) { return cleanSingleUrl(u, opts); });
        renderResults(results);
        // Update count badge
        countEl.textContent = urls.length + ' link' + (urls.length !== 1 ? 's' : '');
        // Save to localStorage for history? optional
        try { localStorage.setItem('lc_last', JSON.stringify({ input: text, opts: opts })); } catch (e) {}
        if (typeof umami !== 'undefined') {
            try { umami.track('link-cleaner-clean', { count: urls.length }); } catch (e) {}
        }
    }

    // --- Events ---
    function updateCount() {
        var text = input.value.trim();
        if (!text) { countEl.textContent = '0 links'; return; }
        var urls = extractUrls(text);
        countEl.textContent = urls.length + ' link' + (urls.length !== 1 ? 's' : '');
    }
    input.addEventListener('input', updateCount);
    input.addEventListener('paste', function () { setTimeout(updateCount, 50); });

    btnClean.addEventListener('click', doClean);
    input.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doClean();
    });

    btnPaste.addEventListener('click', async function () {
        try {
            var text = await navigator.clipboard.readText();
            if (text) {
                input.value = text;
                updateCount();
                input.focus();
                doClean();
            }
        } catch (e) {
            input.focus();
        }
    });

    btnClear.addEventListener('click', function () {
        input.value = '';
        updateCount();
        resultsEl.innerHTML = '';
        outputCard.hidden = true;
        statsEl.textContent = '';
        input.focus();
    });

    fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
            input.value = e.target.result;
            updateCount();
        };
        reader.readAsText(file);
    });

    // Examples
    var examples = {
        tiktok: 'https://www.tiktok.com/@khaby.lame/video/7223456789012345678?is_from_webapp=1&sender_device=pc&web_id=7281234567890123456&is_copy_url=1',
        youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123DEF456&feature=share&pp=ygUJaG93IHRvIA%3D%3D',
        amazon: 'https://www.amazon.de/dp/B0C1234567?tag=mytag-21&ref=sr_1_1&pf_rd_r=XYZ&pf_rd_p=123&pd_rd_w=abc&psc=1&smid=ABCDEFG',
        utm: 'https://example.com/sale?utm_source=tiktok&utm_medium=social&utm_campaign=spring_sale&utm_term=shoes&utm_content=video1&fbclid=IwAR123&gclid=abc123&ttclid=XYZ',
        bulk: 'https://www.tiktok.com/@user/video/7190000000000000001?is_from_webapp=1&sender_device=pc\nhttps://www.youtube.com/watch?v=abc123&si=track123\nhttps://www.amazon.de/dp/B0XYZ?tag=aff-21&ref=abc\nhttps://shop.example.com/?utm_source=instagram&igshid=ABC123&srsltid=XYZ'
    };
    document.querySelectorAll('.hint-example').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var key = btn.getAttribute('data-example');
            var val = examples[key];
            if (val) {
                input.value = val;
                updateCount();
                doClean();
                input.focus();
            }
        });
    });

    // Options live update
    document.querySelectorAll('.lc-opt input').forEach(function (cb) {
        cb.addEventListener('change', function () {
            if (resultsEl.children.length) doClean();
        });
    });

    // Copy all / Download
    btnCopyAll.addEventListener('click', function () {
        var texts = Array.from(resultsEl.querySelectorAll('[id^="lc-cleaned-"]')).map(function (el) { return el.textContent; }).join('\n');
        if (!texts) return;
        copyText(texts, btnCopyAll);
    });
    btnDownload.addEventListener('click', function () {
        var texts = Array.from(resultsEl.querySelectorAll('[id^="lc-cleaned-"]')).map(function (el) { return el.textContent; }).join('\n');
        if (!texts) return;
        var blob = new Blob([texts], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'cleaned-links.txt'; a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    // Load last input
    try {
        var saved = JSON.parse(localStorage.getItem('lc_last') || 'null');
        if (saved && saved.input) {
            input.value = saved.input;
            if (saved.opts) {
                Object.keys(saved.opts).forEach(function (k) {
                    var cb = document.querySelector('.lc-opt input[data-opt="' + k + '"]');
                    if (cb) cb.checked = !!saved.opts[k];
                });
            }
            updateCount();
        }
    } catch (e) {}

    // Handle ?url= param for share
    var params = new URLSearchParams(location.search);
    var pre = params.get('url') || params.get('q');
    if (pre) {
        input.value = pre;
        updateCount();
        doClean();
    }
    updateCount();
})();
