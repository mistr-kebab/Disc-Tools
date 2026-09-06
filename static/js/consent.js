/* Cookie consent: essentials always on, choice persisted in localStorage */
(function () {
    'use strict';

    var KEY = 'dt-consent-v1';

    function getConsent() {
        try {
            var c = JSON.parse(localStorage.getItem(KEY));
            if (c && typeof c.essential === 'boolean') return c;
        } catch (e) { /* ignore */ }
        return null;
    }

    function applyConsent(c) {
        // Noch keine Analytics-/Preference-Skripte eingebunden; der
        // Konsens steht fuer spaetere Nutzung bereit (z.B. Umami nur
        // laden, wenn c.analytics true ist).
        document.documentElement.dataset.consent = JSON.stringify(c);
    }

    var banner = document.getElementById('cookieBanner');
    if (!banner) return;

    var panel = document.getElementById('cookiePanel');
    var selectBtn = document.getElementById('cookieSelectBtn');
    var saveBtn = document.getElementById('cookieSaveBtn');

    function save(consent) {
        try { localStorage.setItem(KEY, JSON.stringify(consent)); } catch (e) { /* ignore */ }
        applyConsent(consent);
        banner.hidden = true;
    }

    function setChoices(consent) {
        banner.querySelectorAll('input[data-cat]').forEach(function (box) {
            box.checked = consent[box.dataset.cat] === true;
        });
    }

    function currentSelection() {
        var c = { essential: true, analytics: false, preferences: false };
        banner.querySelectorAll('input[data-cat]').forEach(function (box) {
            c[box.dataset.cat] = box.checked;
        });
        return c;
    }

    var existing = getConsent();
    if (existing) {
        applyConsent(existing);
        banner.hidden = true;
    } else {
        banner.hidden = false;
    }

    banner.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-consent]');
        if (!btn) return;
        if (btn.dataset.consent === 'all') {
            save({ essential: true, analytics: true, preferences: true });
        } else {
            save({ essential: true, analytics: false, preferences: false });
        }
    });

    if (selectBtn) {
        selectBtn.addEventListener('click', function () {
            if (panel) panel.hidden = !panel.hidden;
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            save(currentSelection());
        });
    }

    // Footer-Button "Cookie settings" + zukuenftige weitere Oeffner:
    // document-level Delegation, damit der Klick immer ankommt.
    document.addEventListener('click', function (e) {
        var link = e.target.closest('.cookie-settings-link');
        if (!link) return;
        e.preventDefault();
        if (panel) panel.hidden = false;
        banner.hidden = false;
        setChoices(getConsent() || { essential: true, analytics: false, preferences: false });
    });
})();
