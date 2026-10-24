const crypto = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const {
    getClaims,
    hashPassword,
    normalizeManagedAccount,
    publicAccount,
    validateRequestInput,
    verifyPassword
} = require("./domain");

initializeApp();

const auth = getAuth();
const db = getFirestore();
const requestsCollection = db.collection("workspaceRequests");
const accountsCollection = db.collection("accounts");

function sendJson(response, status, payload) {
    response.status(status).set("Cache-Control", "no-store").json(payload);
}

async function findAccount(usernameOrEmail) {
    const directMatch = await accountsCollection.doc(usernameOrEmail).get();
    if (directMatch.exists) return { id: directMatch.id, data: directMatch.data() };

    const emailMatch = await accountsCollection.where("email", "==", usernameOrEmail).limit(1).get();
    if (emailMatch.empty) return null;
    return { id: emailMatch.docs[0].id, data: emailMatch.docs[0].data() };
}

function requireAccountManager(claims) {
    if (claims.role !== "Developer" && !claims.permissions.includes("users")) {
        const error = new Error("User management access is required.");
        error.status = 403;
        throw error;
    }
}

function canManageRequests(claims) {
    return claims.role === "Developer" ||
        (claims.permissions.includes("inventory") && claims.inventoryAccess.includes("Thermal"));
}

function canSubmitRequests(claims) {
    return claims.role === "Developer" || claims.inventoryAccess.includes("Requests");
}

async function authenticate(request) {
    const authorization = request.get("Authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw Object.assign(new Error("Sign in is required."), { status: 401 });
    const claims = await auth.verifyIdToken(token);
    if (typeof claims.username === "string") return claims;

    const profile = await db.collection("users").doc(claims.uid).get();
    if (!profile.exists || profile.data().disabled) {
        throw Object.assign(new Error("An enabled app account is required."), { status: 403 });
    }
    const account = profile.data();
    return {
        ...claims,
        username: account.username,
        name: account.name || account.username,
        role: account.role || "Management",
        permissions: Array.isArray(account.permissions) ? account.permissions : [],
        inventoryAccess: Array.isArray(account.inventoryAccess) ? account.inventoryAccess : [],
        office: account.office || ""
    };
}

async function handleLogin(request, response) {
    if (request.method !== "POST") return sendJson(response, 405, { message: "Method not allowed." });
    const usernameOrEmail = String(request.body?.usernameOrEmail || "").trim();
    const password = String(request.body?.password || "");
    if (!usernameOrEmail || !password) return sendJson(response, 400, { message: "Enter your username or email and password." });

    const match = await findAccount(usernameOrEmail);
    if (!match || !verifyPassword(password, match.data.password)) {
        return sendJson(response, 401, { message: "Invalid credentials." });
    }

    const account = { ...match.data, username: match.data.username || match.id };
    if (account.disabled) return sendJson(response, 403, { message: "This account has been disabled." });
    if (!String(account.password || "").startsWith("pbkdf2$")) {
        account.password = hashPassword(password);
        await accountsCollection.doc(match.id).update({ password: account.password });
    }
    const claims = getClaims(account);
    const uid = `acct_${crypto.createHash("sha256").update(account.username).digest("hex").slice(0, 60)}`;
    const customToken = await auth.createCustomToken(uid, claims);
    const result = { customToken, account: publicAccount(account) };

    if (claims.role === "Developer") {
        const accountDocuments = await accountsCollection.get();
        result.accounts = Object.fromEntries(accountDocuments.docs.map(document => {
            const data = document.data();
            const username = data.username || document.id;
            return [username, publicAccount({ ...data, username })];
        }));
    }

    return sendJson(response, 200, result);
}

async function handleAccounts(request, response, claims, pathSegments) {
    requireAccountManager(claims);
    if (request.method === "GET" && pathSegments.length === 1) {
        const accountDocuments = await accountsCollection.get();
        const accounts = Object.fromEntries(accountDocuments.docs.map(document => {
            const data = document.data();
            const username = data.username || document.id;
            return [username, publicAccount({ ...data, username })];
        }));
        return sendJson(response, 200, { accounts });
    }

    if (request.method === "PUT" && pathSegments.length === 1) {
        const accounts = request.body?.accounts;
        const deleteUsernames = Array.isArray(request.body?.deleteUsernames) ? request.body.deleteUsernames : [];
        if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
            return sendJson(response, 400, { message: "An account map is required." });
        }
        const entries = Object.entries(accounts);
        for (let index = 0; index < entries.length; index += 400) {
            const batch = db.batch();
            entries.slice(index, index + 400).forEach(([username, input]) => {
                const account = normalizeManagedAccount(input, username, claims);
                const existing = accountsCollection.doc(username);
                const accountData = { ...account };
                if (!accountData.password) {
                    delete accountData.password;
                } else if (!accountData.password.startsWith("pbkdf2$")) {
                    accountData.password = hashPassword(accountData.password);
                }
                batch.set(existing, accountData, { merge: true });
            });
            await batch.commit();
        }
        for (let index = 0; index < deleteUsernames.length; index += 400) {
            if (claims.role !== "Developer") {
                const targets = await Promise.all(deleteUsernames.slice(index, index + 400).map(username =>
                    accountsCollection.doc(String(username)).get()
                ));
                if (targets.some(snapshot => snapshot.exists &&
                    (snapshot.data().role === "Developer" ||
                        (snapshot.data().permissions || []).some(permission => !claims.permissions.includes(permission)) ||
                        (snapshot.data().inventoryAccess || []).some(office => !claims.inventoryAccess.includes(office))))) {
                    return sendJson(response, 403, { message: "You cannot delete an account with access you do not manage." });
                }
            }
            const batch = db.batch();
            deleteUsernames.slice(index, index + 400).forEach(username => {
                batch.delete(accountsCollection.doc(String(username)));
            });
            await batch.commit();
        }
        const accountDocuments = await accountsCollection.get();
        const safeAccounts = Object.fromEntries(accountDocuments.docs.map(document => {
            const data = document.data();
            const username = data.username || document.id;
            return [username, publicAccount({ ...data, username })];
        }));
        return sendJson(response, 200, { accounts: safeAccounts });
    }

    if (pathSegments.length === 2) {
        const oldUsername = pathSegments[1];
        if (request.method === "POST") {
            const input = request.body?.account;
            if (!input || typeof input !== "object" || !input.username || !input.email) {
                return sendJson(response, 400, { message: "Account details are incomplete." });
            }
            const username = String(input.username).trim();
            if (!username || username.includes("/") || username.length > 128) {
                return sendJson(response, 400, { message: "Enter a valid username." });
            }
            if (username !== oldUsername && (await accountsCollection.doc(username).get()).exists) {
                return sendJson(response, 409, { message: "Username already exists." });
            }
            const oldAccountSnapshot = await accountsCollection.doc(oldUsername).get();
            if (!oldAccountSnapshot.exists && username !== oldUsername) {
                return sendJson(response, 404, { message: "Account not found." });
            }
            const account = normalizeManagedAccount(input, username, claims);
            if (!account.password && oldAccountSnapshot.exists) account.password = oldAccountSnapshot.data().password;
            if (!account.password) return sendJson(response, 400, { message: "A password is required for a new account." });
            if (!String(account.password).startsWith("pbkdf2$")) account.password = hashPassword(String(account.password));
            const batch = db.batch();
            batch.set(accountsCollection.doc(username), account);
            if (username !== oldUsername) batch.delete(accountsCollection.doc(oldUsername));
            await batch.commit();
            return sendJson(response, 200, { account: publicAccount(account) });
        }
        if (request.method === "DELETE") {
            const target = await accountsCollection.doc(oldUsername).get();
            if (target.exists && claims.role !== "Developer" &&
                (target.data().role === "Developer" ||
                    (target.data().permissions || []).some(permission => !claims.permissions.includes(permission)) ||
                    (target.data().inventoryAccess || []).some(office => !claims.inventoryAccess.includes(office)))) {
                return sendJson(response, 403, { message: "You cannot delete an account with access you do not manage." });
            }
            await accountsCollection.doc(oldUsername).delete();
            return sendJson(response, 200, { ok: true });
        }
    }

    if (pathSegments.length === 3 && pathSegments[2] === "theme" && request.method === "PATCH") {
        const snapshot = await accountsCollection.doc(pathSegments[1]).get();
        if (!snapshot.exists) return sendJson(response, 404, { message: "Account not found." });
        const theme = String(request.body?.theme || "");
        if (!["light", "dark", "system"].includes(theme)) {
            return sendJson(response, 400, { message: "Choose a valid theme." });
        }
        await snapshot.ref.update({ theme });
        return sendJson(response, 200, { ok: true });
    }

    return sendJson(response, 405, { message: "Unsupported account operation." });
}

async function handleRequests(request, response, claims, uid, pathSegments) {
    if (pathSegments.length === 1 && request.method === "GET") {
        if (!canSubmitRequests(claims) && !canManageRequests(claims)) {
            return sendJson(response, 403, { message: "Requests access is required." });
        }
        const snapshot = await requestsCollection.orderBy("createdAt", "desc").limit(1000).get();
        const requests = snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
        const visibleRequests = canManageRequests(claims)
            ? requests
            : requests.filter(item => item.createdByUid === uid);
        return sendJson(response, 200, { requests: visibleRequests });
    }

    if (pathSegments.length === 1 && request.method === "POST") {
        if (!canSubmitRequests(claims)) return sendJson(response, 403, { message: "Requests access is required." });
        const fields = validateRequestInput(request.body || {});
        const reference = requestsCollection.doc();
        const account = await accountsCollection.doc(claims.username).get();
        const accountData = account.exists ? account.data() : {};
        const record = {
            ...fields,
            id: reference.id,
            item: "Thermal Paper",
            requestedBy: claims.name || accountData.name || claims.username,
            requestedByUsername: claims.username,
            createdByUid: uid,
            status: "Pending",
            createdAt: new Date().toISOString()
        };
        await reference.create(record);
        return sendJson(response, 201, { request: record });
    }

    if (pathSegments.length === 2) {
        if (!canManageRequests(claims)) return sendJson(response, 403, { message: "Thermal Inventory access is required to manage requests." });
        const requestId = pathSegments[1];
        const reference = requestsCollection.doc(requestId);
        if (request.method === "PATCH") {
            const status = String(request.body?.status || "");
            if (!["Pending", "Approved", "Rejected"].includes(status)) {
                return sendJson(response, 400, { message: "Choose Pending, Approved, or Rejected." });
            }
            const update = { status };
            if (status === "Rejected") {
                const rejectionNote = String(request.body?.rejectionNote || "").trim();
                if (rejectionNote.length > 500) return sendJson(response, 400, { message: "Rejection note cannot exceed 500 characters." });
                update.rejectionNote = rejectionNote;
            } else {
                update.rejectionNote = "";
            }
            await reference.update(update);
            const updated = await reference.get();
            return sendJson(response, 200, { request: { id: updated.id, ...updated.data() } });
        }
        if (request.method === "DELETE") {
            await reference.delete();
            return sendJson(response, 200, { ok: true });
        }
    }

    return sendJson(response, 404, { message: "Request endpoint not found." });
}

async function handlePasswordChange(request, response, claims) {
    if (request.method !== "PATCH") return sendJson(response, 405, { message: "Method not allowed." });
    const password = String(request.body?.password || "");
    if (password.length < 6 || password.length > 256) {
        return sendJson(response, 400, { message: "Password must be between 6 and 256 characters." });
    }
    const account = await accountsCollection.doc(claims.username).get();
    if (!account.exists) return sendJson(response, 404, { message: "Account not found." });
    await account.ref.update({ password: hashPassword(password) });
    return sendJson(response, 200, { ok: true });
}

async function handleThemeChange(request, response, claims) {
    if (request.method !== "PATCH") return sendJson(response, 405, { message: "Method not allowed." });
    const theme = String(request.body?.theme || "");
    if (!["light", "dark"].includes(theme)) {
        return sendJson(response, 400, { message: "Choose a valid theme." });
    }
    const account = await accountsCollection.doc(claims.username).get();
    if (!account.exists) return sendJson(response, 404, { message: "Account not found." });
    await account.ref.update({ theme });
    return sendJson(response, 200, { ok: true });
}

exports.api = onRequest({ region: "us-central1", cors: true }, async (request, response) => {
    try {
        const segments = new URL(request.originalUrl, "https://functions.invalid").pathname.split("/").filter(Boolean).map(decodeURIComponent);
        if (segments[0] === "api") segments.shift();
        if (segments[0] === "login") return await handleLogin(request, response);

        const claims = await authenticate(request);
        const uid = claims.uid;
        if (segments[0] === "requests") return await handleRequests(request, response, claims, uid, segments);
        if (segments[0] === "accounts") return await handleAccounts(request, response, claims, segments);
        if (segments[0] === "account" && segments[1] === "password") return await handlePasswordChange(request, response, claims);
        if (segments[0] === "account" && segments[1] === "theme") return await handleThemeChange(request, response, claims);
        return sendJson(response, 404, { message: "Endpoint not found." });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        if (status >= 500) console.error("Cloud API request failed.", error);
        return sendJson(response, status, { message: status >= 500 ? "The server could not complete the request." : error.message });
    }
});
