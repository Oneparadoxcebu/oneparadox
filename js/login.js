function getLocation(callback) {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(callback, showError);
    } else {
        console.log("Geolocation is not supported by this browser.");
    }
}

function showPosition(position) {
    document.getElementById("HiddenCoordinates").value = position.coords.latitude + "," + position.coords.longitude;
    //alert(document.getElementById("HiddenCoordinates").value);
    //alert("Latitude: " + position.coords.latitude + "\nLongitude: " + position.coords.longitude);
}

function showError(error) {
    switch (error.code) {
        case error.PERMISSION_DENIED:
            //alert("User denied the request for Geolocation.");
            break;
        case error.POSITION_UNAVAILABLE:
            //alert("Location information is unavailable.");
            break;
        case error.TIMEOUT:
            //alert("The request to get user location timed out.");
            break;
        case error.UNKNOWN_ERROR:
            //alert("An unknown error occurred.");
            break;
    }
}

// Remove the old DOMContentLoaded getLocation call
// document.addEventListener("DOMContentLoaded", getLocation);

document.addEventListener("DOMContentLoaded", function () {
    getLocation(showPosition);
});

function readStoredValue(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        try {
            return sessionStorage.getItem(key);
        } catch (sessionError) {
            return null;
        }
    }
}

function writeStoredValue(key, value) {
    try {
        localStorage.setItem(key, value);
        return;
    } catch (error) {
        try {
            sessionStorage.setItem(key, value);
        } catch (sessionError) {
            // Ignore storage errors in restricted/private browsing modes.
        }
    }
}

function storeLoginSession(username) {
    if (window.authSession) {
        return Boolean(window.authSession.set(username));
    }
    writeStoredValue("loggedInUser", username);
    return true;
}

function getInventoryRedirect(account) {
    if (account && (account.role === "Station" || (Array.isArray(account.inventoryAccess) && account.inventoryAccess.length === 1 && account.inventoryAccess[0] === "Requests"))) {
        return "requests.html";
    }
    const inventoryAccess = Array.isArray(account && account.inventoryAccess)
        ? account.inventoryAccess.map(value => String(value).trim().toLowerCase())
        : [];
    const office = inventoryAccess.includes("rizal")
        ? "Rizal"
        : inventoryAccess.includes("cebu")
            ? "Cebu"
            : inventoryAccess.includes("thermal")
                ? "Thermal"
                : account && typeof account.office === "string" && ["rizal", "cebu", "thermal"].includes(account.office.trim().toLowerCase())
                    ? account.office.trim().replace(/^./, character => character.toUpperCase())
                    : null;

    return office ? `inventory.html?office=${encodeURIComponent(office)}` : "inventory.html";
}

const REMOVED_TEST_ACCOUNTS = new Set(["testuser", "demo", "testceb", "testrizal"]);

const DEFAULT_ACCOUNT_SEED = {
    admin: {
        name: "System Administrator",
        username: "admin",
        email: "admin@system.com",
        password: "pbkdf2$120000$2XNgwntuJZcWoUj3o9W8cg$BWEuKPwR2cCnoXY-2bQ3TgNp3_OvNL_8yZEnvS55Hbc",
        role: "Developer",
        permissions: ["inventory"],
        office: "",
        inventoryAccess: ["Rizal", "Cebu", "Thermal"],
        disabled: false
    },
};

function ensureDefaultAdminAccount() {
    const storedAccounts = JSON.parse(readStoredValue("userAccounts") || "{}") || {};
    const accounts = Object.fromEntries(Object.entries({ ...DEFAULT_ACCOUNT_SEED, ...storedAccounts })
        .filter(([username, account]) => !REMOVED_TEST_ACCOUNTS.has(String(username).toLowerCase()) && !REMOVED_TEST_ACCOUNTS.has(String(account?.username || "").toLowerCase())));

    writeStoredValue("userAccounts", JSON.stringify(accounts));

    return accounts;
}

function isLocalBackendHost() {
    const hostname = window.location.hostname || "";
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function getBackendApiUrl(pathname = '/api/login') {
    const hostname = window.location.hostname || '';

    if (!isLocalBackendHost()) {
        return null;
    }

    const protocol = window.location.protocol || 'http:';
    const host = window.location.hostname || 'localhost';
    const backendOrigin = `${protocol}//${host}:3100`;

    return `${backendOrigin}${pathname}`;
}

async function loadStaticAccountSeed() {
    try {
        const response = await fetch('data/accounts.json', { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }

        const accounts = await response.json();
        return accounts && typeof accounts === 'object' ? accounts : null;
    } catch (error) {
        console.warn('Static account seed unavailable.', error);
        return null;
    }
}

async function loadSharedAccountSeed() {
    if (!window.sharedAccounts) return null;

    try {
        const accounts = await window.sharedAccounts.load();
        return accounts && typeof accounts === "object" ? accounts : null;
    } catch (error) {
        console.warn("Shared account store unavailable.", error);
        return null;
    }
}

async function login() {
    // Check for test credentials (development mode)
    const inputValue = document.getElementById("UsernameInput").value.trim();
    const password = document.getElementById("PasswordInput").value.trim();
    const messageDiv = document.getElementById("divMessage");
    let accounts = ensureDefaultAdminAccount();
    const backendUrl = getBackendApiUrl('/api/login');

    if (!inputValue || !password) {
        messageDiv.textContent = "✗ Please enter both username and password";
        messageDiv.style.color = "red";
        return;
    }

    if (!isLocalBackendHost()) {
        try {
            if (!window.firebaseAuthSession) throw new Error("Firebase authentication is unavailable. Please refresh and try again.");
            const result = await window.firebaseAuthSession.signIn(inputValue, password);
            storeLoginSession(result.account.username);
            writeStoredValue("userAccounts", JSON.stringify(result.accounts || { [result.account.username]: result.account }));
            messageDiv.textContent = "✓ Login successful!";
            messageDiv.style.color = "green";
            window.setTimeout(() => {
                window.location.href = getInventoryRedirect(result.account);
            }, 300);
            return;
        } catch (error) {
            console.error("Firebase sign-in failed.", error);
            messageDiv.textContent = `✗ ${error.message || "Sign-in failed. Please check your credentials and try again."}`;
            messageDiv.style.color = "red";
            return;
        }
    }

    let backendMessage = null;

    if (backendUrl) {
        try {
            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    usernameOrEmail: inputValue,
                    password: password
                })
            });

            const result = await response.json();

            if (result.ok) {
                messageDiv.textContent = "✓ Login successful!";
                messageDiv.style.color = "green";

                storeLoginSession(result.account.username);
                writeStoredValue("userAccounts", JSON.stringify(result.accounts || {}));

                setTimeout(function() {
                    window.location.href = getInventoryRedirect(result.account);
                }, 500);

                console.log("Stored backend account login: " + result.account.username);
                return;
            }

            backendMessage = result.message || "Invalid credentials";
        } catch (error) {
            console.warn("Backend login unavailable, falling back to local login flow.", error);
        }
    }

    const staticAccounts = await loadStaticAccountSeed();
    if (staticAccounts) {
        const storedAccounts = JSON.parse(readStoredValue("userAccounts") || "{}") || {};
        accounts = { ...staticAccounts, ...storedAccounts };
        writeStoredValue("userAccounts", JSON.stringify(accounts));
    }

    const sharedAccounts = await loadSharedAccountSeed();
    if (sharedAccounts) {
        const storedAccounts = JSON.parse(readStoredValue("userAccounts") || "{}") || {};
        accounts = { ...accounts, ...storedAccounts, ...sharedAccounts };
        writeStoredValue("userAccounts", JSON.stringify(accounts));
    }

    let sqliteResult = { status: "fallback" };

    if (window.trySqliteLogin) {
        try {
            sqliteResult = await window.trySqliteLogin(inputValue, password);
        } catch (error) {
            console.warn("SQLite login failover triggered.", error);
        }
    }

    if (sqliteResult.status === "success") {
        messageDiv.textContent = "✓ Login successful!";
        messageDiv.style.color = "green";

        storeLoginSession(sqliteResult.account.username);

        setTimeout(function() {
            const account = accounts[sqliteResult.account.username] || sqliteResult.account;
            window.location.href = getInventoryRedirect(account);
        }, 500);

        console.log("Stored SQLite account login: " + sqliteResult.account.username);
        return;
    }

    if (sqliteResult.status === "disabled") {
        messageDiv.textContent = "✗ This account has been disabled by an administrator.";
        messageDiv.style.color = "red";
        return;
    }

    const normalizedInput = inputValue.toLowerCase();
    let matchedUsername = null;
    let storedAccount = null;

    const usernameMatch = Object.keys(accounts).find(usernameKey => usernameKey.toLowerCase() === normalizedInput);
    if (usernameMatch) {
        matchedUsername = usernameMatch;
        storedAccount = accounts[usernameMatch];
    } else {
        const emailMatch = Object.keys(accounts).find(usernameKey => {
            const account = accounts[usernameKey];
            return account && typeof account.email === 'string' && account.email.toLowerCase() === normalizedInput;
        });

        if (emailMatch) {
            matchedUsername = emailMatch;
            storedAccount = accounts[emailMatch];
        }
    }

    if (storedAccount && storedAccount.disabled) {
        messageDiv.textContent = "✗ This account has been disabled by an administrator.";
        messageDiv.style.color = "red";
        return;
    }

    const storedPasswordMatches = storedAccount && window.passwordSecurity
        ? await window.passwordSecurity.verify(password, storedAccount.password)
        : storedAccount && storedAccount.password === password;

    if (storedAccount && storedPasswordMatches) {
        messageDiv.textContent = "✓ Login successful!";
        messageDiv.style.color = "green";

        storeLoginSession(matchedUsername);

        setTimeout(function() {
            window.location.href = getInventoryRedirect(storedAccount);
        }, 500);

        console.log("Stored account login: " + matchedUsername);
        return;
    }

    messageDiv.textContent = backendMessage ? `✗ ${backendMessage}` : "✗ Invalid credentials";
    messageDiv.style.color = "red";
}

document.addEventListener("DOMContentLoaded", function () {
    getLocation(showPosition);

    const form = document.getElementById("form1");
    const pwd = document.getElementById("PasswordInput");
    const icon = document.getElementById("togglePasswordIcon");

    if (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            login();
        });
    }

    if (icon && pwd) {
        icon.addEventListener("click", function () {
            if (pwd.type === "password") {
                pwd.type = "text";
                window.setLucideIcon?.(icon, "eye-off");
            } else {
                pwd.type = "password";
                window.setLucideIcon?.(icon, "eye");
            }
        });
    }
});
