(function () {
    const THEME_KEY = "theme";
    const VALID_THEMES = new Set(["light", "dark"]);
    const readStoredUser = () => localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser") || "";

    function readAccounts() {
        try {
            return JSON.parse(localStorage.getItem("userAccounts") || "{}") || {};
        } catch (error) {
            return {};
        }
    }

    function getAccount(accounts, username) {
        return accounts[username] || Object.values(accounts).find(account =>
            String(account?.username || "").toLowerCase() === String(username).toLowerCase()
        );
    }

    const username = readStoredUser();
    let accounts = readAccounts();
    let account = getAccount(accounts, username);
    const storedTheme = localStorage.getItem(THEME_KEY);
    const initialTheme = VALID_THEMES.has(storedTheme)
        ? storedTheme
        : (VALID_THEMES.has(account?.theme) ? account.theme : "light");

    function applyTheme(theme) {
        const normalizedTheme = VALID_THEMES.has(theme) ? theme : "light";
        document.documentElement.setAttribute("data-bs-theme", normalizedTheme);

        const toggle = document.getElementById("themeToggleBtn");
        if (toggle) {
            toggle.checked = normalizedTheme === "dark";
            toggle.setAttribute("aria-checked", String(toggle.checked));
        }
    }

    function persistTheme(theme) {
        localStorage.setItem(THEME_KEY, theme);
        if (!username) return;

        accounts = readAccounts();
        account = getAccount(accounts, username);
        if (account) {
            account.theme = theme;
            const accountKey = Object.keys(accounts).find(key => accounts[key] === account) || username;
            accounts[accountKey] = account;
            localStorage.setItem("userAccounts", JSON.stringify(accounts));
        }

        if (window.sharedAccounts?.saveTheme) {
            window.sharedAccounts.saveTheme(username, theme).catch(error => {
                console.warn("Account theme preference could not be synced.", error);
            });
        }
    }

    applyTheme(initialTheme);

    document.addEventListener("DOMContentLoaded", () => {
        applyTheme(document.documentElement.getAttribute("data-bs-theme") || initialTheme);
        const toggle = document.getElementById("themeToggleBtn");
        if (toggle) {
            toggle.addEventListener("change", () => {
                const theme = toggle.checked ? "dark" : "light";
                applyTheme(theme);
                persistTheme(theme);
            });
        }

        if (username && !VALID_THEMES.has(storedTheme) && !VALID_THEMES.has(account?.theme) && window.sharedAccounts?.load) {
            window.sharedAccounts.load().then(sharedAccounts => {
                const sharedAccount = getAccount(sharedAccounts || {}, username);
                if (!VALID_THEMES.has(sharedAccount?.theme)) return;

                accounts = readAccounts();
                account = getAccount(accounts, username);
                if (account && !VALID_THEMES.has(account.theme)) {
                    account.theme = sharedAccount.theme;
                    const accountKey = Object.keys(accounts).find(key => accounts[key] === account) || username;
                    accounts[accountKey] = account;
                    localStorage.setItem("userAccounts", JSON.stringify(accounts));
                    applyTheme(sharedAccount.theme);
                }
            }).catch(error => console.warn("Account theme preference could not be loaded.", error));
        }
    });

    window.addEventListener("storage", event => {
        if (event.key === THEME_KEY && VALID_THEMES.has(event.newValue)) {
            applyTheme(event.newValue);
        }
    });
})();