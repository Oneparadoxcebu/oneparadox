(function () {
    "use strict";

    if (!window.firebase || !window.firebaseConfig) {
        throw new Error("Firebase SDK or configuration is missing.");
    }

    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.firebaseConfig);
    const auth = app.auth();
    const db = app.firestore();
    const USERS = "users";
    const ACCOUNT_APPROVALS = "accountApprovalRequests";
    const INVENTORY = "inventory";
    const STATION_THERMAL_INVENTORY = "stationThermalInventory";
    const STATION_THERMAL_RECORDS = "stationThermalRecords";
    const THERMAL_STATIONS = ["Guadalupe Station", "Punta Princessa Station", "Babag Station"];
    const THERMAL_INVENTORY_GROUPS = [...THERMAL_STATIONS, "Collector"];

    function normalizeThermalStation(value) {
        const normalized = String(value || "").trim().toLowerCase();
        return THERMAL_STATIONS.find(station => station.toLowerCase() === normalized) || "";
    }

    function normalizeThermalInventoryGroup(value) {
        const normalized = String(value || "").trim().toLowerCase();
        return THERMAL_INVENTORY_GROUPS.find(group => group.toLowerCase() === normalized) || "";
    }

    function profileFromSnapshot(snapshot) {
        return snapshot.exists ? { uid: snapshot.id, ...snapshot.data() } : null;
    }

    async function getProfile(uid = auth.currentUser?.uid) {
        if (!uid) return null;
        return profileFromSnapshot(await db.collection(USERS).doc(uid).get());
    }

    function accountMap(profiles) {
        return Object.fromEntries(profiles
            .filter(profile => profile && profile.username && profile.pendingApproval !== true)
            .map(profile => [profile.username, profile]));
    }

    function cleanProfile(profile) {
        const {
            uid,
            username,
            name,
            email,
            role,
            permissions,
            office,
            inventoryAccess,
            disabled,
            pendingApproval,
            theme
        } = profile;
        const isCollector = role === "Collector";
        const roleAccess = {
            "IT Admin": {
                office: "Both",
                inventoryAccess: ["Cebu", "Thermal", "Requests"],
                permissions: ["dashboard", "analytics", "reports", "inventory", "settings", "addAccount", "users", "assignedTasks", "administrator"]
            },
            "IT Manager": {
                office: "Both",
                inventoryAccess: ["Cebu", "Thermal"],
                permissions: ["inventory", "addAccount", "users"]
            },
            "IT Support": {
                office: "Cebu",
                inventoryAccess: ["Cebu"],
                permissions: ["inventory", "addAccount", "users"]
            },
            Management: { office: "Both", inventoryAccess: ["Cebu", "Thermal"], permissions: ["inventory"] },
            Accounting: { office: "Both", inventoryAccess: ["Cebu", "Thermal"], permissions: ["inventory"] },
            HR: { office: "Both", inventoryAccess: ["Cebu", "Thermal"], permissions: ["inventory"] }
        }[role];
        return {
            ...(uid ? { uid } : {}),
            username: String(username || "").trim(),
            name: String(name || "").trim(),
            email: String(email || "").trim().toLowerCase(),
            role: String(role || "Management"),
            permissions: isCollector ? [] : roleAccess?.permissions || (Array.isArray(permissions) ? permissions : []),
            office: isCollector ? "Collector" : roleAccess?.office || String(office || ""),
            inventoryAccess: isCollector ? ["Requests"] : roleAccess?.inventoryAccess || (Array.isArray(inventoryAccess) ? inventoryAccess : []),
            disabled: Boolean(disabled),
            ...(pendingApproval === true ? { pendingApproval: true } : {}),
            ...(theme === "light" || theme === "dark" ? { theme } : {})
        };
    }

    function stableSerialize(value) {
        if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
        if (value && typeof value === "object") {
            return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
                .map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
        }
        return JSON.stringify(value);
    }

    function removeUndefined(value) {
        if (Array.isArray(value)) return value.map(item => item === undefined ? null : removeUndefined(item));
        if (value && typeof value === "object") {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null) return value;
            return Object.fromEntries(Object.entries(value)
                .filter(([, item]) => item !== undefined)
                .map(([key, item]) => [key, removeUndefined(item)]));
        }
        return value;
    }

    async function getProfileByUsername(username) {
        const normalized = String(username || "").trim().toLowerCase();
        const result = await db.collection(USERS).where("username", "==", normalized).limit(1).get();
        return result.empty ? null : profileFromSnapshot(result.docs[0]);
    }

    async function createAccount(username, profile) {
        const actor = await getProfile();
        if (!actor || actor.disabled || !["Developer", "IT Admin"].includes(actor.role)) {
            throw new Error("Only Developer or IT Admin accounts can create active accounts directly.");
        }
        const normalizedUsername = String(username || profile.username || "").trim().toLowerCase();
        const email = String(profile.email || "").trim().toLowerCase();
        const password = String(profile.password || "");
        if (!normalizedUsername || !email || password.length < 6) {
            throw new Error("A username, valid email address, and password of at least 6 characters are required.");
        }

        const existing = await getProfileByUsername(normalizedUsername);
        if (existing) throw new Error("That username is already in use.");

        const secondaryName = `oneparadox-user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const secondaryApp = firebase.initializeApp(window.firebaseConfig, secondaryName);
        let createdUser = null;
        try {
            const credential = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
            createdUser = credential.user;
            const clean = cleanProfile({ ...profile, username: normalizedUsername, email, uid: credential.user.uid, disabled: false });
            await db.collection(USERS).doc(credential.user.uid).set(clean);
            return clean;
        } catch (error) {
            if (createdUser) {
                try {
                    await createdUser.delete();
                } catch (cleanupError) {
                    console.error("Firebase Authentication account cleanup failed after profile creation failed.", cleanupError);
                }
            }
            throw error;
        } finally {
            await secondaryApp.delete();
        }
    }

    async function createPendingAccountApproval(username, profile) {
        const actor = await getProfile();
        if (!actor || actor.disabled || !["IT Manager", "IT Support"].includes(actor.role)) {
            throw new Error("Only IT Manager and IT Support accounts can submit account approval requests.");
        }
        const assignableRoles = actor.role === "IT Manager"
            ? ["IT Support", "Management", "Accounting", "HR", "Station"]
            : ["Management", "Accounting", "HR", "Station"];
        if (!assignableRoles.includes(profile.role)) {
            throw new Error(`${actor.role} accounts cannot create an account with the ${profile.role || "selected"} role.`);
        }
        const normalizedUsername = String(username || profile.username || "").trim().toLowerCase();
        const email = String(profile.email || "").trim().toLowerCase();
        const password = String(profile.password || "");
        if (!normalizedUsername || !email || password.length < 6) {
            throw new Error("A username, valid email address, and password of at least 6 characters are required.");
        }
        const existing = await getProfileByUsername(normalizedUsername);
        if (existing) throw new Error("That username is already in use.");

        const secondaryName = `oneparadox-pending-user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const secondaryApp = firebase.initializeApp(window.firebaseConfig, secondaryName);
        let createdUser = null;
        try {
            const credential = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
            createdUser = credential.user;
            const pendingProfile = cleanProfile({
                ...profile,
                username: normalizedUsername,
                email,
                uid: credential.user.uid,
                disabled: true,
                pendingApproval: true
            });
            const requestedAt = new Date().toISOString();
            const requestRef = db.collection(ACCOUNT_APPROVALS).doc(credential.user.uid);
            await db.runTransaction(async transaction => {
                transaction.set(db.collection(USERS).doc(credential.user.uid), pendingProfile);
                transaction.set(requestRef, {
                    uid: credential.user.uid,
                    username: normalizedUsername,
                    name: pendingProfile.name,
                    email,
                    role: pendingProfile.role,
                    office: pendingProfile.office,
                    inventoryAccess: pendingProfile.inventoryAccess,
                    permissions: pendingProfile.permissions,
                    requestedBy: actor.username,
                    requestedAt,
                    status: "Pending"
                });
            });
            return pendingProfile;
        } catch (error) {
            if (createdUser) {
                try {
                    await createdUser.delete();
                } catch (cleanupError) {
                    console.error("Firebase Authentication account cleanup failed after approval request creation failed.", cleanupError);
                }
            }
            throw error;
        } finally {
            await secondaryApp.delete();
        }
    }

    async function loadPendingAccountApprovals() {
        const actor = await getProfile();
        if (!actor || actor.disabled || !["Developer", "IT Admin"].includes(actor.role)) {
            throw new Error("Only Developer and IT Admin accounts can view account approval requests.");
        }
        const snapshot = await db.collection(ACCOUNT_APPROVALS).where("status", "==", "Pending").get();
        return snapshot.docs.map(document => ({ id: document.id, ...document.data() }));
    }

    async function approveAccountApproval(requestId) {
        const actor = await getProfile();
        if (!actor || actor.disabled || !["Developer", "IT Admin"].includes(actor.role)) {
            throw new Error("Only Developer and IT Admin accounts can approve account requests.");
        }
        if (!requestId) throw new Error("An account approval request ID is required.");
        const requestRef = db.collection(ACCOUNT_APPROVALS).doc(requestId);
        await db.runTransaction(async transaction => {
            const requestSnapshot = await transaction.get(requestRef);
            if (!requestSnapshot.exists || requestSnapshot.data().status !== "Pending") {
                throw new Error("This approval request is no longer pending.");
            }
            const request = requestSnapshot.data();
            const profileRef = db.collection(USERS).doc(request.uid);
            const profileSnapshot = await transaction.get(profileRef);
            if (!profileSnapshot.exists || profileSnapshot.data().pendingApproval !== true) {
                throw new Error("The requested account profile is missing or has already been processed.");
            }
            transaction.update(profileRef, { disabled: false, pendingApproval: false });
            transaction.update(requestRef, {
                status: "Approved",
                approvedBy: actor.username,
                approvedAt: new Date().toISOString()
            });
        });
    }

    async function saveOne(username, profile) {
        const current = await getProfileByUsername(username);
        if (!current) {
            if (!profile.password) throw new Error("A password is required when creating an account.");
            const actor = await getProfile();
            if (!profile.uid && ["IT Manager", "IT Support"].includes(actor?.role)) {
                return createPendingAccountApproval(username, profile);
            }
            return createAccount(username, profile);
        }
        if (String(profile.username || username).toLowerCase() !== current.username ||
            String(profile.email || current.email).toLowerCase() !== current.email) {
            throw new Error("Changing a username or email requires updating the Firebase Authentication account.");
        }
        const clean = cleanProfile({ ...current, ...profile, uid: current.uid, username: current.username, email: current.email });
        await db.collection(USERS).doc(current.uid).set(clean);
        return clean;
    }

    async function deleteAccount(username) {
        const actor = await getProfile();
        if (!actor || actor.disabled || !["Developer", "IT Admin"].includes(actor.role)) {
            throw new Error("Only enabled Developer and IT Admin accounts can delete users.");
        }
        const target = await getProfileByUsername(username);
        if (!target) throw new Error("Account not found.");
        if (target.uid === actor.uid) throw new Error("You cannot delete your own account.");
        if (actor.role === "IT Admin" && target.role === "Developer") {
            throw new Error("IT Admin accounts cannot delete Developer accounts.");
        }

        const user = auth.currentUser;
        if (!user || user.uid !== actor.uid) throw new Error("Your Firebase session is no longer available. Sign in again.");
        const projectId = String(window.firebaseConfig?.projectId || "").trim();
        if (!projectId) throw new Error("Firebase project configuration is missing.");

        let response;
        try {
            response = await fetch(
                `https://us-central1-${projectId}.cloudfunctions.net/api/users/${encodeURIComponent(target.username)}`,
                {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${await user.getIdToken()}` }
                }
            );
        } catch (error) {
            response = null;
        }

        let result = null;
        if (response) {
            try {
                result = await response.json();
            } catch (error) {
                if (!response.ok && response.status !== 404) {
                    throw new Error(`Account deletion service returned HTTP ${response.status}.`);
                }
            }
            if (response.ok) return true;
        }

        // Cloud Functions cannot be deployed on projects without an active billing account.
        // If the endpoint is unavailable, remove the profile so the account can no longer
        // access the app; Firebase Authentication cleanup must be done in Firebase Console.
        if (!response || response.status === 404) {
            await db.collection(USERS).doc(target.uid).delete();
            return true;
        }
        throw new Error(result?.message || `Account deletion failed (${response.status}).`);
    }

    async function clearOtherAccountProfiles() {
        const actor = await getProfile();
        if (!actor || actor.disabled || !["Developer", "IT Admin"].includes(actor.role)) {
            throw new Error("Only enabled Developer and IT Admin accounts can clear other account profiles.");
        }

        const snapshot = await db.collection(USERS).get();
        const targets = snapshot.docs.filter(document => document.id !== actor.uid);
        for (let index = 0; index < targets.length; index += 400) {
            const batch = db.batch();
            targets.slice(index, index + 400).forEach(document => batch.delete(document.ref));
            await batch.commit();
        }

        const remaining = { [actor.username]: actor };
        localStorage.setItem("userAccounts", JSON.stringify(remaining));
        return remaining;
    }

    async function loadAccounts() {
        const current = await getProfile();
        if (!current || current.disabled) throw new Error("Sign in with an enabled account to load user profiles.");
        if (!canManageAccounts(current)) return accountMap([current]);
        const result = await db.collection(USERS).get();
        return accountMap(result.docs.map(profileFromSnapshot));
    }

    function canManageAccounts(profile) {
        return ["Developer", "IT Admin", "IT Manager", "IT Support"].includes(profile?.role);
    }

    async function saveAccounts(accounts) {
        const current = await loadAccounts();
        const desired = accounts || {};
        const tasks = [];
        for (const [username, profile] of Object.entries(desired)) {
            if (!current[username]) {
                tasks.push(saveOne(username, profile));
            } else {
                const merged = cleanProfile({ ...current[username], ...profile });
                if (JSON.stringify(merged) !== JSON.stringify(cleanProfile(current[username]))) {
                    tasks.push(saveOne(username, profile));
                }
            }
        }
        for (const username of Object.keys(current)) {
            if (!desired[username]) tasks.push(deleteAccount(username));
        }
        await Promise.all(tasks);
        return loadAccounts();
    }

    async function saveTheme(username, theme) {
        const profile = await getProfile();
        if (!profile || profile.username !== username || !["light", "dark"].includes(theme)) {
            throw new Error("You can only save a theme preference for your own account.");
        }
        await db.collection(USERS).doc(profile.uid).update({ theme });
    }

    function requireSignedIn() {
        if (!auth.currentUser) throw new Error("You must be signed in to use Firestore.");
        return auth.currentUser;
    }

    function assertInventoryOffice(office) {
        if (!["Cebu", "Thermal"].includes(office)) throw new Error("Unknown inventory office.");
        return getProfile().then(profile => {
            const roleOffices = {
                "IT Admin": ["Cebu", "Thermal"],
                "IT Manager": ["Cebu", "Thermal"],
                "IT Support": ["Cebu"],
                Management: ["Cebu", "Thermal"],
                Accounting: ["Cebu", "Thermal"],
                HR: ["Cebu", "Thermal"]
            };
            const allowedOffices = roleOffices[profile?.role] ||
                (profile?.role === "Developer"
                    ? ["Cebu", "Thermal"]
                    : profile?.office === "Both"
                        ? ["Cebu", "Thermal"]
                        : profile?.inventoryAccess || []);
            const hasRoleAccess = profile?.role === "Developer" || Object.prototype.hasOwnProperty.call(roleOffices, profile?.role);
            if (!profile || profile.disabled ||
                (!hasRoleAccess && (!Array.isArray(profile.permissions) || !profile.permissions.includes("inventory"))) ||
                !allowedOffices.includes(office)) {
                throw new Error("Your account does not have access to this inventory office.");
            }
            return profile;
        });
    }

    function canManageInventory(profile, office) {
        if (["Developer", "IT Admin", "IT Manager"].includes(profile?.role)) return ["Cebu", "Thermal"].includes(office);
        if (profile?.role === "IT Support") return office === "Cebu";
        if (["Management", "Accounting", "HR"].includes(profile?.role)) return office === "Thermal";
        return false;
    }

    async function loadInventory(office) {
        requireSignedIn();
        await assertInventoryOffice(office);
        const inventoryRef = db.collection(INVENTORY).doc(office);
        const reads = [
            inventoryRef.get(),
            inventoryRef.collection("chunks").orderBy(firebase.firestore.FieldPath.documentId()).get()
        ];
        if (office === "Thermal") {
            THERMAL_STATIONS.forEach(station => {
                reads.push(db.collection(STATION_THERMAL_RECORDS).doc(station).collection("records").get());
            });
        }
        const [metadata, chunks, ...stationRecordSnapshots] = await Promise.all(reads);
        const recordsData = chunks.docs.flatMap(snapshot => snapshot.data().records || []);
        if (office === "Thermal") {
            const knownRecordIds = new Set(recordsData.map(record => record.stationRecordId).filter(Boolean));
            stationRecordSnapshots.forEach(snapshot => {
                snapshot.docs.forEach(document => {
                    if (!knownRecordIds.has(document.id)) {
                        recordsData.push({ ...document.data(), stationRecordId: document.id });
                        knownRecordIds.add(document.id);
                    }
                });
            });
        }
        if (!metadata.exists && !recordsData.length) return null;
        return {
            ...(metadata.exists ? metadata.data() : { summaryData: {}, updatedAt: "" }),
            recordsData
        };
    }

    async function watchInventory(office, onChange, onError) {
        requireSignedIn();
        await assertInventoryOffice(office);
        const inventoryRef = db.collection(INVENTORY).doc(office);
        let metadataReady = false;
        let chunksReady = false;
        let metadata = null;
        let chunks = [];
        let firstSnapshotResolved = false;
        let resolveInitial;
        let rejectInitial;
        const initial = new Promise((resolve, reject) => {
            resolveInitial = resolve;
            rejectInitial = reject;
        });
        const emit = () => {
            if (!metadataReady || !chunksReady) return;
            const value = metadata ? { ...metadata, recordsData: chunks.flatMap(chunk => chunk.records || []) } : null;
            onChange(value);
            if (!firstSnapshotResolved) {
                firstSnapshotResolved = true;
                resolveInitial(value);
            }
        };
        const fail = error => {
            if (!firstSnapshotResolved) {
                firstSnapshotResolved = true;
                rejectInitial(error);
            }
            onError(error);
        };
        const stopMetadata = inventoryRef.onSnapshot(snapshot => {
            metadata = snapshot.exists ? snapshot.data() : null;
            metadataReady = true;
            emit();
        }, fail);
        const stopChunks = inventoryRef.collection("chunks")
            .orderBy(firebase.firestore.FieldPath.documentId())
            .onSnapshot(snapshot => {
                chunks = snapshot.docs.map(doc => doc.data());
                chunksReady = true;
                emit();
            }, fail);
        const stop = () => {
            stopMetadata();
            stopChunks();
        };
        stop.initial = initial;
        return stop;
    }

    function splitRecords(records) {
        const chunks = [];
        let chunk = [];
        let size = 2;
        for (const record of records) {
            const recordSize = new TextEncoder().encode(JSON.stringify(record)).length + 1;
            if (recordSize > 700000) throw new Error("An inventory record exceeds the supported Firestore document size.");
            if (chunk.length && (chunk.length >= 100 || size + recordSize > 700000)) {
                chunks.push(chunk);
                chunk = [];
                size = 2;
            }
            chunk.push(record);
            size += recordSize;
        }
        if (chunk.length) chunks.push(chunk);
        return chunks;
    }

    async function writeStationThermalInventory(station, records, updatedAt) {
        const inventoryRef = db.collection(STATION_THERMAL_INVENTORY).doc(station);
        const chunksRef = inventoryRef.collection("chunks");
        const existing = await chunksRef.get();
        const chunks = splitRecords(records);
        const writes = [];
        chunks.forEach((chunk, index) => {
            const id = String(index).padStart(5, "0");
            const payload = { records: removeUndefined(chunk) };
            const old = existing.docs.find(snapshot => snapshot.id === id);
            if (!old || stableSerialize(old.data()) !== stableSerialize(payload)) {
                writes.push({ type: "set", ref: chunksRef.doc(id), payload });
            }
        });
        existing.docs.forEach(snapshot => {
            if (Number(snapshot.id) >= chunks.length) writes.push({ type: "delete", ref: snapshot.ref });
        });
        for (let offset = 0; offset < writes.length; offset += 450) {
            const batch = db.batch();
            writes.slice(offset, offset + 450).forEach(write => {
                if (write.type === "delete") batch.delete(write.ref);
                else batch.set(write.ref, write.payload);
            });
            await batch.commit();
        }

        const metadata = {
            station,
            updatedAt,
            recordCount: records.length
        };
        const existingMetadata = await inventoryRef.get();
        if (!existingMetadata.exists || stableSerialize(existingMetadata.data()) !== stableSerialize(metadata)) {
            await inventoryRef.set(metadata);
        }
    }

    async function publishThermalStationInventory(inventory) {
        requireSignedIn();
        await assertInventoryOffice("Thermal");
        const records = Array.isArray(inventory.recordsData) ? inventory.recordsData : [];
        const updatedAt = inventory.updatedAt || new Date().toISOString();
        await Promise.all(THERMAL_INVENTORY_GROUPS.map(group => {
            const groupRecords = records.filter(record => normalizeThermalInventoryGroup(record.rack) === group);
            return writeStationThermalInventory(group, groupRecords, updatedAt);
        }));
    }

    async function loadStationThermalInventory() {
        requireSignedIn();
        const profile = await getProfile();
        const station = normalizeThermalStation(profile?.office);
        if (!profile || profile.disabled || profile.role !== "Station" || !station ||
            !Array.isArray(profile.inventoryAccess) || !profile.inventoryAccess.includes("Requests")) {
            throw new Error("An enabled Station account with an assigned station is required.");
        }

        const inventoryRef = db.collection(STATION_THERMAL_INVENTORY).doc(station);
        const stationRecordsRef = db.collection(STATION_THERMAL_RECORDS).doc(station).collection("records");
        const [metadata, chunks, stationRecords] = await Promise.all([
            inventoryRef.get(),
            inventoryRef.collection("chunks").orderBy(firebase.firestore.FieldPath.documentId()).get(),
            stationRecordsRef.get()
        ]);
        const recordsData = chunks.docs.flatMap(snapshot => snapshot.data().records || []);
        const knownRecordIds = new Set(recordsData.map(record => record.stationRecordId).filter(Boolean));
        stationRecords.docs.forEach(document => {
            if (!knownRecordIds.has(document.id)) {
                recordsData.push({ ...document.data(), stationRecordId: document.id });
                knownRecordIds.add(document.id);
            }
        });
        if (!metadata.exists && !recordsData.length) return null;
        return {
            ...(metadata.exists ? metadata.data() : { station, updatedAt: "" }),
            recordsData
        };
    }

    async function createStationThermalRecord(input) {
        const profile = await getProfile();
        requireSignedIn();
        const station = normalizeThermalStation(profile?.office);
        if (!profile || profile.disabled || profile.role !== "Station" || !station ||
            !Array.isArray(profile.inventoryAccess) || !profile.inventoryAccess.includes("Requests")) {
            throw new Error("An enabled Station account with an assigned station is required.");
        }
        const posNo = String(input.posNo || "").trim();
        const quantity = Number(posNo);
        const posUnit = String(input.posUnit || "").trim().toUpperCase();
        const status = String(input.status || "").trim();
        if (!posNo || posNo.length > 120 || !Number.isFinite(quantity) || quantity < 0) {
            throw new Error("Enter a valid Released quantity.");
        }
        if (!["BOX", "ROLLS"].includes(posUnit)) throw new Error("Select a valid Released unit.");
        if (!["Paid", "Not Paid"].includes(status)) {
            throw new Error("Select a valid record status.");
        }

        const reference = db.collection(STATION_THERMAL_RECORDS).doc(station).collection("records").doc();
        const record = {
            stationRecordId: reference.id,
            rack: station,
            posNo,
            posUnit,
            serialNumber: "",
            fullName: String(input.fullName || "").trim(),
            userId: String(input.userId || "").trim(),
            address: String(input.address || "").trim(),
            status,
            lokals: "",
            noteIssue: String(input.noteIssue || "").trim(),
            price: input.price === "" || input.price === null || input.price === undefined ? "" : Number(input.price),
            transferTo: "",
            columnJ: "",
            createdBy: profile.username,
            recordDate: new Date().toISOString()
        };
        if ((!Number.isFinite(record.price) && record.price !== "") || (record.price !== "" && record.price < 0)) {
            throw new Error("Enter a valid price.");
        }
        ["fullName", "userId", "address", "noteIssue"].forEach(field => {
            if (record[field].length > 1000) throw new Error(`${field} cannot exceed 1000 characters.`);
        });
        await reference.set(record);
        return record;
    }

    async function loadCollectorThermalInventory() {
        requireSignedIn();
        const profile = await getProfile();
        if (!profile || profile.disabled || profile.role !== "Collector" || profile.office !== "Collector" ||
            !Array.isArray(profile.inventoryAccess) || !profile.inventoryAccess.includes("Requests")) {
            throw new Error("An enabled Collector account is required.");
        }

        const inventoryRef = db.collection(STATION_THERMAL_INVENTORY).doc("Collector");
        const [metadata, chunks] = await Promise.all([
            inventoryRef.get(),
            inventoryRef.collection("chunks").orderBy(firebase.firestore.FieldPath.documentId()).get()
        ]);
        if (!metadata.exists) return null;
        return {
            ...metadata.data(),
            recordsData: chunks.docs.flatMap(snapshot => snapshot.data().records || [])
        };
    }

    async function saveInventory(office, inventory) {
        requireSignedIn();
        const profile = await assertInventoryOffice(office);
        if (!canManageInventory(profile, office)) {
            throw new Error("Your account has view-only access to this inventory.");
        }
        const inventoryRef = db.collection(INVENTORY).doc(office);
        const chunksRef = inventoryRef.collection("chunks");
        const existing = await chunksRef.get();
        const records = Array.isArray(inventory.recordsData) ? inventory.recordsData : [];
        const chunks = splitRecords(records);
        const writes = [];
        chunks.forEach((chunk, index) => {
            const id = String(index).padStart(5, "0");
            const payload = { records: removeUndefined(chunk) };
            const old = existing.docs.find(snapshot => snapshot.id === id);
            if (!old || stableSerialize(old.data()) !== stableSerialize(payload)) {
                writes.push({ type: "set", ref: chunksRef.doc(id), payload });
            }
        });
        existing.docs.forEach(snapshot => {
            if (Number(snapshot.id) >= chunks.length) writes.push({ type: "delete", ref: snapshot.ref });
        });
        for (let offset = 0; offset < writes.length; offset += 450) {
            const batch = db.batch();
            writes.slice(offset, offset + 450).forEach(write => {
                if (write.type === "delete") batch.delete(write.ref);
                else batch.set(write.ref, write.payload);
            });
            await batch.commit();
        }
        const updatedAt = inventory.updatedAt || new Date().toISOString();
        await inventoryRef.set({
            summaryData: removeUndefined(inventory.summaryData || {}),
            updatedAt,
            recordCount: records.length
        });
        if (office === "Thermal") {
            await synchronizeStationThermalRecords(records);
            await publishThermalStationInventory({ ...inventory, recordsData: records, updatedAt });
        }
    }

    async function synchronizeStationThermalRecords(records) {
        const snapshots = await Promise.all(THERMAL_STATIONS.map(station =>
            db.collection(STATION_THERMAL_RECORDS).doc(station).collection("records").get()
        ));
        const savedRecords = new Map(records
            .filter(record => record.stationRecordId)
            .map(record => [record.stationRecordId, record]));
        const writes = [];
        snapshots.forEach(snapshot => {
            snapshot.docs.forEach(document => {
                const record = savedRecords.get(document.id);
                if (!record) {
                    writes.push({ type: "delete", ref: document.ref });
                    return;
                }
                const payload = removeUndefined({ ...record, stationRecordId: document.id });
                if (stableSerialize(document.data()) !== stableSerialize(payload)) {
                    writes.push({ type: "set", ref: document.ref, payload });
                }
            });
        });
        for (let offset = 0; offset < writes.length; offset += 450) {
            const batch = db.batch();
            writes.slice(offset, offset + 450).forEach(write => {
                if (write.type === "delete") batch.delete(write.ref);
                else batch.set(write.ref, write.payload);
            });
            await batch.commit();
        }
    }

    async function clearInventory(office) {
        const profile = await assertInventoryOffice(office);
        if (!["Developer", "IT Admin"].includes(profile.role)) {
            throw new Error("Only an IT Admin or Developer account can clear inventory.");
        }
        await saveInventory(office, {
            summaryData: {},
            recordsData: [],
            updatedAt: new Date().toISOString()
        });
    }

    async function loadHistory(office) {
        requireSignedIn();
        await assertInventoryOffice(office);
        const snapshot = await db.collection(INVENTORY).doc(office).collection("history")
            .orderBy("timestamp", "desc").limit(200).get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    async function saveHistory(office, history) {
        requireSignedIn();
        await assertInventoryOffice(office);
        const profile = await getProfile();
        const historyRef = db.collection(INVENTORY).doc(office).collection("history");
        const existing = await historyRef.get();
        const entries = (Array.isArray(history) ? history : [])
            .filter(entry => (entry.username || entry.user) === profile.username)
            .slice(0, 200);
        const wanted = new Set();
        const writes = [];
        entries.forEach(entry => {
            const id = encodeURIComponent(`${entry.timestamp || ""}_${entry.username || entry.user || ""}_${entry.serialNumber || ""}_${entry.field || ""}`).slice(0, 500);
            wanted.add(id);
            const payload = removeUndefined({ ...entry });
            if (!existing.docs.some(doc => doc.id === id && stableSerialize(doc.data()) === stableSerialize(payload))) {
                writes.push({ type: "set", ref: historyRef.doc(id), payload });
            }
        });
        existing.docs.forEach(doc => {
            if (!wanted.has(doc.id) && doc.data().username === profile.username) {
                writes.push({ type: "delete", ref: doc.ref });
            }
        });
        for (let offset = 0; offset < writes.length; offset += 450) {
            const batch = db.batch();
            writes.slice(offset, offset + 450).forEach(write => {
                if (write.type === "delete") batch.delete(write.ref);
                else batch.set(write.ref, write.payload);
            });
            await batch.commit();
        }
    }

    function canSubmitRequests(profile) {
        return ["Developer", "IT Admin"].includes(profile.role) ||
            (Array.isArray(profile.inventoryAccess) && profile.inventoryAccess.includes("Requests"));
    }

    function canManageRequests(profile) {
        return ["Developer", "IT Admin", "IT Manager", "Management"].includes(profile.role) ||
            !["IT Support", "Accounting", "HR"].includes(profile.role) &&
            (Array.isArray(profile.permissions) && profile.permissions.includes("inventory") &&
                Array.isArray(profile.inventoryAccess) && profile.inventoryAccess.includes("Thermal"));
    }

    async function loadRequests() {
        const profile = await getProfile();
        const user = requireSignedIn();
        if (!profile || profile.disabled || (!canSubmitRequests(profile) && !canManageRequests(profile))) {
            throw new Error("Your account does not have access to Requests.");
        }

        let query = db.collection("workspaceRequests");
        if (!canManageRequests(profile)) query = query.where("createdByUid", "==", user.uid);
        const snapshot = await query.get();
        return snapshot.docs
            .map(document => ({ id: document.id, ...document.data() }))
            .sort((first, second) => String(second.createdAt || "").localeCompare(String(first.createdAt || "")));
    }

    async function createRequest(input) {
        const profile = await getProfile();
        const user = requireSignedIn();
        if (!profile || profile.disabled || !canSubmitRequests(profile)) {
            throw new Error("Your account does not have permission to submit Requests.");
        }

        const reference = db.collection("workspaceRequests").doc();
        const station = profile.role === "Station"
            ? normalizeThermalStation(profile.office)
            : profile.role === "Collector"
                ? "Collector"
                : String(input.station || "").trim();
        const requestee = profile.role === "Station"
            ? ""
            : profile.role === "Collector"
                ? String(profile.name || profile.username || "").trim()
                : String(input.requestee || "").trim();
        const quantity = Number(input.quantity);
        const unit = String(input.unit || "");
        const notes = String(input.notes || "").trim();
        if (!station || station.length > 120) throw new Error("Enter a valid station for this request.");
        if ((profile.role !== "Station" && !requestee) || requestee.length > 120) {
            throw new Error("Enter the name of the requestee.");
        }
        if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Enter a whole-number quantity greater than zero.");
        if (!["Boxes", "Rolls"].includes(unit)) throw new Error("Select a valid unit.");
        if (!notes || notes.length > 500) throw new Error("Enter notes for this request (up to 500 characters).");

        const request = {
            id: reference.id,
            item: "Thermal Paper",
            quantity,
            unit,
            station,
            requestee,
            notes,
            requestedBy: profile.role === "Collector" ? "" : profile.name || profile.username,
            requestedByUsername: profile.username,
            createdByUid: user.uid,
            status: "Pending",
            createdAt: new Date().toISOString()
        };
        await reference.set(request);
        return request;
    }

    async function saveRequest(request) {
        const profile = await getProfile();
        if (!profile || profile.disabled || !["IT Admin", "IT Manager", "Management"].includes(profile.role)) {
            throw new Error("Only IT Admin, IT Manager, and Management accounts can change Request status.");
        }
        if (!request?.id || !["Pending", "Approved", "Rejected"].includes(request.status)) {
            throw new Error("A valid request ID and status are required.");
        }
        const rejectionNote = String(request.rejectionNote || "").trim();
        if (rejectionNote.length > 500) throw new Error("Rejection notes cannot exceed 500 characters.");
        await db.collection("workspaceRequests").doc(request.id).update({
            status: request.status,
            rejectionNote
        });
    }

    async function deleteRequest(requestId) {
        const profile = await getProfile();
        if (!profile || profile.disabled || !["Developer", "IT Admin"].includes(profile.role)) {
            throw new Error("Only IT Admin or Developer accounts can delete Requests.");
        }
        if (!requestId) throw new Error("A request ID is required to delete a request.");
        await db.collection("workspaceRequests").doc(requestId).delete();
    }

    window.firebaseApp = app;
    window.firebaseAuth = auth;
    window.firebaseDb = db;
    window.firebaseProfiles = { get: getProfile, getByUsername: getProfileByUsername };
    window.sharedAccounts = {
        load: loadAccounts,
        save: saveAccounts,
        saveOne,
        create: createAccount,
        createPendingApproval: createPendingAccountApproval,
        loadPendingApprovals: loadPendingAccountApprovals,
        approveAccountApproval,
        delete: deleteAccount,
        clearOtherProfiles: clearOtherAccountProfiles,
        saveTheme
    };
    window.sharedInventory = {
        load: loadInventory,
        loadStationThermal: loadStationThermalInventory,
        createStationThermalRecord,
        loadCollectorThermal: loadCollectorThermalInventory,
        publishThermalStation: publishThermalStationInventory,
        watch: watchInventory,
        save: saveInventory,
        clear: clearInventory,
        loadHistory,
        saveHistory
    };
    window.sharedRequests = {
        storageKey: "workspaceRequests",
        load: loadRequests,
        create: createRequest,
        save: saveRequest,
        delete: deleteRequest
    };
})();
