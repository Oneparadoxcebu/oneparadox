(function () {
    "use strict";

    if (!window.firebaseAuth || !window.firebaseProfiles) {
        throw new Error("Firebase Authentication is not initialized.");
    }

    const isLoginPage = /(^|\/)index\.html$/.test(window.location.pathname) || window.location.pathname.endsWith("/");
    if (!isLoginPage) {
        const authGateStyle = document.createElement("style");
        authGateStyle.textContent = "html:not(.auth-ready) body { visibility: hidden; }";
        document.head.append(authGateStyle);
    }
    let currentUser = null;
    let currentProfile = null;
    let profileUnsubscribe = null;
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });

    function clearLegacyCredentials() {
        try {
            localStorage.removeItem("loggedInUser");
            localStorage.removeItem("userAccounts");
            localStorage.removeItem("sqliteLoginDatabase");
        } catch (error) {
            console.warn("Legacy browser login data could not be cleared.", error);
        }
        try {
            sessionStorage.removeItem("loggedInUser");
            sessionStorage.removeItem("userAccounts");
        } catch (error) {
            console.warn("Legacy session login data could not be cleared.", error);
        }
    }

    function showLoginError(message) {
        const messageElement = document.getElementById("divMessage");
        if (messageElement) {
            messageElement.textContent = message;
            messageElement.style.color = "red";
        }
    }

    function getLandingPage(profile) {
        if (["Developer", "IT Admin", "IT Manager", "IT Support", "Management", "Accounting", "HR"].includes(profile.role)) {
            return "inventory.html?office=Cebu";
        }
        const inventoryAccess = Array.isArray(profile.inventoryAccess) ? profile.inventoryAccess : [];
        if (Array.isArray(profile.permissions) && profile.permissions.includes("inventory") && inventoryAccess.length) {
            return `inventory.html?office=${encodeURIComponent(inventoryAccess[0])}`;
        }
        if (Array.isArray(profile.permissions) && profile.permissions.includes("dashboard")) return "dashboard.html";
        return "requests.html";
    }

    clearLegacyCredentials();

    window.authSession = {
        ready,
        get: () => currentProfile,
        getUser: () => currentUser,
        set: () => false,
        async require() {
            await ready;
            if (!currentUser || !currentProfile) {
                window.location.replace("index.html");
                return null;
            }
            return currentProfile;
        },
        async logout() {
            clearLegacyCredentials();
            currentProfile = null;
            currentUser = null;
            await window.firebaseAuth.signOut();
        }
    };

    window.firebaseAuth.onAuthStateChanged(async user => {
        if (profileUnsubscribe) {
            profileUnsubscribe();
            profileUnsubscribe = null;
        }
        currentUser = user;
        currentProfile = null;

        if (user) {
            try {
                currentProfile = await window.firebaseProfiles.get(user.uid);
            } catch (error) {
                console.error("Unable to load the signed-in user's Firestore profile.", error);
                showLoginError("Your profile could not be loaded. Verify Firestore setup and security rules.");
            }

            if (!currentProfile || currentProfile.disabled) {
                await window.firebaseAuth.signOut();
                currentUser = null;
                currentProfile = null;
                clearLegacyCredentials();
                if (!isLoginPage) window.location.replace("index.html?auth=profile");
                else if (!document.getElementById("divMessage")?.textContent) {
                    showLoginError("This account is not enabled for the app. Contact your administrator.");
                }
            } else {
                profileUnsubscribe = window.firebaseDb.collection("users").doc(user.uid).onSnapshot(snapshot => {
                    const updatedProfile = snapshot.exists
                        ? { uid: snapshot.id, ...snapshot.data() }
                        : null;
                    if (!updatedProfile || updatedProfile.disabled) {
                        void window.firebaseAuth.signOut();
                        if (!isLoginPage) window.location.replace("index.html?auth=profile");
                        return;
                    }
                    currentProfile = updatedProfile;
                    try {
                        localStorage.setItem("loggedInUser", updatedProfile.username);
                        localStorage.setItem("userAccounts", JSON.stringify({ [updatedProfile.username]: updatedProfile }));
                    } catch (error) {
                        console.warn("The updated account profile could not be cached.", error);
                    }
                }, error => {
                    console.error("The signed-in user's Firestore profile listener failed.", error);
                    if (error.code === "permission-denied") {
                        void window.firebaseAuth.signOut();
                        if (!isLoginPage) window.location.replace("index.html?auth=profile");
                    }
                });
                try {
                    localStorage.setItem("loggedInUser", currentProfile.username);
                    localStorage.setItem("userAccounts", JSON.stringify({ [currentProfile.username]: currentProfile }));
                } catch (error) {
                    console.warn("The account profile could not be cached in browser storage.", error);
                }
                if (isLoginPage) window.location.replace(getLandingPage(currentProfile));
            }
        } else {
            clearLegacyCredentials();
            if (!isLoginPage) window.location.replace("index.html");
        }

        document.documentElement.classList.add("auth-ready");
        readyResolve(currentProfile);
    });
})();
