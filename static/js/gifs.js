/* Disc-Tools GIF gallery: list, search, single view, upload, NSFW age gate */
(function () {
    'use strict';

    var PER_PAGE = 30;
    var ADULT_KEY = 'dt-gifs-adult-v1';

    var galleryView = document.getElementById('gallery-view');
    var singleView = document.getElementById('single-view');
    var singleContent = document.getElementById('single-content');
    var gifsContainer = document.getElementById('gifs-container');
    var paginationEl = document.getElementById('pagination');
    var searchInput = document.getElementById('search-input');
    var nsfwToggle = document.getElementById('nsfw-toggle');
    var nsfwLabel = document.getElementById('nsfw-label');
    var nsfwLabelText = document.getElementById('nsfw-label-text');
    var uploadBtnHeader = document.getElementById('upload-btn-header');

    var uploadModal = document.getElementById('upload-modal');
    var uploadForm = document.getElementById('upload-form');
    var gifNameInput = document.getElementById('gif-name');
    var gifTagsInput = document.getElementById('gif-tags');
    var gifNsfwInput = document.getElementById('gif-nsfw');
    var gifFileInput = document.getElementById('gif-file');
    var dropZone = document.getElementById('drop-zone');
    var dropZoneContent = document.getElementById('drop-zone-content');
    var dropPreview = document.getElementById('drop-preview');
    var previewImg = document.getElementById('preview-img');
    var previewName = document.getElementById('preview-name');
    var previewSize = document.getElementById('preview-size');
    var uploadSubmitBtn = document.getElementById('upload-submit-btn');

    var birthdayModal = document.getElementById('birthday-modal');
    var birthdayInput = document.getElementById('birthday-input');
    var ageBanner = document.getElementById('age-restricted-banner');

    var selectedFile = null;
    var currentPage = 1;
    var currentQuery = '';
    var nsfwEnabled = false;
    var currentUser = null;   // { id, username, ... } or null
    var isAdult = false;

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtSize(bytes) {
        if (!bytes) return '0 B';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(2) + ' MB';
    }

    function timeAgo(dateStr) {
        var d = new Date(dateStr);
        var s = Math.floor((Date.now() - d.getTime()) / 1000);
        if (s < 60) return 'just now';
        var m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        var h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        var days = Math.floor(h / 24);
        if (days < 30) return days + 'd ago';
        var mo = Math.floor(days / 30);
        if (mo < 12) return mo + 'mo ago';
        return Math.floor(mo / 12) + 'y ago';
    }

    function defaultAvatar(userId) {
        try {
            var idx = Number(BigInt(userId) >> 22n % 6n);
        } catch (e) {
            idx = 0;
        }
        return 'https://cdn.discordapp.com/embed/avatars/' + idx + '.png';
    }

    function avatarURL(userId, avatar) {
        if (!avatar) return defaultAvatar(userId);
        var ext = avatar.startsWith('a_') ? 'gif' : 'webp';
        return 'https://cdn.discordapp.com/avatars/' + userId + '/' + avatar + '.' + ext + '?size=64';
    }

    function loadingHtml(msg) {
        return '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><br>' + esc(msg) + '</div>';
    }

    function emptyHtml(msg) {
        return '<div class="gifs-empty"><i class="fa-solid fa-image"></i><p>' + esc(msg) + '</p></div>';
    }

    function errorHtml(msg) {
        return '<div class="gifs-empty gifs-error"><i class="fa-solid fa-triangle-exclamation"></i><p>' + esc(msg) + '</p></div>';
    }

    /* ---------- Search (debounced, exposed for inline oninput) ---------- */
    var searchTimer = null;
    window.debouncedSearch = function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            currentQuery = (searchInput.value || '').trim();
            currentPage = 1;
            loadGifs();
        }, 350);
    };

    function buildQueryParams(page) {
        var parts = ['page=' + encodeURIComponent(page), 'limit=' + PER_PAGE];
        if (currentQuery) {
            if (currentQuery.charAt(0) === '@') {
                var user = currentQuery.slice(1).trim();
                if (user) parts.push('user=' + encodeURIComponent(user));
            } else {
                var tags = currentQuery.split(',').map(function (t) { return t.trim(); })
                    .filter(Boolean).join(',');
                if (tags) parts.push('tags=' + encodeURIComponent(tags));
            }
        }
        // Default view hides NSFW. When the adult gate is open, no nsfw filter
        // is sent so the API returns both SFW + NSFW approved GIFs.
        if (!nsfwEnabled) parts.push('nsfw=false');
        return parts.join('&');
    }

    function loadGifs() {
        gifsContainer.innerHTML = loadingHtml('Loading GIFs...');
        paginationEl.classList.add('hidden');
        paginationEl.innerHTML = '';

        fetch('/api/gifs?' + buildQueryParams(currentPage), { credentials: 'include' })
            .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
            .then(function (res) {
                if (!res.ok) throw (res.body && res.body.error) || 'Failed to fetch GIFs';
                renderGifs(res.body.gifs || []);
                renderPagination(res.body.total || 0, res.body.page || 1, res.body.limit || PER_PAGE);
            })
            .catch(function (err) {
                gifsContainer.innerHTML = errorHtml(err || 'Failed to fetch GIFs');
            });
    }

    function renderGifs(gifs) {
        if (!gifs.length) {
            gifsContainer.innerHTML = emptyHtml(nsfwEnabled ? 'No GIFs found.' : 'No GIFs found. Try enabling NSFW or a different search.');
            return;
        }
        var html = '<div class="gifs-grid">';
        gifs.forEach(function (g) {
            var tagBadges = (g.tags && g.tags.length)
                ? '<div class="gifs-tags">' + g.tags.slice(0, 4).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>'
                : '';
            html +=
                '<div class="gif-card' + (g.nsfw ? ' is-nsfw' : '') + '" data-id="' + esc(g.id) + '" data-user="' + esc(g.user_id) + '" role="button" tabindex="0" aria-label="' + esc(g.name) + '">' +
                    '<div class="gif-card-media">' +
                        '<img src="' + esc(g.url) + '" alt="' + esc(g.name) + '" loading="lazy" width="' + (g.width || '') + '" height="' + (g.height || '') + '">' +
                        (g.nsfw ? '<span class="gif-nsfw-badge">NSFW</span>' : '') +
                    '</div>' +
                    '<div class="gif-card-body">' +
                        '<p class="gif-card-name" title="' + esc(g.name) + '">' + esc(g.name) + '</p>' +
                        '<p class="gif-card-meta">' + esc(g.uploader_name || 'Unknown') + ' • ' + timeAgo(g.created_at) + '</p>' +
                        tagBadges +
                    '</div>' +
                '</div>';
        });
        html += '</div>';
        gifsContainer.innerHTML = html;

        Array.prototype.forEach.call(gifsContainer.querySelectorAll('.gif-card'), function (card) {
            card.addEventListener('click', function () { showSingle(card.getAttribute('data-id'), card.getAttribute('data-user'), true); });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showSingle(card.getAttribute('data-id'), card.getAttribute('data-user'), true); }
            });
        });
    }

    function renderPagination(total, page, limit) {
        var pages = Math.ceil(total / limit);
        if (pages <= 1) { paginationEl.classList.add('hidden'); paginationEl.innerHTML = ''; return; }

        var html = '';
        html += '<button class="page-btn"' + (page <= 1 ? ' disabled' : '') + ' data-page="' + (page - 1) + '"><i class="fa-solid fa-chevron-left"></i></button>';

        var start = Math.max(1, page - 2);
        var end = Math.min(pages, start + 4);
        start = Math.max(1, end - 4);
        for (var i = start; i <= end; i++) {
            html += '<button class="page-btn' + (i === page ? ' active' : '') + '" data-page="' + i + '">' + i + '</button>';
        }

        html += '<button class="page-btn"' + (page >= pages ? ' disabled' : '') + ' data-page="' + (page + 1) + '"><i class="fa-solid fa-chevron-right"></i></button>';
        html += '<span class="page-info">' + page + ' / ' + pages + '</span>';

        paginationEl.innerHTML = html;
        paginationEl.classList.remove('hidden');

        Array.prototype.forEach.call(paginationEl.querySelectorAll('.page-btn'), function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                currentPage = parseInt(btn.getAttribute('data-page'), 10) || 1;
                loadGifs();
                galleryView.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    /* ---------- Single view ---------- */
    function showSingle(id, userId, pushState) {
        singleContent.innerHTML = loadingHtml('Loading GIF...');
        galleryView.classList.add('hidden');
        singleView.classList.remove('hidden');
        if (pushState) history.pushState({ gif: id }, '', '/gifs/' + (userId || '') + '/' + id + '/');

        fetch('/api/gifs/' + encodeURIComponent(id), { credentials: 'include' })
            .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
            .then(function (res) {
                if (!res.ok) throw (res.body && res.body.error) || 'GIF not found';
                renderSingle(res.body);
            })
            .catch(function (err) {
                singleContent.innerHTML = errorHtml(err || 'GIF not found');
            });
    }

    function renderSingle(g) {
        var canManage = currentUser && currentUser.id === g.user_id;
        var pending = g.moderation_status && g.moderation_status !== 'approved';

        var actions = '';
        if (currentUser) {
            if (canManage) {
                actions += '<button class="btn btn-ghost btn-sm" id="gif-delete-btn"><i class="fa-solid fa-trash"></i> Delete</button>';
            } else {
                actions += '<button class="btn btn-ghost btn-sm" id="gif-report-btn"><i class="fa-solid fa-flag"></i> Report</button>';
            }
        } else {
            actions += '<a class="btn btn-ghost btn-sm" href="/api/auth/login?redirect=' + encodeURIComponent('/gifs/' + g.user_id + '/' + g.id + '/') + '"><i class="fa-solid fa-right-to-bracket"></i> Login</a>';
        }
        actions += '<button class="btn btn-primary btn-sm" id="gif-copy-btn"><i class="fa-solid fa-link"></i> Copy link</button>';

        var tagBadges = (g.tags && g.tags.length)
            ? '<div class="gifs-tags">' + g.tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>'
            : '';

        var pendingNotice = pending
            ? '<div class="gif-pending-notice"><i class="fa-solid fa-clock"></i> This GIF is pending moderation review. Only you can see it.</div>'
            : '';

        var uploaderDisplay = esc(g.uploader_name || 'Unknown');

        singleContent.innerHTML =
            pendingNotice +
            '<div class="gif-single">' +
                '<div class="gif-single-media' + (g.nsfw ? ' is-nsfw' : '') + '">' +
                    '<img src="' + esc(g.url) + '" alt="' + esc(g.name) + '">' +
                    (g.nsfw ? '<span class="gif-nsfw-badge">NSFW</span>' : '') +
                '</div>' +
                '<div class="gif-single-info">' +
                    '<div>' +
                        '<h2>' + esc(g.name) + '</h2>' +
                        '<div class="gif-uploader-row">' +
                            '<span class="gif-uploader-label">Uploaded by</span>' +
                            '<p class="gif-uploader">' +
                                '<img class="gif-uploader-avatar" id="gif-uploader-avatar" alt="" src="' + defaultAvatar(g.user_id) + '">' +
                                '<span>' + uploaderDisplay + '</span>' +
                            '</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="gif-stats">' +
                        '<span><i class="fa-solid fa-eye"></i> ' + (g.views || 0) + ' views</span>' +
                        '<span><i class="fa-solid fa-expand"></i> ' + (g.width || '?') + '×' + (g.height || '?') + '</span>' +
                        '<span><i class="fa-solid fa-weight-hanging"></i> ' + fmtSize(g.file_size) + '</span>' +
                        '<span><i class="fa-solid fa-clock"></i> ' + timeAgo(g.created_at) + '</span>' +
                    '</div>' +
                    (tagBadges ? '<div class="gif-single-tags">' + tagBadges + '</div>' : '') +
                    '<div class="gif-single-actions">' + actions + '</div>' +
                '</div>' +
            '</div>' +
            '<div id="gif-related-mount"></div>';

        var copyBtn = document.getElementById('gif-copy-btn');
        if (copyBtn) copyBtn.addEventListener('click', function () {
            var link = location.origin + '/gifs/' + g.user_id + '/' + g.id + '/';
            navigator.clipboard && navigator.clipboard.writeText(link).then(function () {
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                setTimeout(function () { copyBtn.innerHTML = '<i class="fa-solid fa-link"></i> Copy link'; }, 1800);
            }).catch(function () {});
        });

        var delBtn = document.getElementById('gif-delete-btn');
        if (delBtn) delBtn.addEventListener('click', function () { deleteGif(g.id, g.name); });

        var repBtn = document.getElementById('gif-report-btn');
        if (repBtn) repBtn.addEventListener('click', function () { reportGif(g.id, g.name); });

        fetchUploaderAvatar(g.user_id);

        loadRelatedSections(g);
    }

    function fetchUploaderAvatar(userId) {
        if (!/^\d{17,20}$/.test(userId)) return;
        var imgEl = document.getElementById('gif-uploader-avatar');
        if (!imgEl) return;
        fetch('/api/users/' + userId)
            .then(function (r) { return r.json(); })
            .then(function (user) {
                if (user && user.avatar) {
                    imgEl.src = avatarURL(userId, user.avatar);
                }
            })
            .catch(function () {});
    }

    /* ---------- Related GIFs (More by user / Similar by tags) ---------- */
    function fetchRelated(params) {
        var qs = [];
        Object.keys(params).forEach(function (k) { qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k])); });
        return fetch('/api/gifs?' + qs.join('&'), { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (body) { return (body && body.gifs) || []; })
            .catch(function () { return []; });
    }

    function buildMiniCard(gif) {
        return '<a class="gif-mini" data-id="' + esc(gif.id) + '" data-user="' + esc(gif.user_id) + '" role="button" tabindex="0" aria-label="' + esc(gif.name) + '">' +
            '<div class="gif-mini-media">' +
                '<img src="' + esc(gif.url) + '" alt="' + esc(gif.name) + '" loading="lazy">' +
                (gif.nsfw ? '<span class="gif-nsfw-badge">NSFW</span>' : '') +
            '</div>' +
            '<p class="gif-mini-name" title="' + esc(gif.name) + '">' + esc(gif.name) + '</p>' +
        '</a>';
    }

    function renderStrip(mount, titleHTML, gifs) {
        if (!gifs.length) return;
        var stripHTML = '<div class="gif-related">' +
            '<h3 class="gif-related-title">' + titleHTML + '</h3>' +
            '<div class="gif-related-strip">' + gifs.map(buildMiniCard).join('') + '</div>' +
        '</div>';
        mount.insertAdjacentHTML('beforeend', stripHTML);

        Array.prototype.forEach.call(mount.querySelectorAll('.gif-mini'), function (card) {
            card.addEventListener('click', function () {
                showSingle(card.getAttribute('data-id'), card.getAttribute('data-user'), true);
                singleView.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            card.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    showSingle(card.getAttribute('data-id'), card.getAttribute('data-user'), true);
                    singleView.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    function loadRelatedSections(g) {
        var mount = document.getElementById('gif-related-mount');
        if (!mount) return;

        var callUser = fetchRelated({ user: g.user_id, limit: 9, nsfw: nsfwEnabled ? 'all' : 'false' })
            .then(function (gifs) {
                var filtered = gifs.filter(function (x) { return x.id !== g.id; }).slice(0, 8);
                if (!filtered.length) return;
                renderStrip(mount,
                    '<i class="fa-solid fa-user-group"></i> More by ' + esc(g.uploader_name || 'Unknown') +
                    ' <a class="gif-related-link" href="/gifs/?' + (g.user_id ? 'user=' + encodeURIComponent(g.user_id) : '') + '">View all →</a>',
                    filtered);
            });

        var tagCSV = (g.tags && g.tags.length) ? g.tags.join(',') : null;
        if (!tagCSV) return callUser;

        var callTags = fetchRelated({ tags: tagCSV, limit: 9, nsfw: nsfwEnabled ? 'all' : 'false' })
            .then(function (gifs) {
                var filtered = gifs.filter(function (x) { return x.id !== g.id; }).slice(0, 8);
                if (!filtered.length) return;
                renderStrip(mount,
                    '<i class="fa-solid fa-tags"></i> Similar GIFs',
                    filtered);
            });

        return Promise.all([callUser, callTags]);
    }

    window.showGallery = function (pushState) {
        singleView.classList.add('hidden');
        singleContent.innerHTML = '';
        galleryView.classList.remove('hidden');
        if (pushState !== false) history.pushState({ gallery: true }, '', '/gifs/');
        loadGifs();
    };

    /* ---------- Report / Delete ---------- */
    function reportGif(id, name) {
        if (!currentUser) { window.location.href = '/api/auth/login?redirect=' + encodeURIComponent(location.pathname); return; }
        var reason = prompt('Report "' + name + '" — reason:');
        if (reason == null) return;
        fetch('/api/gifs/' + encodeURIComponent(id) + '/report', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason })
        }).then(function (r) { return r.json(); }).then(function (body) {
            if (body && body.success) showToast('Report submitted. Thank you!', 'success');
            else throw (body && body.error) || 'Failed to report';
        }).catch(function (err) { showToast(err || 'Failed to report', 'error'); });
    }

    function deleteGif(id, name) {
        if (!currentUser) return;
        if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
        fetch('/api/gifs/' + encodeURIComponent(id) + '/delete', {
            method: 'POST', credentials: 'include'
        }).then(function (r) { return r.json(); }).then(function (body) {
            if (body && body.success) { showToast('GIF deleted.', 'success'); showGallery(true); loadGifs(); }
            else throw (body && body.error) || 'Failed to delete';
        }).catch(function (err) { showToast(err || 'Failed to delete', 'error'); });
    }

    /* ---------- Toast ---------- */
    function showToast(msg, type) {
        var existing = document.querySelector('.gif-toast');
        if (existing) existing.remove();
        var el = document.createElement('div');
        el.className = 'gif-toast gif-toast-' + (type || 'info');
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.classList.add('visible'); });
        setTimeout(function () {
            el.classList.remove('visible');
            setTimeout(function () { el.remove(); }, 300);
        }, 3200);
    }

    /* ---------- Upload modal + drop zone ---------- */
    window.hideUpload = function () {
        uploadModal.classList.add('hidden');
        uploadForm.reset();
        clearDropZone();
    };

    function openUpload() {
        if (!currentUser) {
            window.location.href = '/api/auth/login?redirect=' + encodeURIComponent('/gifs/');
            return;
        }
        uploadModal.classList.remove('hidden');
    }

    if (uploadBtnHeader) uploadBtnHeader.addEventListener('click', openUpload);

    window.clearDropZone = function () {
        selectedFile = null;
        if (gifFileInput) gifFileInput.value = '';
        if (dropPreview) dropPreview.classList.add('hidden');
        if (dropZoneContent) dropZoneContent.classList.remove('hidden');
    };

    function setSelectedFile(file) {
        if (!file) return;
        if (file.type !== 'image/gif' && !/\.gif$/i.test(file.name)) {
            showToast('Only .gif files are allowed.', 'error');
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            showToast('File too large (max 8MB).', 'error');
            return;
        }
        selectedFile = file;
        previewImg.src = URL.createObjectURL(file);
        previewName.textContent = file.name;
        previewSize.textContent = fmtSize(file.size);
        dropZoneContent.classList.add('hidden');
        dropPreview.classList.remove('hidden');
    }

    if (dropZone) {
        dropZone.addEventListener('click', function () { if (gifFileInput) gifFileInput.click(); });
        dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag'); });
        dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag'); });
        dropZone.addEventListener('drop', function (e) {
            e.preventDefault(); dropZone.classList.remove('drag');
            var file = e.dataTransfer.files && e.dataTransfer.files[0];
            setSelectedFile(file);
        });
    }
    if (gifFileInput) gifFileInput.addEventListener('change', function () { setSelectedFile(this.files[0]); });

    window.submitUpload = function (event) {
        event.preventDefault();
        if (!currentUser) { window.location.href = '/api/auth/login?redirect=' + encodeURIComponent('/gifs/'); return; }
        if (!selectedFile) { showToast('Please choose a GIF file.', 'error'); return; }

        var fd = new FormData();
        fd.append('name', gifNameInput.value.trim());
        fd.append('tags', gifTagsInput.value);
        fd.append('nsfw', gifNsfwInput.checked ? 'true' : 'false');
        fd.append('file', selectedFile, selectedFile.name);

        uploadSubmitBtn.disabled = true;
        uploadSubmitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';

        fetch('/api/gifs/upload', { method: 'POST', credentials: 'include', body: fd })
            .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
            .then(function (res) {
                uploadSubmitBtn.disabled = false;
                uploadSubmitBtn.innerHTML = 'Upload';
                if (!res.ok) throw (res.body && res.body.error) || 'Upload failed';

                hideUpload();
                if (res.body.moderation_status === 'pending') {
                    showToast('Uploaded! NSFW content is pending review.', 'info');
                } else {
                    showToast('Upload complete!', 'success');
                }
                currentPage = 1;
                currentQuery = '';
                if (searchInput) searchInput.value = '';
                loadGifs();
            })
            .catch(function (err) {
                uploadSubmitBtn.disabled = false;
                uploadSubmitBtn.innerHTML = 'Upload';
                showToast(err || 'Upload failed', 'error');
            });
    };

    /* ---------- Birthday / NSFW age gate ---------- */
    window.closeBirthdayModal = function () {
        birthdayModal.classList.add('hidden');
        nsfwToggle.checked = false;
        nsfwEnabled = false;
        updateNsfwLabel();
    };

    window.saveBirthday = function () {
        var val = birthdayInput.value;
        if (!val) { showToast('Please enter your date of birth.', 'error'); return; }
        fetch('/api/user/birthday', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ birthday: val })
        }).then(function (r) { return r.json(); }).then(function (body) {
            if (body && body.isAdult) {
                isAdult = true;
                try { localStorage.setItem(ADULT_KEY, '1'); } catch (e) {}
                birthdayModal.classList.add('hidden');
                nsfwToggle.checked = true;
                nsfwEnabled = true;
                updateNsfwLabel();
                currentPage = 1;
                loadGifs();
            } else if (body && body.isAdult === false) {
                birthdayModal.classList.add('hidden');
                nsfwToggle.checked = false;
                nsfwEnabled = false;
                updateNsfwLabel();
                ageBanner.classList.remove('hidden');
                showToast('You must be 18+ to view NSFW content.', 'error');
            } else {
                throw (body && body.error) || 'Failed to save';
            }
        }).catch(function (err) { showToast(err || 'Failed to verify age', 'error'); });
    };

    function updateNsfwLabel() {
        if (!nsfwLabel) return;
        nsfwLabel.classList.toggle('active', nsfwEnabled);
        if (nsfwLabelText) nsfwLabelText.textContent = nsfwEnabled ? 'NSFW ON' : 'NSFW';
    }

    window.onNsfwToggle = function () {
        if (nsfwToggle.checked) {
            enableNsfw();
        } else {
            nsfwEnabled = false;
            updateNsfwLabel();
            currentPage = 1;
            loadGifs();
        }
    };

    function enableNsfw() {
        if (!currentUser) {
            nsfwToggle.checked = false;
            window.location.href = '/api/auth/login?redirect=' + encodeURIComponent('/gifs/');
            return;
        }
        if (isAdult) {
            nsfwEnabled = true;
            updateNsfwLabel();
            currentPage = 1;
            loadGifs();
            return;
        }
        // Fetch birthday to decide
        fetch('/api/user/birthday', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (body) {
                if (body && body.isAdult) {
                    isAdult = true;
                    try { localStorage.setItem(ADULT_KEY, '1'); } catch (e) {}
                    nsfwEnabled = true;
                    updateNsfwLabel();
                    currentPage = 1;
                    loadGifs();
                } else if (body && body.isAdult === false) {
                    nsfwToggle.checked = false;
                    updateNsfwLabel();
                    ageBanner.classList.remove('hidden');
                    showToast('You must be 18+ to view NSFW content.', 'error');
                } else {
                    nsfwToggle.checked = false;
                    updateNsfwLabel();
                    birthdayInput.value = '';
                    birthdayModal.classList.remove('hidden');
                }
            })
            .catch(function () {
                nsfwToggle.checked = false;
                updateNsfwLabel();
                showToast('Failed to verify age. Please try again.', 'error');
            });
    }

    /* ---------- Modal overlay close (click backdrop / Esc) ---------- */
    function bindModal(modal) {
        if (!modal) return;
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }
    bindModal(uploadModal);
    bindModal(birthdayModal);

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (uploadModal && !uploadModal.classList.contains('hidden')) { hideUpload(); return; }
        if (birthdayModal && !birthdayModal.classList.contains('hidden')) { closeBirthdayModal(); return; }
    });

    /* ---------- History / deep links ---------- */
    function handleInitialRoute() {
        var m = location.pathname.match(/^\/gifs\/[^/]+\/([0-9a-f-]{36})\/?$/i);
        if (m) {
            showSingle(m[1], null, false);
            return;
        }

        // Prefill search from ?user= / ?tags= (e.g. "View all →" links)
        var params = new URLSearchParams(location.search);
        var prefilled = false;
        if (searchInput) {
            var user = params.get('user');
            var tags = params.get('tags');
            if (user) { searchInput.value = '@' + user; prefilled = true; }
            else if (tags) { searchInput.value = tags; prefilled = true; }
            if (prefilled) currentQuery = searchInput.value;
        }
        loadGifs();
    }

    window.addEventListener('popstate', function () {
        var m = location.pathname.match(/^\/gifs\/[^/]+\/([0-9a-f-]{36})\/?$/i);
        if (m) {
            showSingle(m[1], null, false);
        } else if (singleView && !singleView.classList.contains('hidden')) {
            singleView.classList.add('hidden');
            singleContent.innerHTML = '';
            galleryView.classList.remove('hidden');
        }
    });

    /* ---------- Boot ---------- */
    function boot() {
        try { isAdult = localStorage.getItem(ADULT_KEY) === '1'; } catch (e) {}

        fetch('/api/auth/me', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) { if (data && data.authenticated) currentUser = data.user; })
            .catch(function () {})
            .then(function () { handleInitialRoute(); });
    }

    boot();
})();