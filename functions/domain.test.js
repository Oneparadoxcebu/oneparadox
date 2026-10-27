const test = require("node:test");
const assert = require("node:assert/strict");
const {
    canDeleteFirebaseUser,
    getClaims,
    hashPassword,
    normalizeManagedAccount,
    publicAccount,
    validateRequestInput,
    verifyPassword
} = require("./domain");

test("Firebase account deletion is limited to Developer and IT Admin with protected targets", () => {
    const developer = { uid: "developer-uid", role: "Developer" };
    const admin = { uid: "admin-uid", role: "IT Admin" };
    const manager = { uid: "manager-uid", role: "IT Manager" };
    const user = { uid: "user-uid", role: "Management" };
    const otherDeveloper = { uid: "other-developer-uid", role: "Developer" };

    assert.equal(canDeleteFirebaseUser(developer, user), true);
    assert.equal(canDeleteFirebaseUser(admin, user), true);
    assert.equal(canDeleteFirebaseUser(admin, otherDeveloper), false);
    assert.equal(canDeleteFirebaseUser(manager, user), false);
    assert.equal(canDeleteFirebaseUser(developer, developer), false);
    assert.equal(canDeleteFirebaseUser({ ...developer, disabled: true }, user), false);
});

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

test("Collector claims are restricted to Requests and the Collector office", () => {
    assert.deepEqual(getClaims({
        username: "collector",
        role: "Collector",
        office: "Cebu",
        permissions: ["inventory", "users"],
        inventoryAccess: ["Cebu", "Thermal"]
    }), {
        username: "collector",
        name: "collector",
        role: "Collector",
        permissions: [],
        inventoryAccess: ["Requests"],
        office: "Collector"
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
    assert.deepEqual(normalizeManagedAccount({
        role: "Collector",
        office: "Thermal",
        permissions: ["inventory"],
        inventoryAccess: ["Thermal"]
    }, "collector", manager), {
        role: "Collector",
        office: "Collector",
        permissions: [],
        username: "collector",
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
    assert.throws(() => validateRequestInput({
        station: "Cebu",
        requestee: "Alex",
        quantity: 1,
        unit: "Pcs"
    }), { status: 400 });
});
