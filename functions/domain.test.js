const test = require("node:test");
const assert = require("node:assert/strict");
const {
    getClaims,
    hashPassword,
    normalizeManagedAccount,
    publicAccount,
    validateRequestInput,
    verifyPassword
} = require("./domain");

test("password hashes verify without exposing the original password", () => {
    const hash = hashPassword("a-secure-test-password");
    assert.match(hash, /^pbkdf2\$/);
    assert.equal(verifyPassword("a-secure-test-password", hash), true);
    assert.equal(verifyPassword("not-the-password", hash), false);
});

test("public account output omits password hashes", () => {
    assert.deepEqual(publicAccount({ username: "station", password: "secret" }), { username: "station" });
});

test("Station claims are restricted to Requests and no menu permissions", () => {
    assert.deepEqual(getClaims({
        username: "station",
        role: "Station",
        permissions: ["inventory", "users"],
        inventoryAccess: ["Cebu"]
    }), {
        username: "station",
        name: "station",
        role: "Station",
        permissions: [],
        inventoryAccess: ["Requests"],
        office: ""
    });
});

test("Station accounts are normalized and non-Developer managers cannot elevate access", () => {
    const manager = { role: "Management", permissions: ["users"], inventoryAccess: ["Requests"] };
    assert.deepEqual(normalizeManagedAccount({ role: "Station", permissions: ["users"] }, "station", manager), {
        role: "Station",
        permissions: [],
        username: "station",
        inventoryAccess: ["Requests"]
    });
    assert.throws(
        () => normalizeManagedAccount({ role: "Developer" }, "admin", manager),
        { status: 403 }
    );
    assert.throws(
        () => normalizeManagedAccount({ role: "Management", permissions: ["inventory"] }, "user", manager),
        { status: 403 }
    );
    assert.throws(
        () => normalizeManagedAccount(
            { role: "Station" },
            "station",
            { ...manager, inventoryAccess: [] }
        ),
        { status: 403 }
    );
});

test("request validation trims text and rejects invalid quantities and units", () => {
    assert.deepEqual(validateRequestInput({
        station: " Cebu ",
        requestee: " Alex ",
        quantity: "2",
        unit: "Boxes",
        notes: " urgent "
    }), {
        station: "Cebu",
        requestee: "Alex",
        quantity: 2,
        unit: "Boxes",
        notes: "urgent"
    });

    assert.throws(() => validateRequestInput({
        station: "Cebu",
        requestee: "Alex",
        quantity: 1.5,
        unit: "Boxes"
    }), { status: 400 });
    assert.throws(() => validateRequestInput({
        station: "Cebu",
        requestee: "Alex",
        quantity: 1,
        unit: "Pallet"
    }), { status: 400 });
});
