(function () {
    const SESSION_KEY = "authSession";
    const LOGGED_IN_USER_KEY = "loggedInUser";
    const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
    let expirationTimer = null;

    function getStorage() {
        try {
            const probeKey = "__auth_storage_probe__";
            localStorage.setItem(probeKey, "1");
            localStorage.removeItem(probeKey);
            return localStorage;
        } catch (error) {
            try {
                const probeKey = "__auth_storage_probe__";
                sessionStorage.setItem(probeKey, "1");
                sessionStorage.removeItem(probeKey);
                return sessionStorage;
            } catch (sessionError) {
                return null;
            }
        }
    }

    function removeStoredSession() {
        window.firebaseAuthSession?.signOut();
        [localStorage, sessionStorage].forEach(storage => {
            try {
                storage.removeItem(SESSION_KEY);
                storage.removeItem(LOGGED_IN_USER_KEY);
            } catch (error) {
                // Storage may be unavailable in restricted browsing modes.
            }
        });
    }

    function getSession() {
        const storage = getStorage();
        if (!storage) return null;

        let session;
        try {
            session = JSON.parse(storage.getItem(SESSION_KEY) || "null");
        } catch (error) {
            session = null;
        }

        if (!session) {
            const legacyUsername = storage.getItem(LOGGED_IN_USER_KEY);
            if (legacyUsername) {
                return setSession(legacyUsername);
            }
        }

        if (!session || !session.username || !Number.isFinite(session.expiresAt) || Date.now() >= session.expiresAt) {
            removeStoredSession();
            return null;
        }

        if (!expirationTimer) {
            expirationTimer = window.setTimeout(() => {
                expirationTimer = null;
                removeStoredSession();
                if (!isLoginPage) window.location.replace("index.html");
            }, session.expiresAt - Date.now());
        }
        return session;
    }

    function setSession(username) {
        const now = Date.now();
        const session = {
            username: String(username),
            loginAt: now,
            expiresAt: now + SESSION_DURATION_MS
        };
        const storage = getStorage();
        if (!storage) return session;

        try {
            storage.setItem(SESSION_KEY, JSON.stringify(session));
            storage.setItem(LOGGED_IN_USER_KEY, session.username);
            const storedSession = JSON.parse(storage.getItem(SESSION_KEY) || "null");
            if (!storedSession || storedSession.username !== session.username) return null;
        } catch (error) {
            return null;
        }
        return session;
    }

    function logout() {
        if (expirationTimer) {
            window.clearTimeout(expirationTimer);
            expirationTimer = null;
        }
        removeStoredSession();
    }

    function requireSession() {
        if (!getSession()) {
            window.location.replace("index.html");
            return null;
        }
        return getSession();
    }

    window.authSession = { get: getSession, set: setSession, logout, require: requireSession };

    const isLoginPage = /(^|\/)index\.html$/.test(window.location.pathname) || window.location.pathname.endsWith("/");
    if (isLoginPage) {
        if (getSession()) window.location.replace("inventory.html");
    } else {
        requireSession();
    }
})();