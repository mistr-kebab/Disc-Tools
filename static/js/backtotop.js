/* Back to top: erscheint nach Scroll, scrollt animiert nach oben */
(function () {
    'use strict';

    var btn = document.getElementById('backToTop');
    if (!btn) return;

    var reduceMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function onScroll() {
        var y = window.scrollY || document.documentElement.scrollTop || 0;
        btn.classList.toggle('visible', y > 400);
    }

    btn.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
})();
