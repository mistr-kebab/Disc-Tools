(function () {
    'use strict';

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var style = document.createElement('style');
    style.textContent = '.nav-user-dropdown a:hover,.nav-user-dropdown button:hover{background:rgba(255,255,255,0.06)}.nav-user-trigger:hover{color:var(--blurple-soft)}';
    document.head.appendChild(style);

    fetch('/api/auth/me', { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.authenticated) return;
            var u = data.user;
            var ext = u.avatar && u.avatar.startsWith('a_') ? 'gif' : 'webp';
            var avatarURL = u.avatar
                ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.' + ext + '?size=64'
                : '/static/assets/img/logo.png';

            var html = '<div class="nav-user-wrap" style="position:relative;display:inline-flex">' +
                '<button class="nav-user-trigger" style="display:inline-flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;color:var(--text);font-family:inherit;padding:0">' +
                '<img src="' + avatarURL + '" alt="" width="32" height="32" style="border-radius:50%;object-fit:cover">' +
                '<span style="font-weight:600;font-size:15px">' + esc(u.username) + '</span>' +
                '</button>' +
                '<div class="nav-user-dropdown" hidden style="position:absolute;top:100%;right:0;margin-top:8px;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:6px;z-index:300;box-shadow:0 12px 32px rgba(3,6,12,0.55)">' +
                '<a href="/profile/" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--text);text-decoration:none;font-size:15px;font-weight:600;transition:background 0.15s">' +
                '<i class="fa-solid fa-user" style="width:16px;text-align:center"></i> Profile</a>' +
                '<button class="nav-logout-btn" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:none;border-radius:8px;background:none;color:#f04747;font-family:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:background 0.15s">' +
                '<i class="fa-solid fa-right-from-bracket" style="width:16px;text-align:center"></i> Logout</button>' +
                '</div></div>';

            var desktopLogin = document.querySelector('.nav-actions a[href*="/api/auth/login"]');
            if (desktopLogin) desktopLogin.outerHTML = html;
            else document.querySelector('.nav-actions').insertAdjacentHTML('afterbegin', html);

            var mobileLogin = document.querySelector('.mobile-menu a[href*="/api/auth/login"]');
            if (mobileLogin) {
                mobileLogin.outerHTML = '<a href="/profile/" style="display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 4px;border-bottom:1px solid var(--border);color:var(--text);font-size:18px;font-weight:600;text-decoration:none">' +
                    '<img src="' + avatarURL + '" alt="" width="28" height="28" style="border-radius:50%;object-fit:cover">' +
                    esc(u.username) + '</a>';
            }

            var trigger = document.querySelector('.nav-user-trigger');
            var dropdown = document.querySelector('.nav-user-dropdown');
            if (trigger && dropdown) {
                trigger.addEventListener('click', function (e) {
                    e.stopPropagation();
                    dropdown.hidden = !dropdown.hidden;
                });
                document.addEventListener('click', function () {
                    dropdown.hidden = true;
                });
            }

            var logoutBtn = document.querySelector('.nav-logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', function () {
                    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
                        .then(function () { window.location.href = '/success/logout/'; })
                        .catch(function () { window.location.href = '/success/logout/'; });
                });
            }
        })
        .catch(function () {});
})();
