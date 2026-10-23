(function () {
    const SQLITE_DB_KEY = "sqliteLoginDatabase";
    const DEFAULT_USERS = [
        {
            username: "admin",
            name: "System Administrator",
            email: "admin@system.com",
            password: "pbkdf2$120000$2XNgwntuJZcWoUj3o9W8cg$BWEuKPwR2cCnoXY-2bQ3TgNp3_OvNL_8yZEnvS55Hbc",
            role: "Developer",
            permissions: ["inventory"],
            disabled: false
        }
    ];

    let sqlInstance = null;

    function serializeDatabase(database) {
        const bytes = database.export();
        return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
    }

    function deserializeDatabase(serializedPayload) {
        const binary = atob(serializedPayload);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
    }

    async function getSqlInstance() {
        if (sqlInstance) {
            return sqlInstance;
        }

        if (!window.initSqlJs) {
            throw new Error("SQLite runtime is unavailable.");
        }

        sqlInstance = await window.initSqlJs({
            locateFile: function (fileName) {
                return "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/" + fileName;
            }
        });

        return sqlInstance;
    }

    function getPersistedDatabase() {
        try {
            return localStorage.getItem(SQLITE_DB_KEY);
        } catch (error) {
            try {
                return sessionStorage.getItem(SQLITE_DB_KEY);
            } catch (sessionError) {
                return null;
            }
        }
    }

    function savePersistedDatabase(database) {
        try {
            localStorage.setItem(SQLITE_DB_KEY, serializeDatabase(database));
        } catch (error) {
            try {
                sessionStorage.setItem(SQLITE_DB_KEY, serializeDatabase(database));
            } catch (sessionError) {
                console.warn("Could not persist SQLite login database.", error);
            }
        }
    }

    function syncLegacyAccounts(accounts) {
        try {
            const existingAccounts = JSON.parse(localStorage.getItem("userAccounts") || "{}");
            const legacyAccounts = existingAccounts && typeof existingAccounts === 'object' ? existingAccounts : {};

            accounts.forEach((account) => {
                legacyAccounts[account.username] = {
                    name: account.name,
                    username: account.username,
                    email: account.email,
                    password: account.password,
                    role: account.role,
                    permissions: account.permissions,
                    disabled: account.disabled
                };
            });

            try {
                localStorage.setItem("userAccounts", JSON.stringify(legacyAccounts));
            } catch (error) {
                sessionStorage.setItem("userAccounts", JSON.stringify(legacyAccounts));
            }
        } catch (error) {
            console.warn("Could not sync legacy accounts.", error);
        }
    }

    function getAccountsFromDatabase(database) {
        const rows = database.exec("SELECT username, name, email, password, role, permissions, disabled FROM users ORDER BY username");
        const accountRows = rows[0] ? rows[0].values : [];

        return accountRows.map(([username, name, email, password, role, permissions, disabled]) => ({
            username,
            name,
            email,
            password,
            role,
            permissions: permissions ? JSON.parse(permissions) : [],
            disabled: Number(disabled) === 1
        }));
    }

    function seedDatabase(database) {
        database.run(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                name TEXT,
                email TEXT,
                password TEXT,
                role TEXT,
                permissions TEXT,
                disabled INTEGER DEFAULT 0
            )
        `);

        const existingAccounts = getAccountsFromDatabase(database);
        const existingUsernames = new Set(existingAccounts.map((account) => account.username.toLowerCase()));

        DEFAULT_USERS.forEach((account) => {
            if (existingUsernames.has(account.username.toLowerCase())) {
                return;
            }

            database.run(
                "INSERT INTO users (username, name, email, password, role, permissions, disabled) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    account.username,
                    account.name,
                    account.email,
                    account.password,
                    account.role,
                    JSON.stringify(account.permissions),
                    account.disabled ? 1 : 0
                ]
            );
        });

        database.run("UPDATE users SET password = ? WHERE username = ?", ["pbkdf2$120000$2XNgwntuJZcWoUj3o9W8cg$BWEuKPwR2cCnoXY-2bQ3TgNp3_OvNL_8yZEnvS55Hbc", "admin"]);

        const finalAccounts = getAccountsFromDatabase(database);
        syncLegacyAccounts(finalAccounts);
        savePersistedDatabase(database);

        return finalAccounts;
    }

    async function ensureLoginDatabase() {
        const SQL = await getSqlInstance();
        const serializedDatabase = getPersistedDatabase();
        let database;

        if (serializedDatabase) {
            try {
                database = new SQL.Database(deserializeDatabase(serializedDatabase));
            } catch (error) {
                console.warn("SQLite login database was corrupted. Rebuilding it.", error);
                database = new SQL.Database();
            }
        } else {
            database = new SQL.Database();
        }

        return seedDatabase(database);
    }

    window.trySqliteLogin = async function (usernameOrEmail, password) {
        try {
            const accounts = await ensureLoginDatabase();
            const normalizedInput = String(usernameOrEmail || "").trim().toLowerCase();

            if (!normalizedInput) {
                return { status: "invalid" };
            }

            const matchedAccount = accounts.find((account) => {
                return account.username.toLowerCase() === normalizedInput || account.email.toLowerCase() === normalizedInput;
            });

            if (!matchedAccount) {
                return { status: "invalid" };
            }

            if (matchedAccount.disabled) {
                return { status: "disabled", account: matchedAccount };
            }

            const passwordMatches = window.passwordSecurity
                ? await window.passwordSecurity.verify(password, matchedAccount.password)
                : matchedAccount.password === password;
            if (!passwordMatches) {
                return { status: "invalid" };
            }

            return { status: "success", account: matchedAccount };
        } catch (error) {
            console.warn("SQLite login failed, falling back to the legacy login logic.", error);
            return { status: "fallback" };
        }
    };

    window.updateSqlitePassword = async function (username, newPassword) {
        const database = await ensureLoginDatabase();
        const matchedAccount = getAccountsFromDatabase(database).find(account => account.username === username);

        if (!matchedAccount) {
            return false;
        }

        database.run("UPDATE users SET password = ? WHERE username = ?", [newPassword, username]);
        savePersistedDatabase(database);
        return true;
    };
})();
