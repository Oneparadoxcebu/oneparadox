const crypto = require("node:crypto");

const allowedUnits = new Set(["Boxes", "Rolls", "Pcs"]);

function hashPassword(password) {
    const iterations = 120000;
    const salt = crypto.randomBytes(16);
    const digest = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
    return `pbkdf2$${iterations}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

function verifyPassword(password, storedPassword) {
    if (!String(storedPassword || "").startsWith("pbkdf2$")) {
        return storedPassword === password;
    }

    const [, iterationText, saltText, digestText] = storedPassword.split("$");
    const iterations = Number(iterationText);
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000 || !saltText || !digestText) {
        return false;
    }

    try {
        const expected = Buffer.from(digestText, "base64url");
        const actual = crypto.pbkdf2Sync(password, Buffer.from(saltText, "base64url"), iterations, expected.length, "sha256");
        return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
    } catch (error) {
        return false;
    }
}

function publicAccount(account) {
    const { password, ...safeAccount } = account;
    return safeAccount;
}

function getClaims(account) {
    const isStation = account.role === "Station";
    return {
        username: account.username,
        name: account.name || account.username,
        role: account.role || "Management",
        permissions: isStation ? [] : Array.isArray(account.permissions) ? account.permissions : [],
        inventoryAccess: isStation
            ? ["Requests"]
            : Array.isArray(account.inventoryAccess) ? account.inventoryAccess : [],
        office: account.office || ""
    };
}

function normalizeManagedAccount(input, username, claims) {
    const account = { ...input, username };
    if (account.role === "Station") {
        if (claims.role !== "Developer" && !claims.inventoryAccess.includes("Requests")) {
            throw Object.assign(new Error("You cannot assign Requests access."), { status: 403 });
        }
        account.inventoryAccess = ["Requests"];
        account.permissions = [];
        return account;
    }
    if (claims.role !== "Developer") {
        if (account.role === "Developer") {
            throw Object.assign(new Error("Only a Developer can create or assign the Developer role."), { status: 403 });
        }
        const allowedPermissions = new Set(claims.permissions);
        const allowedOffices = new Set(claims.inventoryAccess);
        const requestedPermissions = Array.isArray(account.permissions) ? account.permissions : [];
        const requestedOffices = Array.isArray(account.inventoryAccess) ? account.inventoryAccess : [];
        if (requestedPermissions.some(permission => !allowedPermissions.has(permission)) ||
            requestedOffices.some(office => !allowedOffices.has(office))) {
            throw Object.assign(new Error("You cannot assign access that your account does not have."), { status: 403 });
        }
    }
    return account;
}

function validateRequestInput(input) {
    const station = String(input.station || "").trim();
    const requestee = String(input.requestee || "").trim();
    const quantity = Number(input.quantity);
    const unit = String(input.unit || "");
    const notes = String(input.notes || "").trim();

    if (!station || station.length > 120) throw Object.assign(new Error("Enter a station (up to 120 characters)."), { status: 400 });
    if (!requestee || requestee.length > 120) throw Object.assign(new Error("Enter the requestee name (up to 120 characters)."), { status: 400 });
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw Object.assign(new Error("Quantity must be a positive whole number."), { status: 400 });
    if (!allowedUnits.has(unit)) throw Object.assign(new Error("Choose Boxes, Rolls, or Pcs."), { status: 400 });
    if (notes.length > 500) throw Object.assign(new Error("Notes cannot exceed 500 characters."), { status: 400 });
    return { station, requestee, quantity, unit, notes };
}

module.exports = {
    getClaims,
    hashPassword,
    normalizeManagedAccount,
    publicAccount,
    validateRequestInput,
    verifyPassword
};
