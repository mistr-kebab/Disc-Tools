(function () {
    'use strict';
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function (reg) {
            reg.addEventListener('updatefound', function () {
                var worker = reg.installing;
                if (!worker) return;
                worker.addEventListener('statechange', function () {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New SW waiting — signal update available
                    }
                });
            });
        })
        .catch(function () {});

    // Expose cache clear via console: __clearCache()
    window.__clearCache = function () {
        if (!navigator.serviceWorker.controller) {
            caches.keys().then(function (keys) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }).then(function () {
                console.log('All caches cleared.');
                location.reload();
            });
            return;
        }
        navigator.serviceWorker.controller.postMessage('CLEAR_CACHE');
        navigator.serviceWorker.addEventListener('message', function handler(e) {
            if (e.data === 'CACHE_CLEARED') {
                navigator.serviceWorker.removeEventListener('message', handler);
                console.log('Cache cleared via SW. Reloading...');
                location.reload();
            }
        });
    };

    // Auto-clear old caches on load (if version bumped without SW update)
    if (!navigator.serviceWorker.controller) {
        caches.keys().then(function (keys) {
            if (keys.length > 0) {
                return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }
        });
    }
})();
