(function () {
    const firebaseConfig = Object.freeze({
        apiKey: "AIzaSyAwN4KgKfGTRiDqiSqPaSeeyDda_4qmEmo",
        authDomain: "oneparadox-c5c48.firebaseapp.com",
        storageBucket: "oneparadox-c5c48.firebasestorage.app",
        messagingSenderId: "1011766262049",
        appId: "1:1011766262049:web:6c2641612938379dab2660",
        measurementId: "G-P1FSYLFE5Z",
        functionsRegion: "us-central1",
        projectId: "oneparadox-c5c48"
    });
    window.firebaseProjectConfig = firebaseConfig;
    const functionsBase = `https://${firebaseConfig.functionsRegion}-${firebaseConfig.projectId}.cloudfunctions.net/api`;
    const tokenStorageKey = "firebaseAuthTokens";
    const identityToolkitBase = "https://identitytoolkit.googleapis.com/v1";
    const secureTokenBase = "https://securetoken.googleapis.com/v1";

    async function fetchFunctions(path, options) {
        try {
            return await fetch(`${functionsBase}${path}`, options);
        } catch (error) {
            console.error(`Firebase Functions request failed for ${path}.`, error);
            throw new Error(
                `The Firebase backend at ${functionsBase} did not return a browser-accessible response. The configured endpoint currently returns 404, which usually means the "api" Cloud Function is not deployed to project ${firebaseConfig.projectId} in ${firebaseConfig.functionsRegion}. Check the "Deploy Firebase backend" GitHub Actions run and ensure FIREBASE_SERVICE_ACCOUNT is configured.`
            );
        }
    }

    function readTokens() {
        try {
            return JSON.parse(sessionStorage.getItem(tokenStorageKey) || "null");
        } catch (error) {
            console.warn("Firebase authentication session could not be read.", error);
            return null;
        }
    }

    function writeTokens(tokens) {
        sessionStorage.setItem(tokenStorageKey, JSON.stringify(tokens));
    }

    async function parseResponse(response, action) {
        const responseText = await response.text();
        let result = {};
        if (responseText) {
            try {
                result = JSON.parse(responseText);
            } catch (error) {
                result = {};
            }
        }
        if (!response.ok) {
            const message = result.error?.message || result.message || responseText || `${action} failed (${response.status}).`;
            throw new Error(message);
        }
        return result;
    }

    async function exchangeCustomToken(customToken) {
        const response = await fetch(`${identityToolkitBase}/accounts:signInWithCustomToken?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        });
        const result = await parseResponse(response, "Firebase sign-in");
        const expiresIn = Number(result.expiresIn);
        if (!result.idToken || !result.refreshToken || !Number.isFinite(expiresIn)) {
            throw new Error("Firebase returned an incomplete authentication session.");
        }
        writeTokens({
            idToken: result.idToken,
            refreshToken: result.refreshToken,
            expiresAt: Date.now() + expiresIn * 1000
        });
        return result.idToken;
    }

    async function refreshIdToken(tokens) {
        const response = await fetch(`${secureTokenBase}/token?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken })
        });
        const result = await parseResponse(response, "Firebase token refresh");
        const expiresIn = Number(result.expires_in);
        if (!result.id_token || !result.refresh_token || !Number.isFinite(expiresIn)) {
            throw new Error("Firebase returned an incomplete refreshed session.");
        }
        writeTokens({
            idToken: result.id_token,
            refreshToken: result.refresh_token,
            expiresAt: Date.now() + expiresIn * 1000
        });
        return result.id_token;
    }

    async function getIdToken() {
        const tokens = readTokens();
        if (!tokens?.refreshToken) return null;
        if (tokens.idToken && tokens.expiresAt > Date.now() + 60_000) return tokens.idToken;
        return refreshIdToken(tokens);
    }

    async function api(path, options = {}) {
        const idToken = await getIdToken();
        if (!idToken) throw new Error("Sign in with your Firebase account to continue.");
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${idToken}`);
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

        const response = await fetchFunctions(path, { ...options, headers });
        return parseResponse(response, "Firebase service request");
    }

    async function signIn(usernameOrEmail, password) {
        const response = await fetchFunctions("/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernameOrEmail, password })
        });
        const result = await parseResponse(response, "Sign-in");
        if (!result.customToken || !result.account) {
            throw new Error("The sign-in service returned an incomplete account.");
        }
        await exchangeCustomToken(result.customToken);
        return result;
    }

    function signOut() {
        sessionStorage.removeItem(tokenStorageKey);
    }

    window.firebaseAuthSession = { api, getIdToken, signIn, signOut, config: firebaseConfig };
})();
