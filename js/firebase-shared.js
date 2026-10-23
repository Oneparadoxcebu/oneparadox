(function () {
    const firebaseConfig = {
        ...(window.firebaseProjectConfig || window.firebaseAuthSession?.config || {})
    };

    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        throw new Error("Firebase project configuration is missing. Load firebase-auth.js before firebase-shared.js.");
    }

    const firestoreRestBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents`;

    async function assertFirestoreResponse(response, action) {
        if (response.ok) return;
        const responseText = await response.text();
        let message = responseText;
        try {
            const result = JSON.parse(responseText);
            message = result.error?.message || result.message || responseText;
        } catch (error) {
            message = responseText;
        }
        if (response.status === 401 || response.status === 403) {
            throw new Error(`${action} denied by Firestore (${response.status}): ${message}. Verify the signed-in account and Firestore rules in project ${firebaseConfig.projectId}.`);
        }
        throw new Error(`${action} failed (${response.status}): ${message || "Firestore returned an empty error response."}`);
    }

    async function firestoreFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        const idToken = await window.firebaseAuthSession?.getIdToken();
        if (idToken) {
            headers.set("Authorization", `Bearer ${idToken}`);
        } else if (!isLocalRequestTesting()) {
            throw new Error("Sign in with your Firebase account to access Firestore.");
        }
        try {
            return await fetch(url, { ...options, headers });
        } catch (error) {
            console.error("Firestore REST request could not reach Google APIs.", error);
            throw new Error(`Could not connect to Firestore project ${firebaseConfig.projectId}. Check your network and Firebase project configuration.`);
        }
    }

    function toFirestoreValue(value) {
        if (value === null) return { nullValue: null };
        if (typeof value === "boolean") return { booleanValue: value };
        if (typeof value === "number") return { doubleValue: value };
        if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
        if (typeof value === "object") {
            return { mapValue: { fields: Object.keys(value).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(value[key]) }), {}) } };
        }
        return { stringValue: String(value) };
    }

    function fromFirestoreValue(value) {
        if (value.stringValue !== undefined) return value.stringValue;
        if (value.booleanValue !== undefined) return value.booleanValue;
        if (value.integerValue !== undefined) return Number(value.integerValue);
        if (value.doubleValue !== undefined) return value.doubleValue;
        if (value.nullValue !== undefined) return null;
        if (value.arrayValue) return (value.arrayValue.values || []).map(fromFirestoreValue);
        if (value.mapValue) return Object.keys(value.mapValue.fields || {}).reduce((object, key) => ({ ...object, [key]: fromFirestoreValue(value.mapValue.fields[key]) }), {});
        return null;
    }

    async function loadFirestoreCollection(collectionPath) {
        const documents = [];
        let pageToken = "";

        do {
            const params = new URLSearchParams({ key: firebaseConfig.apiKey, pageSize: "300" });
            if (pageToken) params.set("pageToken", pageToken);
            const response = await firestoreFetch(`${firestoreRestBase}/${collectionPath}?${params.toString()}`, { cache: "no-store" });
            await assertFirestoreResponse(response, "Firestore collection read");
            const result = await response.json();
            documents.push(...(result.documents || []));
            pageToken = result.nextPageToken || "";
        } while (pageToken);

        return documents;
    }

    async function loadAccountsFromFirestore() {
        const documents = await loadFirestoreCollection("accounts");
        return documents.reduce((accounts, document) => {
            const username = document.name.split("/").pop();
            accounts[username] = Object.keys(document.fields || {}).reduce((account, key) => ({ ...account, [key]: fromFirestoreValue(document.fields[key]) }), {});
            return accounts;
        }, {});
    }

    async function saveAccountsToFirestore(accounts) {
        await Promise.all(Object.entries(accounts).map(async ([username, account]) => {
            const response = await firestoreFetch(`${firestoreRestBase}/accounts/${encodeURIComponent(username)}?key=${firebaseConfig.apiKey}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: Object.keys(account).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(account[key]) }), {}) })
            });
            await assertFirestoreResponse(response, "Firestore account write");
        }));
    }

    async function saveAccountToFirestore(username, account) {
        return saveAccountsToFirestore({ [username]: account });
    }

    async function deleteAccountFromFirestore(username) {
        const response = await firestoreFetch(`${firestoreRestBase}/accounts/${encodeURIComponent(username)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        await assertFirestoreResponse(response, "Firestore account delete");
    }

    async function saveAccountThemeToFirestore(username, theme) {
        const params = new URLSearchParams({ key: firebaseConfig.apiKey, "updateMask.fieldPaths": "theme" });
        const response = await firestoreFetch(`${firestoreRestBase}/accounts/${encodeURIComponent(username)}?${params.toString()}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { theme: toFirestoreValue(theme) } })
        });
        await assertFirestoreResponse(response, "Account theme update");
    }

    async function loadAttendanceFromFirestore() {
        const documents = await loadFirestoreCollection("attendanceRecords");
        return documents.reduce((records, document) => {
            const recordId = document.name.split("/").pop();
            records[recordId] = Object.keys(document.fields || {}).reduce((record, key) => ({ ...record, [key]: fromFirestoreValue(document.fields[key]) }), {});
            return records;
        }, {});
    }

    async function saveAttendanceToFirestore(records) {
        await Promise.all(Object.entries(records).map(async ([recordId, record]) => {
            const response = await firestoreFetch(`${firestoreRestBase}/attendanceRecords/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields: Object.keys(record).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(record[key]) }), {}) })
            });
            await assertFirestoreResponse(response, "Firestore attendance write");
        }));
    }

    async function loadAttendanceHistoryFromFirestore() {
        const documents = await loadFirestoreCollection("attendanceHistory");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((entry, key) => ({ ...entry, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveAttendanceHistoryToFirestore(entry) {
        const response = await firestoreFetch(`${firestoreRestBase}/attendanceHistory/${encodeURIComponent(entry.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: Object.keys(entry).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(entry[key]) }), {}) })
        });
        await assertFirestoreResponse(response, "Firestore attendance history write");
    }

    async function loadAttendanceTasksFromFirestore() {
        const documents = await loadFirestoreCollection("attendanceTasks");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((task, key) => ({ ...task, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveAttendanceTasksToFirestore(tasks) {
        const existingDocuments = await loadFirestoreCollection("attendanceTasks");
        const taskIds = new Set(tasks.map(task => task.id));
        await Promise.all([
            ...tasks.map(async task => {
                const response = await firestoreFetch(`${firestoreRestBase}/attendanceTasks/${encodeURIComponent(task.id)}?key=${firebaseConfig.apiKey}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ fields: Object.keys(task).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(task[key]) }), {}) })
                });
                await assertFirestoreResponse(response, "Firestore attendance task write");
            }),
            ...existingDocuments
                .filter(document => !taskIds.has(document.name.split("/").pop()))
                .map(async document => {
                    const taskId = document.name.split("/").pop();
                    const response = await firestoreFetch(`${firestoreRestBase}/attendanceTasks/${encodeURIComponent(taskId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
                    await assertFirestoreResponse(response, "Firestore attendance task delete");
                })
        ]);
    }

    async function saveAnnouncementToFirestore(announcement) {
        const response = await firestoreFetch(`${firestoreRestBase}/announcements/${encodeURIComponent(announcement.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: Object.keys(announcement).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(announcement[key]) }), {}) })
        });
        await assertFirestoreResponse(response, "Announcement write");
    }

    async function loadAnnouncementsFromFirestore(since) {
        const documents = await loadFirestoreCollection("announcements");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((announcement, key) => ({ ...announcement, [key]: fromFirestoreValue(document.fields[key]) }), {})
        })).filter(announcement => Number(announcement.createdAt) > since)
            .sort((first, second) => Number(first.createdAt) - Number(second.createdAt));
    }

    async function clearAttendanceFromFirestore(date) {
        return clearAttendanceRangeFromFirestore(date, date);
    }

    async function clearAttendanceRangeFromFirestore(start, end) {
        const records = await loadAttendanceFromFirestore();
        const recordIds = Object.entries(records)
            .filter(([recordId, record]) => {
                const recordDate = record.date || recordId.split(":")[0];
                return !start || !end || (recordDate >= start && recordDate <= end);
            })
            .map(([recordId]) => recordId);
        await Promise.all(recordIds.map(async recordId => {
            const response = await firestoreFetch(`${firestoreRestBase}/attendanceRecords/${encodeURIComponent(recordId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
            await assertFirestoreResponse(response, "Firestore attendance delete");
        }));
    }

    async function loadInventoryFromFirestore(office) {
        const response = await firestoreFetch(`${firestoreRestBase}/inventoryData/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, { cache: "no-store" });
        if (response.status === 404) return null;
        await assertFirestoreResponse(response, "Firestore inventory read");
        const document = await response.json();
        return Object.keys(document.fields || {}).reduce((inventory, key) => ({ ...inventory, [key]: fromFirestoreValue(document.fields[key]) }), {});
    }

    async function saveInventoryToFirestore(office, inventory) {
        const response = await firestoreFetch(`${firestoreRestBase}/inventoryData/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: Object.keys(inventory).reduce((fields, key) => ({ ...fields, [key]: toFirestoreValue(inventory[key]) }), {}) })
        });
        await assertFirestoreResponse(response, "Firestore inventory write");
    }

    async function clearInventoryFromFirestore(office) {
        const response = await firestoreFetch(`${firestoreRestBase}/inventoryData/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        if (response.status !== 404) await assertFirestoreResponse(response, "Firestore inventory delete");
    }

    async function loadInventoryHistoryFromFirestore(office) {
        const response = await firestoreFetch(`${firestoreRestBase}/inventoryHistory/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, { cache: "no-store" });
        if (response.status === 404) return [];
        await assertFirestoreResponse(response, "Firestore inventory history read");
        const document = await response.json();
        return document.fields?.entries ? fromFirestoreValue(document.fields.entries) : [];
    }

    async function saveInventoryHistoryToFirestore(office, entries) {
        const response = await firestoreFetch(`${firestoreRestBase}/inventoryHistory/${encodeURIComponent(office)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { entries: toFirestoreValue(entries.slice(0, 200)) } })
        });
        await assertFirestoreResponse(response, "Firestore inventory history write");
    }

    async function loadTodoTasksFromFirestore() {
        const documents = await loadFirestoreCollection("todoTasks");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((task, key) => ({ ...task, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveTodoTaskToFirestore(task) {
        const fields = Object.keys(task).filter(key => key !== "id").reduce((result, key) => ({ ...result, [key]: toFirestoreValue(task[key]) }), {});
        const response = await firestoreFetch(`${firestoreRestBase}/todoTasks/${encodeURIComponent(task.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields })
        });
        await assertFirestoreResponse(response, "Firestore to-do task write");
    }

    const workspaceRequestsStorageKey = "workspaceRequests";

    function loadWorkspaceRequestsLocally() {
        const storedRequests = localStorage.getItem(workspaceRequestsStorageKey);
        if (!storedRequests) return [];

        const requests = JSON.parse(storedRequests);
        if (!Array.isArray(requests)) {
            throw new Error("Locally stored workspace requests are invalid.");
        }
        return requests;
    }

    function saveWorkspaceRequestLocally(request) {
        if (!request || typeof request.id !== "string" || !request.id) {
            throw new Error("A request ID is required to save a workspace request.");
        }

        const requests = loadWorkspaceRequestsLocally();
        const existingIndex = requests.findIndex(existingRequest => existingRequest.id === request.id);
        if (existingIndex >= 0) {
            requests[existingIndex] = request;
        } else {
            requests.push(request);
        }
        localStorage.setItem(workspaceRequestsStorageKey, JSON.stringify(requests));
    }

    function deleteWorkspaceRequestLocally(requestId) {
        if (typeof requestId !== "string" || !requestId) {
            throw new Error("A request ID is required to delete a workspace request.");
        }

        const requests = loadWorkspaceRequestsLocally();
        const remainingRequests = requests.filter(request => request.id !== requestId);
        if (remainingRequests.length === requests.length) {
            throw new Error("The selected workspace request could not be found.");
        }
        localStorage.setItem(workspaceRequestsStorageKey, JSON.stringify(remainingRequests));
    }

    function isLocalRequestTesting() {
        const hostname = window.location.hostname || "";
        return (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") &&
            !sessionStorage.getItem("firebaseAuthTokens");
    }

    async function deleteTodoTaskFromFirestore(taskId) {
        const response = await firestoreFetch(`${firestoreRestBase}/todoTasks/${encodeURIComponent(taskId)}?key=${firebaseConfig.apiKey}`, { method: "DELETE" });
        if (response.status !== 404) await assertFirestoreResponse(response, "Firestore to-do task delete");
    }

    async function loadOnlinePresenceFromFirestore() {
        const documents = await loadFirestoreCollection("onlinePresence");
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((entry, key) => ({ ...entry, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function saveOnlinePresenceToFirestore(sessionId, presence) {
        const fields = Object.keys(presence).reduce((result, key) => ({ ...result, [key]: toFirestoreValue(presence[key]) }), {});
        const response = await firestoreFetch(`${firestoreRestBase}/onlinePresence/${encodeURIComponent(sessionId)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields })
        });
        await assertFirestoreResponse(response, "Online presence write");
    }

    async function removeOnlinePresenceFromFirestore(sessionId) {
        const response = await firestoreFetch(`${firestoreRestBase}/onlinePresence/${encodeURIComponent(sessionId)}?key=${firebaseConfig.apiKey}`, {
            method: "DELETE",
            keepalive: true
        });
        if (response.status !== 404) await assertFirestoreResponse(response, "Online presence delete");
    }

    async function loadOnlineChatMessagesFromFirestore(chatId) {
        const documents = await loadFirestoreCollection(`onlineChats/${encodeURIComponent(chatId)}/messages`);
        return documents.map(document => ({
            id: document.name.split("/").pop(),
            ...Object.keys(document.fields || {}).reduce((message, key) => ({ ...message, [key]: fromFirestoreValue(document.fields[key]) }), {})
        }));
    }

    async function loadOnlineChatMessages(chatId) {
        if (isLocalRequestTesting()) return loadOnlineChatMessagesFromFirestore(chatId);
        const result = await window.firebaseAuthSession.api(`/chats/${encodeURIComponent(chatId)}/messages`, { method: "GET" });
        if (!Array.isArray(result.messages)) throw new Error("The chat service returned an invalid message list.");
        return result.messages;
    }

    async function saveOnlineChatMessageToFirestore(chatId, message) {
        const fields = Object.keys(message).filter(key => key !== "id").reduce((result, key) => ({ ...result, [key]: toFirestoreValue(message[key]) }), {});
        const response = await firestoreFetch(`${firestoreRestBase}/onlineChats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(message.id)}?key=${firebaseConfig.apiKey}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields })
        });
        await assertFirestoreResponse(response, "Online chat message write");
    }

    async function saveOnlineChatMessage(chatId, message) {
        if (isLocalRequestTesting()) return saveOnlineChatMessageToFirestore(chatId, message);
        await window.firebaseAuthSession.api(`/chats/${encodeURIComponent(chatId)}/messages`, {
            method: "POST",
            body: JSON.stringify(message)
        });
    }

    window.sharedAttendance = {
        ready: Promise.resolve(),
        async load() {
            return loadAttendanceFromFirestore();
        },
        async save(records) {
            const normalizedRecords = Object.entries(records).reduce((normalized, [key, record]) => ({
                ...normalized,
                [key]: { ...record, date: record.date || key.split(":")[0] }
            }), {});
            return saveAttendanceToFirestore(normalizedRecords);
        },
        async loadHistory() {
            return loadAttendanceHistoryFromFirestore();
        },
        async saveHistory(entry) {
            return saveAttendanceHistoryToFirestore(entry);
        },
        async loadTasks() {
            return loadAttendanceTasksFromFirestore();
        },
        async saveTasks(tasks) {
            return saveAttendanceTasksToFirestore(tasks);
        },
        async clearDate(date) {
            return clearAttendanceFromFirestore(date);
        },
        async clearRange(start, end) {
            return clearAttendanceRangeFromFirestore(start, end);
        },
        async loadAccounts() {
            if (!isLocalRequestTesting() && window.firebaseAuthSession) {
                const result = await window.firebaseAuthSession.api("/accounts", { method: "GET" });
                if (!result.accounts || typeof result.accounts !== "object") throw new Error("The account service returned an invalid account list.");
                return result.accounts;
            }
            return loadAccountsFromFirestore();
        },
        async saveAccounts(accounts) {
            if (!isLocalRequestTesting() && window.firebaseAuthSession) {
                const result = await window.firebaseAuthSession.api("/accounts", {
                    method: "PUT",
                    body: JSON.stringify({ accounts })
                });
                if (!result.accounts) throw new Error("The account service did not return the saved accounts.");
                return result.accounts;
            }
            return saveAccountsToFirestore(accounts);
        },
        async deleteAccount(username) {
            if (!isLocalRequestTesting() && window.firebaseAuthSession) {
                return window.firebaseAuthSession.api(`/accounts/${encodeURIComponent(username)}`, { method: "DELETE" });
            }
            return deleteAccountFromFirestore(username);
        }
    };

    window.sharedInventory = {
        ready: Promise.resolve(),
        load: office => loadInventoryFromFirestore(office),
        save: (office, inventory) => saveInventoryToFirestore(office, inventory),
        clear: office => clearInventoryFromFirestore(office),
        loadHistory: office => loadInventoryHistoryFromFirestore(office),
        saveHistory: (office, entries) => saveInventoryHistoryToFirestore(office, entries)
    };

    window.sharedTodoList = {
        ready: Promise.resolve(),
        load: () => loadTodoTasksFromFirestore(),
        save: task => saveTodoTaskToFirestore(task),
        delete: taskId => deleteTodoTaskFromFirestore(taskId)
    };

    window.sharedRequests = {
        ready: Promise.resolve(),
        storageKey: workspaceRequestsStorageKey,
        async load() {
            if (isLocalRequestTesting()) return loadWorkspaceRequestsLocally();
            const result = await window.firebaseAuthSession.api("/requests", { method: "GET" });
            if (!Array.isArray(result.requests)) throw new Error("The request service returned an invalid response.");
            return result.requests;
        },
        async create(request) {
            if (isLocalRequestTesting()) {
                saveWorkspaceRequestLocally(request);
                return request;
            }
            const result = await window.firebaseAuthSession.api("/requests", {
                method: "POST",
                body: JSON.stringify(request)
            });
            if (!result.request) throw new Error("The request service did not confirm the saved request.");
            return result.request;
        },
        async save(request) {
            if (isLocalRequestTesting()) {
                saveWorkspaceRequestLocally(request);
                return;
            }
            if (!request || typeof request.id !== "string" || !request.id) {
                throw new Error("A request ID is required to update a workspace request.");
            }
            await window.firebaseAuthSession.api(`/requests/${encodeURIComponent(request.id)}`, {
                method: "PATCH",
                body: JSON.stringify(request)
            });
        },
        async delete(requestId) {
            if (isLocalRequestTesting()) {
                deleteWorkspaceRequestLocally(requestId);
                return;
            }
            await window.firebaseAuthSession.api(`/requests/${encodeURIComponent(requestId)}`, { method: "DELETE" });
        }
    };

    window.sharedOnlinePresence = {
        ready: Promise.resolve(),
        load: () => loadOnlinePresenceFromFirestore(),
        save: (sessionId, presence) => saveOnlinePresenceToFirestore(sessionId, presence),
        remove: sessionId => removeOnlinePresenceFromFirestore(sessionId)
    };

    window.sharedOnlineChat = {
        ready: Promise.resolve(),
        load: chatId => loadOnlineChatMessages(chatId),
        send: (chatId, message) => saveOnlineChatMessage(chatId, message)
    };

    window.sharedAnnouncements = {
        send: announcement => saveAnnouncementToFirestore(announcement),
        loadSince: timestamp => loadAnnouncementsFromFirestore(timestamp)
    };

    window.sharedAccounts = {
        ready: window.sharedAttendance.ready,
        load: () => window.sharedAttendance.loadAccounts(),
        save: accounts => window.sharedAttendance.saveAccounts(accounts),
        saveOne: (username, account) => isLocalRequestTesting()
            ? saveAccountToFirestore(username, account)
            : window.firebaseAuthSession.api(`/accounts/${encodeURIComponent(username)}`, {
                method: "POST",
                body: JSON.stringify({ account })
            }),
        saveTheme: (username, theme) => isLocalRequestTesting()
            ? saveAccountThemeToFirestore(username, theme)
            : window.firebaseAuthSession.api("/account/theme", {
                method: "PATCH",
                body: JSON.stringify({ theme })
            }),
        delete: username => window.sharedAttendance.deleteAccount(username)
    };
})();
