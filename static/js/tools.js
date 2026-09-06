/* Disc-Tools tool grid: category filter + favorites (localStorage) */
(function () {
    'use strict';

    var FAV_KEY = 'dt-favs-v1';
    var VALID_FILTERS = ['all', 'favorites', 'look-things-up', 'create-format', 'manage-extract'];

    var favs = [];
    try {
        var raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
        if (Array.isArray(raw)) favs = raw;
    } catch (e) { /* ignore */ }

    var chips = Array.prototype.slice.call(document.querySelectorAll('.filter-chip'));
    var cards = Array.prototype.slice.call(document.querySelectorAll('.tool-card'));
    var empty = document.getElementById('emptyState');
    var emptyAllBtn = document.getElementById('emptyAll');
    var favCount = document.querySelector('.filter-chip[data-filter="favorites"] .fav-count');

    function save() {
        try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch (e) { /* ignore */ }
    }

    function isFav(slug) {
        return favs.indexOf(slug) !== -1;
    }

    function renderStars() {
        cards.forEach(function (card) {
            var slug = card.dataset.slug;
            var btn = card.querySelector('.star-btn');
            card.classList.toggle('starred', isFav(slug));
            if (btn) btn.setAttribute('aria-pressed', isFav(slug) ? 'true' : 'false');
        });
        if (favCount) favCount.textContent = favs.length;
    }

    function applyFilter(filter) {
        if (VALID_FILTERS.indexOf(filter) === -1) filter = 'all';
        var visible = 0;
        cards.forEach(function (card) {
            var ok = filter === 'all' ||
                (filter === 'favorites' && isFav(card.dataset.slug)) ||
                card.dataset.cat === filter;
            card.classList.toggle('hidden', !ok);
            if (ok) visible += 1;
        });
        if (empty) empty.classList.toggle('hidden', !(filter === 'favorites' && visible === 0));
        chips.forEach(function (chip) {
            var active = chip.dataset.filter === filter;
            chip.classList.toggle('active', active);
            chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        try { history.replaceState(null, '', '#' + filter); } catch (e) { /* ignore */ }
    }

    chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            applyFilter(chip.dataset.filter);
        });
    });

    cards.forEach(function (card) {
        var btn = card.querySelector('.star-btn');
        if (!btn) return;
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var i = favs.indexOf(card.dataset.slug);
            if (i === -1) favs.push(card.dataset.slug);
            else favs.splice(i, 1);
            save();
            renderStars();
            var active = chips.find(function (c) { return c.classList.contains('active'); });
            if (active && active.dataset.filter === 'favorites') {
                applyFilter('favorites');
            }
        });
    });

    if (emptyAllBtn) {
        emptyAllBtn.addEventListener('click', function () {
            applyFilter('all');
        });
    }

    var initial = (location.hash || '').replace('#', '');
    renderStars();
    applyFilter(initial);
})();
