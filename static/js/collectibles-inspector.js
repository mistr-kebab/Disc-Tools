/* Disc-Tools: Collectibles Inspector — fixed animated previews & nameplate mock */
(function () {
    'use strict';
    var form = document.getElementById('lookup-form');
    var input = document.getElementById('lookup-input');
    var resultEl = document.getElementById('result');
    var infoEl = document.getElementById('ci-info');

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function loadingHTML(msg) { return '<div class="lookup-loading"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>' + esc(msg) + '</div>'; }
    function errorHTML(msg) { return '<div class="lookup-error"><i class="fa-solid fa-circle-exclamation"></i><p>' + esc(msg) + '</p></div>'; }
    function copyText(text, btn) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { flash(btn); }).catch(function () { fallbackCopy(text, btn); });
        } else fallbackCopy(text, btn);
    }
    function fallbackCopy(text, btn) {
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); flash(btn); } catch (e) { }
        document.body.removeChild(ta);
    }
    function flash(btn) {
        var orig = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied'; btn.classList.add('copied');
        setTimeout(function () { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1600);
    }
    function badge(label, cls, icon) { return '<span class="es-badge ' + cls + '">' + (icon ? '<i class="fa-solid fa-' + icon + '"></i> ' : '') + esc(label) + '</span>'; }

    var ddClosers = [];
    function closeAllDDs() { ddClosers.forEach(function (fn) { fn(); }); }
    document.addEventListener('click', closeAllDDs);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAllDDs(); });

    function paletteColor(name) {
        var map = {
            white: '#ffffff', violet: '#9b59b6', crimson: '#e74c3c', cobalt: '#3498db',
            bubble_gum: '#ff9fe0', sky: '#87ceeb', black: '#2c2c2c', red: '#e74c3c',
            green: '#2ecc71', yellow: '#f1c40f', orange: '#e67e22'
        };
        return map[name] || '#9aa3b2';
    }

    function buildLinkRow(label, url, downloadName) {
        return '<div class="ci-link-row">' +
            '<span class="ci-link-label">' + esc(label) + '</span>' +
            '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>' +
            '<div class="ci-link-actions">' +
                '<button type="button" class="btn btn-ghost btn-sm es-copy-btn" data-copy="' + esc(url) + '"><i class="fa-solid fa-copy"></i> Copy</button>' +
                '<a class="btn btn-primary btn-sm" href="' + esc(url) + '" download="' + esc(downloadName || 'download') + '" rel="noopener"><i class="fa-solid fa-download"></i></a>' +
            '</div></div>';
    }

    function renderResult(d) {
        var display = d.globalName || d.username || 'Unknown';
        var isAnimatedAvatar = d.avatar && d.avatar.animated;
        var hasAvatar = d.avatar && d.avatar.hasAvatar;
        var hasBanner = d.banner && d.banner.hasBanner;
        var hasDeco = !!d.avatarDecoration;
        var hasNameplate = !!d.nameplate;

        var badges = '';
        if (isAnimatedAvatar) badges += badge('Animated avatar', 'es-badge-animated', 'wand-magic-sparkles');
        if (hasBanner && d.banner.animated) badges += badge('Animated banner', 'es-badge-animated', 'panorama');
        if (hasDeco) badges += badge('Decoration', 'es-badge-emoji', 'hat-wizard');
        if (hasNameplate) badges += badge('Nameplate', 'badge-blurple', 'id-badge');
        if (!hasAvatar) badges += badge('Default avatar', 'es-badge-emoji', 'user');
        if (d.clan) badges += badge(d.clan.tag, 'es-badge-emoji', 'users');

        var head = '<div class="ci-result-head">' +
            '<div class="ci-avatar-stack">' +
                '<img class="ci-avatar" src="' + esc(d.avatar.previewUrl) + '" alt="' + esc(display) + '" loading="lazy">' +
                (hasDeco ? '<img class="ci-decoration" src="' + esc(d.avatarDecoration.previewUrl) + '" alt="decoration" loading="lazy">' : '') +
            '</div>' +
            '<div class="ci-head-meta">' +
                '<h2>' + esc(display) + '</h2>' +
                '<div class="ci-username">@' + esc(d.username) + ' · ' + esc(d.id) + '</div>' +
                '<div class="ci-idline">ID: <code>' + esc(d.id) + '</code> · <a href="/tools/user-lookup/?userid=' + esc(d.id) + '">User Lookup</a> · <a href="/tools/avatar-cdn/?userid=' + esc(d.id) + '">Avatar CDN</a></div>' +
                '<div class="ci-badges">' + badges + '</div>' +
            '</div>' +
        '</div>';

        // Avatar card — preview ALWAYS animated if available
        var avatarCard = '';
        if (d.avatar) {
            var avatarFormats = d.avatar.formats || [];
            var avatarSizes = [...new Set(avatarFormats.map(function(f){return f.size;}))].sort(function(a,b){return a-b;});
            var avatarExts = [...new Set(avatarFormats.map(function(f){return f.format;}))];
            var defaultAvatarSize = avatarSizes.indexOf(256) !== -1 ? 256 : avatarSizes[0];
            var gifIdx = avatarExts.indexOf('GIF');
            var defaultAvatarFmt = isAnimatedAvatar && gifIdx !== -1 ? 'GIF' : avatarExts[0] || 'PNG';
            var avatarPicker = '<div class="ac-picker" id="ci-avatar-picker">' +
                '<div class="ac-picker-field">Format<div class="ac-dd" data-dd="ci-av-fmt"><button type="button" class="ac-dd-btn" data-dd-btn aria-haspopup="listbox" aria-expanded="false"><span data-dd-label>' + esc(defaultAvatarFmt) + '</span><i class="fa-solid fa-chevron-down ac-dd-chev"></i></button><div class="ac-dd-menu" data-dd-menu>' +
                    avatarExts.map(function(f){ return '<button type="button" class="ac-dd-option' + (f===defaultAvatarFmt?' ac-dd-option-selected':'') + '" data-dd-opt="' + esc(f) + '"><i class="fa-solid fa-check ac-dd-check"></i><span>' + esc(f) + '</span></button>'; }).join('') +
                '</div></div></div>' +
                '<div class="ac-picker-field">Size<div class="ac-dd" data-dd="ci-av-size"><button type="button" class="ac-dd-btn" data-dd-btn><span data-dd-label>' + defaultAvatarSize + 'px</span><i class="fa-solid fa-chevron-down ac-dd-chev"></i></button><div class="ac-dd-menu" data-dd-menu>' +
                    avatarSizes.map(function(s){ return '<button type="button" class="ac-dd-option' + (s===defaultAvatarSize?' ac-dd-option-selected':'') + '" data-dd-opt="' + s + '"><i class="fa-solid fa-check ac-dd-check"></i><span>' + s + 'px</span></button>'; }).join('') +
                '</div></div></div>' +
            '</div>';
            var avatarLinks = '<div class="ci-links"><div class="ci-link-row" id="ci-avatar-link-row"><span class="ci-link-label" id="ci-avatar-fmt-label"></span><a id="ci-avatar-url" href="#" target="_blank" rel="noopener"></a><div class="ci-link-actions"><button type="button" class="btn btn-ghost btn-sm es-copy-btn" id="ci-avatar-copy"><i class="fa-solid fa-copy"></i> Copy</button><a class="btn btn-primary btn-sm" id="ci-avatar-download" href="#"><i class="fa-solid fa-download"></i></a></div></div></div>';
            var avatarPreview = '<div class="ci-preview avatar-preview"><img id="ci-avatar-preview" src="' + esc(d.avatar.previewUrl) + '" alt="avatar"></div>';
            if (!hasAvatar) avatarPreview = '<div class="ci-preview avatar-preview"><img id="ci-avatar-preview" src="' + esc(d.avatar.previewUrl) + '" alt="default avatar"><p style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:6px">Default avatar #' + d.avatar.defaultIndex + '</p></div>';
            avatarCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-image"></i><h3>Avatar</h3><span class="ci-card-badge ' + (isAnimatedAvatar ? 'badge-green' : 'badge-gray') + '">' + (isAnimatedAvatar?'Animated':'Static') + '</span></div><div class="ci-card-body">' + avatarPreview + avatarPicker + avatarLinks + (isAnimatedAvatar ? '<small style="color:var(--text-muted);font-size:0.72rem"><i class="fa-solid fa-circle-info"></i> Preview stays animated — picker only changes the copied link.</small>' : '') + '</div></div>';
        }

        // Banner card — preview ALWAYS animated if available
        var bannerCard = '';
        if (hasBanner) {
            var bSizes = [...new Set(d.banner.formats.map(function(f){return f.size;}))].sort(function(a,b){return a-b;});
            var bExts = [...new Set(d.banner.formats.map(function(f){return f.format;}))];
            var defBSize = bSizes.indexOf(600)!==-1?600:(bSizes.indexOf(1024)!==-1?1024:bSizes[0]);
            var gifIdxB = bExts.indexOf('GIF');
            var defBFmt = (d.banner.animated && gifIdxB!==-1) ? 'GIF' : bExts[0];
            var bannerPicker = '<div class="ac-picker" id="ci-banner-picker"><div class="ac-picker-field">Format<div class="ac-dd" data-dd="ci-bn-fmt"><button type="button" class="ac-dd-btn" data-dd-btn><span data-dd-label>' + esc(defBFmt) + '</span><i class="fa-solid fa-chevron-down ac-dd-chev"></i></button><div class="ac-dd-menu" data-dd-menu>' +
                    bExts.map(function(f){return '<button type="button" class="ac-dd-option' + (f===defBFmt?' ac-dd-option-selected':'') + '" data-dd-opt="' + esc(f) + '"><i class="fa-solid fa-check ac-dd-check"></i><span>' + esc(f) + '</span></button>';}).join('') +
                '</div></div></div><div class="ac-picker-field">Size<div class="ac-dd" data-dd="ci-bn-size"><button type="button" class="ac-dd-btn" data-dd-btn><span data-dd-label>' + defBSize + 'px</span><i class="fa-solid fa-chevron-down ac-dd-chev"></i></button><div class="ac-dd-menu" data-dd-menu>' +
                    bSizes.map(function(s){return '<button type="button" class="ac-dd-option' + (s===defBSize?' ac-dd-option-selected':'') + '" data-dd-opt="'+s+'"><i class="fa-solid fa-check ac-dd-check"></i><span>'+s+'px</span></button>';}).join('') +
                '</div></div></div></div>';
            var bannerLinks = '<div class="ci-links"><div class="ci-link-row"><span class="ci-link-label" id="ci-banner-fmt-label"></span><a id="ci-banner-url" href="#" target="_blank" rel="noopener"></a><div class="ci-link-actions"><button type="button" class="btn btn-ghost btn-sm es-copy-btn" id="ci-banner-copy"><i class="fa-solid fa-copy"></i> Copy</button><a class="btn btn-primary btn-sm" id="ci-banner-download" href="#"><i class="fa-solid fa-download"></i></a></div></div></div>';
            var bannerMeta = d.banner.color ? '<div class="ci-color-row"><span class="ci-color-swatch" style="background:' + esc(d.banner.color) + '"></span><code>' + esc(d.banner.color) + '</code><span style="font-size:0.78rem;color:var(--text-muted)">banner color</span></div>' : '';
            if (d.banner.accentColorHex && d.banner.accentColorHex !== d.banner.color) bannerMeta += '<div class="ci-color-row" style="margin-top:6px"><span class="ci-color-swatch" style="background:' + esc(d.banner.accentColorHex) + '"></span><code>' + esc(d.banner.accentColorHex) + '</code><span style="font-size:0.78rem;color:var(--text-muted)">accent</span></div>';
            bannerCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-panorama"></i><h3>Banner</h3><span class="ci-card-badge ' + (d.banner.animated?'badge-green':'badge-gray') + '">' + (d.banner.animated?'Animated':'Static') + '</span></div><div class="ci-card-body"><div class="ci-preview banner-preview"><img id="ci-banner-preview" src="' + esc(d.banner.previewUrl) + '" alt="banner"></div>' + bannerPicker + bannerLinks + bannerMeta + (d.banner.animated ? '<small style="color:var(--text-muted);font-size:0.72rem"><i class="fa-solid fa-circle-info"></i> Banner preview is animated GIF — picker changes only the link.</small>' : '') + '</div></div>';
        } else {
            var colorBlock = '';
            if (d.banner.color || d.banner.accentColorHex) {
                var c = d.banner.color || d.banner.accentColorHex;
                colorBlock = '<div class="ci-preview" style="background:' + esc(c) + ';min-height:120px"><span style="background:rgba(0,0,0,0.45);color:#fff;padding:6px 12px;border-radius:999px;font-family:var(--font-mono);font-size:0.85rem">' + esc(c) + '</span></div>';
                colorBlock += '<div class="ci-color-row" style="margin-top:0.6rem"><span class="ci-color-swatch" style="background:' + esc(c) + '"></span><code>' + esc(c) + '</code><span style="font-size:0.78rem;color:var(--text-muted)">banner/accent color ' + (d.banner.accentColor!=null?'· '+d.banner.accentColor:'') + '</span></div>';
            } else {
                colorBlock = '<div class="ci-empty"><i class="fa-solid fa-panorama"></i><span>No banner set</span><small style="font-size:0.75rem;opacity:0.7">User has no custom banner — Discord shows a solid color based on accent.</small></div>';
            }
            bannerCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-panorama"></i><h3>Banner</h3><span class="ci-card-badge badge-gray">None</span></div><div class="ci-card-body">' + colorBlock + '</div></div>';
        }

        // Decoration card
        var decoCard = '';
        if (hasDeco) {
            var decoSizes = [...new Set(d.avatarDecoration.formats.map(function(f){return f.size;}))].sort(function(a,b){return a-b;});
            var defDecoSize = decoSizes.indexOf(256)!==-1?256:decoSizes[0];
            var decoPicker = '<div class="ac-picker"><div class="ac-picker-field">Size<div class="ac-dd" data-dd="ci-deco-size"><button type="button" class="ac-dd-btn" data-dd-btn><span data-dd-label>' + defDecoSize + 'px</span><i class="fa-solid fa-chevron-down ac-dd-chev"></i></button><div class="ac-dd-menu" data-dd-menu>' +
                decoSizes.map(function(s){return '<button type="button" class="ac-dd-option' + (s===defDecoSize?' ac-dd-option-selected':'') + '" data-dd-opt="'+s+'"><i class="fa-solid fa-check ac-dd-check"></i><span>'+s+'px</span></button>';}).join('') +
            '</div></div></div></div>';
            var decoLinks = '<div class="ci-links"><div class="ci-link-row"><span class="ci-link-label" id="ci-deco-label"></span><a id="ci-deco-url" href="#" target="_blank" rel="noopener"></a><div class="ci-link-actions"><button type="button" class="btn btn-ghost btn-sm es-copy-btn" id="ci-deco-copy"><i class="fa-solid fa-copy"></i> Copy</button><a class="btn btn-primary btn-sm" id="ci-deco-download" href="#"><i class="fa-solid fa-download"></i></a></div></div></div>';
            var decoMeta = '<div class="ci-meta-list"><div><strong>Asset:</strong> <code>' + esc(d.avatarDecoration.asset) + '</code></div><div><strong>SKU:</strong> <code>' + esc(d.avatarDecoration.skuId) + '</code></div>' + (d.avatarDecoration.expiresAt ? '<div><strong>Expires:</strong> ' + esc(d.avatarDecoration.expiresAt) + '</div>' : '') + '</div>';
            decoCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-wand-magic-sparkles"></i><h3>Avatar Decoration</h3><span class="ci-card-badge badge-yellow">Collectible</span></div><div class="ci-card-body"><div class="ci-preview deco-preview"><img id="ci-deco-preview" src="' + esc(d.avatarDecoration.previewUrl) + '" alt="decoration"></div><div class="ci-preview" style="min-height:auto;padding:12px;background:rgba(255,255,255,0.02)"><div style="position:relative;width:96px;height:96px;margin:0 auto"><img src="' + esc(d.avatar.previewUrl) + '" style="width:96px;height:96px;border-radius:50%;display:block"><img src="' + esc(d.avatarDecoration.previewUrl) + '" style="position:absolute;top:50%;left:50%;width:144px;height:144px;transform:translate(-50%,-50%);pointer-events:none;object-fit:contain"></div><small style="display:block;text-align:center;margin-top:8px;color:var(--text-muted);font-size:0.75rem">Preview with avatar — deco 1.5× avatar, correctly overlayed</small></div>' + decoPicker + decoLinks + decoMeta + '</div></div>';
        } else {
            decoCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-wand-magic-sparkles"></i><h3>Avatar Decoration</h3><span class="ci-card-badge badge-gray">None</span></div><div class="ci-card-body"><div class="ci-empty"><i class="fa-solid fa-hat-wizard"></i><span>No decoration</span><small style="font-size:0.75rem;opacity:0.7">No avatar decoration equipped.</small></div></div></div>';
        }

        // Nameplate card — FIXED: animated WEBM primary, avatar always visible with deco
        var npCard = '';
        if (hasNameplate) {
            var np = d.nameplate;
            var paletteDot = '<span class="ci-palette-dot" style="background:' + esc(paletteColor(np.palette)) + '"></span>';
            var npLinks = buildLinkRow('STATIC PNG', np.staticUrl, 'nameplate-static.png') + buildLinkRow('ANIMATED WEBM', np.animatedUrl, 'nameplate-animated.webm');
            var npMeta = '<div class="ci-meta-list"><div><strong>Label:</strong> ' + esc(np.label) + '</div><div><strong>Palette:</strong> <span class="ci-palette">' + paletteDot + esc(np.palette) + '</span></div><div><strong>Asset:</strong> <code>' + esc(np.asset) + '</code></div><div><strong>SKU:</strong> <code>' + esc(np.skuId) + '</code></div></div>';
            var avatarInMock = '<div style="position:relative;width:40px;height:40px;flex:0 0 40px">' +
                '<img src="' + esc(d.avatar.previewUrl) + '" alt="" style="width:40px;height:40px;border-radius:50%;display:block;background:#2a2d36">' +
                (hasDeco ? '<img src="' + esc(d.avatarDecoration.previewUrl) + '" alt="" style="position:absolute;top:50%;left:50%;width:60px;height:60px;transform:translate(-50%,-50%);pointer-events:none;object-fit:contain">' : '') +
            '</div>';
            var nameplatePreview = '<div style="background:#313338;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px">' +
                    avatarInMock +
                    '<div style="position:relative;flex:1;min-width:0;height:44px;border-radius:10px;overflow:hidden;background:#23252b">' +
                        '<img src="' + esc(np.staticUrl) + '" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'">' +
                        '<video src="' + esc(np.animatedUrl) + '" autoplay loop muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block" onerror="this.style.display=\'none\'"></video>' +
                        '<span style="position:relative;z-index:1;display:flex;align-items:center;height:100%;padding:0 14px;font-weight:800;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.85);font-size:15px;letter-spacing:0.1px">' + esc(display) + '</span>' +
                    '</div>' +
                '</div>';
            npCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-id-badge"></i><h3>Nameplate</h3><span class="ci-card-badge badge-blurple">' + esc(np.palette) + '</span></div><div class="ci-card-body">' + nameplatePreview + '<div class="ci-links">' + npLinks + '</div>' + npMeta + '</div></div>';
        } else {
            npCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-id-badge"></i><h3>Nameplate</h3><span class="ci-card-badge badge-gray">None</span></div><div class="ci-card-body"><div class="ci-empty"><i class="fa-solid fa-id-badge"></i><span>No nameplate</span><small style="font-size:0.75rem;opacity:0.7">No collectible nameplate equipped.</small></div></div></div>';
        }

        // Clan card
        var clanCard = '';
        if (d.clan) {
            clanCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-users"></i><h3>Clan Tag</h3><span class="ci-card-badge badge-yellow">' + esc(d.clan.tag) + '</span></div><div class="ci-card-body"><div class="ci-preview" style="min-height:100px;gap:12px">' +
                (d.clan.badgeUrl ? '<img src="' + esc(d.clan.badgeUrl) + '" alt="clan badge" style="width:48px;height:48px;border-radius:8px;background:rgba(255,255,255,0.06);padding:6px">' : '<div class="ci-empty" style="padding:0"><i class="fa-solid fa-shield-halved"></i></div>') +
                '<div style="text-align:left"><div style="font-weight:700;font-size:1.05rem">' + esc(d.clan.tag) + '</div><div style="font-size:0.8rem;color:var(--text-muted)">Guild: <code>' + esc(d.clan.guildId) + '</code></div></div>' +
            '</div>' +
            (d.clan.badgeUrl ? buildLinkRow('BADGE PNG', d.clan.badgeUrl, 'clan-badge.png') : '') +
            '<div class="ci-meta-list"><div><strong>Guild ID:</strong> <code>' + esc(d.clan.guildId) + '</code></div><div><strong>Badge:</strong> <code>' + esc(d.clan.badge || '—') + '</code></div><div><strong>Enabled:</strong> ' + (d.clan.enabled ? 'yes' : 'no') + '</div></div>' +
            '</div></div>';
        } else {
            clanCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-users"></i><h3>Clan Tag</h3><span class="ci-card-badge badge-gray">None</span></div><div class="ci-card-body"><div class="ci-empty"><i class="fa-solid fa-users"></i><span>No clan tag</span><small style="font-size:0.75rem;opacity:0.7">No primary guild clan tag set.</small></div></div></div>';
        }

        // Style card
        var styleCard = '';
        if (d.displayNameStyles) {
            var s = d.displayNameStyles;
            styleCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-font"></i><h3>Display Styles</h3><span class="ci-card-badge badge-blurple">Styled</span></div><div class="ci-card-body"><div class="ci-meta-list"><div><strong>Font ID:</strong> <code>' + esc(s.fontId) + '</code></div><div><strong>Effect ID:</strong> <code>' + esc(s.effectId) + '</code></div><div><strong>Colors:</strong> ' + (s.colors && s.colors.length ? s.colors.map(function(c){ return '<code>' + esc(c) + '</code>'; }).join(' ') : '<span style="opacity:0.6">none</span>') + '</div></div></div></div>';
        } else {
            styleCard = '<div class="ci-card"><div class="ci-card-head"><i class="fa-solid fa-font"></i><h3>Display Styles</h3><span class="ci-card-badge badge-gray">Default</span></div><div class="ci-card-body"><div class="ci-empty"><i class="fa-solid fa-font"></i><span>Default style</span><small style="font-size:0.75rem;opacity:0.7">No custom font/effect equipped.</small></div></div></div>';
        }

        var grid = '<div class="ci-sections">' + avatarCard + bannerCard + decoCard + npCard + clanCard + styleCard + '</div>';

        resultEl.innerHTML = '<div class="result-card"><div class="result-body">' + head + grid + '</div></div>';
        var card = resultEl.querySelector('.result-card');
        if (card) card.classList.add('result-card-in');
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (infoEl) infoEl.style.display = 'none';

        // Wire avatar picker — preview STAYS animated
        (function(){
            var fmtEl = document.querySelector('[data-dd="ci-av-fmt"]');
            var sizeEl = document.querySelector('[data-dd="ci-av-size"]');
            if (!fmtEl || !sizeEl) return;
            var urlEl = document.getElementById('ci-avatar-url');
            var labelEl = document.getElementById('ci-avatar-fmt-label');
            var copyBtn = document.getElementById('ci-avatar-copy');
            var dlBtn = document.getElementById('ci-avatar-download');
            var curFmt = defaultAvatarFmt;
            var curSize = defaultAvatarSize;
            function find(fmt,size){
                for(var i=0;i<d.avatar.formats.length;i++){ if(d.avatar.formats[i].format===fmt && d.avatar.formats[i].size===size) return d.avatar.formats[i];}
                for(var i=0;i<d.avatar.formats.length;i++){ if(d.avatar.formats[i].format===fmt) return d.avatar.formats[i];}
                return d.avatar.formats[0];
            }
            function update(){
                var e=find(curFmt, curSize);
                if(!e) return;
                labelEl.textContent=e.format+' · '+e.size+'px';
                urlEl.href=e.url; urlEl.textContent=e.url;
                copyBtn.setAttribute('data-copy', e.url);
                dlBtn.href=e.url;
            }
            function wireDD(dd, cb){
                var btn=dd.querySelector('[data-dd-btn]');
                var label=dd.querySelector('[data-dd-label]');
                var opts=[].slice.call(dd.querySelectorAll('[data-dd-opt]'));
                function open(){ dd.classList.add('is-open'); btn.setAttribute('aria-expanded','true'); btn.classList.add('ac-dd-open');}
                function close(){ dd.classList.remove('is-open'); btn.setAttribute('aria-expanded','false'); btn.classList.remove('ac-dd-open');}
                btn.addEventListener('click', function(e){ e.stopPropagation(); if(dd.classList.contains('is-open')) close(); else {closeAllDDs(); open();}});
                opts.forEach(function(o){ o.addEventListener('click', function(e){ e.stopPropagation(); opts.forEach(function(x){x.classList.remove('ac-dd-option-selected');}); o.classList.add('ac-dd-option-selected'); label.textContent=o.querySelector('span').textContent; cb(o.getAttribute('data-dd-opt')); close();});});
                return close;
            }
            ddClosers.push(wireDD(fmtEl, function(v){ curFmt=v; update();}));
            ddClosers.push(wireDD(sizeEl, function(v){ curSize=Number(v); update();}));
            copyBtn.addEventListener('click', function(){ copyText(copyBtn.getAttribute('data-copy'), copyBtn);});
            update();
        })();

        // Wire banner picker — preview stays animated
        (function(){
            if(!hasBanner) return;
            var fmtEl=document.querySelector('[data-dd="ci-bn-fmt"]');
            var sizeEl=document.querySelector('[data-dd="ci-bn-size"]');
            if(!fmtEl||!sizeEl) return;
            var urlEl=document.getElementById('ci-banner-url');
            var labelEl=document.getElementById('ci-banner-fmt-label');
            var copyBtn=document.getElementById('ci-banner-copy');
            var dlBtn=document.getElementById('ci-banner-download');
            var curFmt = defBFmt; var curSize = defBSize;
            function find(fmt,size){ for(var i=0;i<d.banner.formats.length;i++){ if(d.banner.formats[i].format===fmt && d.banner.formats[i].size===size) return d.banner.formats[i];} for(var i=0;i<d.banner.formats.length;i++){ if(d.banner.formats[i].format===fmt) return d.banner.formats[i];} return d.banner.formats[0];}
            function update(){ var e=find(curFmt,curSize); if(!e) return; labelEl.textContent=e.format+' · '+e.size+'px'; urlEl.href=e.url; urlEl.textContent=e.url; copyBtn.setAttribute('data-copy',e.url); dlBtn.href=e.url; }
            function wireDD(dd,cb){
                var btn=dd.querySelector('[data-dd-btn]'); var label=dd.querySelector('[data-dd-label]'); var opts=[].slice.call(dd.querySelectorAll('[data-dd-opt]'));
                function open(){ dd.classList.add('is-open'); btn.setAttribute('aria-expanded','true'); btn.classList.add('ac-dd-open');}
                function close(){ dd.classList.remove('is-open'); btn.setAttribute('aria-expanded','false'); btn.classList.remove('ac-dd-open');}
                btn.addEventListener('click', function(e){ e.stopPropagation(); if(dd.classList.contains('is-open')) close(); else {closeAllDDs(); open();}});
                opts.forEach(function(o){ o.addEventListener('click', function(e){ e.stopPropagation(); opts.forEach(function(x){x.classList.remove('ac-dd-option-selected');}); o.classList.add('ac-dd-option-selected'); label.textContent=o.querySelector('span').textContent; cb(o.getAttribute('data-dd-opt')); close();});});
                return close;
            }
            ddClosers.push(wireDD(fmtEl,function(v){curFmt=v;update();}));
            ddClosers.push(wireDD(sizeEl,function(v){curSize=Number(v);update();}));
            copyBtn.addEventListener('click', function(){ copyText(copyBtn.getAttribute('data-copy'), copyBtn);});
            update();
        })();

        // Wire deco picker
        (function(){
            if(!hasDeco) return;
            var sizeEl=document.querySelector('[data-dd="ci-deco-size"]');
            if(!sizeEl) return;
            var preview=document.getElementById('ci-deco-preview');
            var urlEl=document.getElementById('ci-deco-url');
            var labelEl=document.getElementById('ci-deco-label');
            var copyBtn=document.getElementById('ci-deco-copy');
            var dlBtn=document.getElementById('ci-deco-download');
            var curSize=defDecoSize;
            function find(size){ for(var i=0;i<d.avatarDecoration.formats.length;i++){ if(d.avatarDecoration.formats[i].size===size) return d.avatarDecoration.formats[i];} return d.avatarDecoration.formats[0];}
            function update(){ var e=find(curSize); if(!e) return; labelEl.textContent='PNG · '+e.size+'px'; urlEl.href=e.url; urlEl.textContent=e.url; copyBtn.setAttribute('data-copy',e.url); dlBtn.href=e.url; if(preview) preview.src=e.url; }
            function wireDD(dd,cb){
                var btn=dd.querySelector('[data-dd-btn]'); var label=dd.querySelector('[data-dd-label]'); var opts=[].slice.call(dd.querySelectorAll('[data-dd-opt]'));
                function open(){ dd.classList.add('is-open'); btn.setAttribute('aria-expanded','true'); btn.classList.add('ac-dd-open');}
                function close(){ dd.classList.remove('is-open'); btn.setAttribute('aria-expanded','false'); btn.classList.remove('ac-dd-open');}
                btn.addEventListener('click', function(e){ e.stopPropagation(); if(dd.classList.contains('is-open')) close(); else {closeAllDDs(); open();}});
                opts.forEach(function(o){ o.addEventListener('click', function(e){ e.stopPropagation(); opts.forEach(function(x){x.classList.remove('ac-dd-option-selected');}); o.classList.add('ac-dd-option-selected'); label.textContent=o.querySelector('span').textContent; cb(o.getAttribute('data-dd-opt')); close();});});
                return close;
            }
            ddClosers.push(wireDD(sizeEl,function(v){curSize=Number(v);update();}));
            copyBtn.addEventListener('click', function(){ copyText(copyBtn.getAttribute('data-copy'), copyBtn);});
            update();
        })();

        // Wire nameplate & clan copy buttons (static)
        resultEl.querySelectorAll('.ci-link-row .es-copy-btn').forEach(function(btn){
            if(btn.id && (btn.id==='ci-avatar-copy'||btn.id==='ci-banner-copy'||btn.id==='ci-deco-copy')) return;
            btn.addEventListener('click', function(){ copyText(btn.getAttribute('data-copy'), btn);});
        });
    }

    function lookup(id){
        if (!/^\d{17,20}$/.test(id)) {
            resultEl.innerHTML = errorHTML('That doesn\'t look like a valid Discord user ID. IDs are 17-20 digits long.');
            return;
        }
        history.replaceState(null, '', '/tools/collectibles-inspector/?userid=' + id);
        resultEl.innerHTML = loadingHTML('Inspecting collectibles…');
        if (infoEl) infoEl.style.display = 'none';
        fetch('/api/collectibles/' + encodeURIComponent(id))
            .then(function(r){
                var ct=r.headers.get('content-type')||'';
                if(ct.indexOf('application/json')===-1) throw new Error('Unexpected server response');
                return r.json().then(function(body){ return {ok:r.ok,status:r.status,body:body};});
            })
            .then(function(res){
                if(!res.ok || !res.body || res.body.error){
                    var msg=res.body && res.body.error;
                    if(res.status===404) msg='User not found.';
                    else if(!msg||/500|failed/i.test(msg)) msg='Failed to fetch user.';
                    throw msg;
                }
                renderResult(res.body);
            })
            .catch(function(err){ resultEl.innerHTML=errorHTML(err||'Failed to fetch user.'); if(infoEl) infoEl.style.display=''; });
    }

    var params=new URLSearchParams(location.search);
    var prefilled=params.get('userid')||params.get('id');
    if(prefilled && /^\d{17,20}$/.test(prefilled)){
        input.value=prefilled;
        history.replaceState(null,'','/tools/collectibles-inspector/?userid='+prefilled);
        lookup(prefilled);
    }
    input.focus();
    form.addEventListener('submit', function(e){
        e.preventDefault();
        var id=(input.value||'').trim();
        if(!id) return;
        lookup(id);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hint-example'), function(el){
        el.addEventListener('click', function(){
            input.value=el.getAttribute('data-id');
            form.dispatchEvent(new Event('submit'));
        });
    });
})();
