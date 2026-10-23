const fs = require("node:fs");
const path = require("node:path");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { hashPassword } = require("./domain");

const accountsFile = process.env.ACCOUNTS_FILE || path.join(__dirname, "..", "data", "accounts.json");

async function main() {
    if (!fs.existsSync(accountsFile)) {
        throw new Error(`Account seed file not found: ${accountsFile}`);
    }
    const accounts = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
    if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
        throw new Error("The account seed file must contain an account map.");
    }

    initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID ||
            process.env.GOOGLE_CLOUD_PROJECT ||
            process.env.GCLOUD_PROJECT ||
            "oneparadox-c5c48"
    });
    const collection = getFirestore().collection("accounts");
    const entries = Object.entries(accounts);
    for (let index = 0; index < entries.length; index += 400) {
        const batch = getFirestore().batch();
        entries.slice(index, index + 400).forEach(([username, input]) => {
            if (!input || typeof input !== "object" || !input.email || !input.password) {
                throw new Error(`Account ${username} is missing an email or password.`);
            }
            const account = { ...input, username };
            if (account.role === "Station") {
                account.permissions = [];
                account.inventoryAccess = ["Requests"];
            }
            if (!String(account.password).startsWith("pbkdf2$")) {
                account.password = hashPassword(String(account.password));
            }
            batch.set(collection.doc(username), account, { merge: true });
        });
        await batch.commit();
    }
    console.log(`Seeded ${entries.length} account(s).`);
}

main().catch(error => {
    console.error("Account seeding failed.", error.message);
    process.exitCode = 1;
});
