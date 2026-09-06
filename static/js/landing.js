/* Disc-Tools Landing: nav pill, mobile menu */
(function () {
    'use strict';

    /* Pill-Navbar: nur Zustand togglen, rAF-throttled */
    var shell = document.getElementById('siteNav');
    var THRESHOLD_ON = 64;   // aktivieren
    var THRESHOLD_OFF = 32;  // deaktivieren (Hysterese: kein Flackern an der Schwelle)
    var ticking = false;
    var isPill = false;

    function updatePill() {
        var y = window.scrollY || 0;
        var next = isPill;

        if (!isPill && y > THRESHOLD_ON) {
            next = true;
        } else if (isPill && y < THRESHOLD_OFF) {
            next = false;
        }

        if (next !== isPill) {
            isPill = next;
            shell.classList.toggle('is-pill', isPill);
        }
        ticking = false;
    }

    window.addEventListener('scroll', function () {
        if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(updatePill);
        }
    }, { passive: true });

    updatePill();

    /* Mobile Menu */
    var toggle = document.getElementById('navToggle');
    var menu = document.getElementById('mobileMenu');
    var lastFocus = null;

    function setMenu(open) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        menu.hidden = !open;
        document.body.classList.toggle('menu-open', open);
        if (open) {
            lastFocus = document.activeElement;
            var first = menu.querySelector('a');
            if (first) first.focus();
        } else if (lastFocus && lastFocus.focus) {
            lastFocus.focus();
        }
    }

    toggle.addEventListener('click', function () {
        setMenu(menu.hidden);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !menu.hidden) {
            setMenu(false);
        }
    });

    menu.addEventListener('click', function (e) {
        if (e.target.closest('a')) setMenu(false);
    });

    /* Number Ticker (Hero-Stats) */
    var statNums = Array.prototype.slice.call(document.querySelectorAll('.stat-num[data-count]'));
    var reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function animateCount(el) {
        var target = parseInt(el.getAttribute('data-count'), 10) || 0;
        var prefix = el.getAttribute('data-prefix') || '';
        var duration = 1200;
        var start = null;

        function frame(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
            el.textContent = prefix + Math.round(target * eased);
            if (p < 1) {
                window.requestAnimationFrame(frame);
            } else {
                el.textContent = prefix + target;
            }
        }

        el.textContent = prefix + 0;
        window.requestAnimationFrame(frame);
    }

    if ('IntersectionObserver' in window && statNums.length) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                io.unobserve(el);
                if (reduceMotion) {
                    el.textContent = (el.getAttribute('data-prefix') || '') +
                        (parseInt(el.getAttribute('data-count'), 10) || 0);
                } else {
                    animateCount(el);
                }
            });
        }, { threshold: 0.6 });

        statNums.forEach(function (el) { io.observe(el); });
    }
})();
