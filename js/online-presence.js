(function () {
    "use strict";

    if (window.self !== window.top || !window.sharedOnlinePresence) return;

    const HEARTBEAT_INTERVAL_MS = 60000;
    const ONLINE_WINDOW_MS = 180000;
    const OFFICES = ["Rizal", "Cebu"];
    const username = localStorage.getItem("loggedInUser") || sessionStorage.getItem("loggedInUser");
    const accounts = JSON.parse(localStorage.getItem("userAccounts") || "{}");
    const account = accounts[username];
    const navigation = document.querySelector(".navbar .navbar-nav");
    const userItem = document.getElementById("userDisplay")?.closest(".nav-item");

    if (!username || !account || account.disabled || !navigation || !userItem) return;

    const sessionId = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const displayName = account.name || username;
    const isDeveloper = account.role === "Developer" || username.toLowerCase() === "admin";
    const permissions = new Set(Array.isArray(account.permissions) ? account.permissions : []);
    const userChatOffices = isDeveloper
        ? [...OFFICES]
        : OFFICES.filter(office => permissions.has(`chat${office}`));
    const inventoryAccess = Array.isArray(account.inventoryAccess)
        ? account.inventoryAccess
        : account.office
            ? [account.office]
            : [];
    const officeName = String(account.office || "").toLowerCase();
    let userOffices = OFFICES.filter(office => inventoryAccess.includes(office));
    if (officeName === "both" || officeName === "both offices") userOffices = [...OFFICES];
    if (!userOffices.length && isDeveloper) userOffices = [...OFFICES];
    if (!userOffices.length && userChatOffices.length) userOffices = [...userChatOffices];
    if (!userOffices.length) userOffices = ["Unassigned"];

    const navigationItem = document.createElement("li");
    navigationItem.className = "nav-item online-presence-item";
    navigationItem.innerHTML = `
        <button class="online-presence-button" id="onlinePresenceToggle" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="onlinePresencePanel">
            <span class="online-presence-dot" aria-hidden="true"></span>
            <span class="online-presence-label">Online</span>
            <span class="online-presence-count" data-office-count="Rizal">Rizal <b>--</b></span>
            <span class="online-presence-count" data-office-count="Cebu">Cebu <b>--</b></span>
        </button>
        <section class="online-presence-panel" id="onlinePresencePanel" role="dialog" aria-label="Online people" hidden>
            <header class="online-presence-heading">
                <div><strong>Online now</strong><span id="onlinePresenceSummary">Checking presence...</span></div>
                <button class="online-presence-close" type="button" aria-label="Close online people">&times;</button>
            </header>
            <div class="online-presence-tabs" role="tablist" aria-label="Office">
                <button type="button" role="tab" data-office-tab="Rizal" aria-selected="false">Rizal <span data-panel-count="Rizal">--</span></button>
                <button type="button" role="tab" data-office-tab="Cebu" aria-selected="false">Cebu <span data-panel-count="Cebu">--</span></button>
                <button type="button" role="tab" data-office-tab="Unassigned" aria-selected="false" hidden>Unassigned <span data-panel-count="Unassigned">--</span></button>
            </div>
            <div class="online-presence-list" id="onlinePresenceList" role="tabpanel" aria-live="polite"></div>
        </section>`;
    navigation.insertBefore(navigationItem, userItem);

    const chatWindow = document.createElement("section");
    chatWindow.className = "online-chat-window";
    chatWindow.id = "onlineChatWindow";
    chatWindow.setAttribute("role", "dialog");
    chatWindow.setAttribute("aria-label", "Direct chat");
    chatWindow.hidden = true;
    chatWindow.innerHTML = `
        <header class="online-chat-heading">
            <div class="online-chat-title-group"><span class="online-presence-live-dot" aria-hidden="true"></span><div><strong id="onlineChatName">Chat</strong><small id="onlineChatUsername"></small></div></div>
            <div class="online-chat-window-controls"><button class="online-chat-minimize" type="button" aria-label="Minimize chat" title="Minimize"><i class="bi bi-dash-lg" aria-hidden="true"></i></button><button class="online-chat-close" type="button" aria-label="Close chat" title="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
        </header>
        <div class="online-chat-content">
            <div class="online-chat-messages" id="onlineChatMessages" aria-live="polite"></div>
            <p class="online-chat-status" id="onlineChatStatus" role="status" hidden></p>
            <form class="online-chat-compose" id="onlineChatCompose"><input id="onlineChatInput" type="text" maxlength="1000" placeholder="Write a message..." aria-label="Message" autocomplete="off" required><button type="submit" aria-label="Send message" title="Send"><i class="bi bi-send-fill" aria-hidden="true"></i></button></form>
        </div>`;
    document.body.append(chatWindow);

    const toggleButton = navigationItem.querySelector("#onlinePresenceToggle");
    const panel = navigationItem.querySelector("#onlinePresencePanel");
    const peopleList = navigationItem.querySelector("#onlinePresenceList");
    const summary = navigationItem.querySelector("#onlinePresenceSummary");
    const chatName = chatWindow.querySelector("#onlineChatName");
    const chatUsername = chatWindow.querySelector("#onlineChatUsername");
    const chatMessages = chatWindow.querySelector("#onlineChatMessages");
    const chatStatus = chatWindow.querySelector("#onlineChatStatus");
    const chatInput = chatWindow.querySelector("#onlineChatInput");
    let selectedOffice = userChatOffices.includes(userOffices[0]) ? userOffices[0] : (userChatOffices[0] || userOffices[0] || "Rizal");
    let cachedOnlinePeople = [];
    let presenceAvailable = false;
    let presenceErrorMessage = "Online status is unavailable. Check the onlinePresence Firestore rule and Firebase quota.";
    let requestInProgress = false;
    let consecutivePresenceFailures = 0;
    let retryPresenceAfter = 0;
    let activeChatId = "";
    let activeChatPerson = null;
    let activeChatOffice = "";
    let chatOpenRequest = 0;
    let chatRequestInProgress = false;

    function setOpen(isOpen) {
        panel.hidden = !isOpen;
        toggleButton.setAttribute("aria-expanded", String(isOpen));
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    async function createChatId(otherUsername, office) {
        const pair = `${String(office).toLowerCase()}|${[username.toLowerCase(), String(otherUsername).toLowerCase()].sort().join("|")}`;
        if (window.crypto?.subtle && window.TextEncoder) {
            const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(pair));
            return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
        }
        let hash = 2166136261;
        for (let index = 0; index < pair.length; index += 1) {
            hash ^= pair.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `pair-${(hash >>> 0).toString(16)}`;
    }

    function setChatStatus(message, isError = false) {
        chatStatus.textContent = message;
        chatStatus.hidden = !message;
        chatStatus.dataset.kind = isError ? "error" : "info";
    }

    function renderChatMessages(messages) {
        const sortedMessages = [...messages].sort((first, second) => Number(first.createdAt) - Number(second.createdAt));
        chatMessages.replaceChildren();
        if (!sortedMessages.length) {
            const empty = document.createElement("p");
            empty.className = "online-chat-empty";
            empty.textContent = `Start a conversation with ${activeChatPerson?.name || "this person"}.`;
            chatMessages.append(empty);
            return;
        }

        sortedMessages.forEach(message => {
            const bubble = document.createElement("article");
            bubble.className = `online-chat-message${String(message.senderUsername).toLowerCase() === username.toLowerCase() ? " is-mine" : ""}`;
            const text = document.createElement("p");
            text.textContent = message.text || "";
            const time = document.createElement("time");
            const timestamp = Number(message.createdAt);
            time.textContent = Number.isFinite(timestamp)
                ? new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "";
            bubble.append(text, time);
            chatMessages.append(bubble);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function refreshChat() {
        if (!activeChatId || chatWindow.hidden || chatRequestInProgress) return;
        chatRequestInProgress = true;
        try {
            const messages = await window.sharedOnlineChat.load(activeChatId);
            if (!chatWindow.hidden && activeChatId) {
                renderChatMessages(messages);
                setChatStatus("");
            }
        } catch (error) {
            setChatStatus("Chat is unavailable. Check the onlineChats Firestore rule and Firebase quota.", true);
            console.warn("Online chat could not be refreshed.", error);
        } finally {
            chatRequestInProgress = false;
        }
    }

    async function openChatWith(person) {
        if (!person?.username || String(person.username).toLowerCase() === username.toLowerCase()) return;
        if (!userChatOffices.includes(selectedOffice) || !Array.isArray(person.chatOffices) || !person.chatOffices.includes(selectedOffice)) return;
        const requestId = ++chatOpenRequest;
        activeChatPerson = person;
        activeChatOffice = selectedOffice;
        activeChatId = "";
        chatWindow.hidden = false;
        chatWindow.classList.remove("is-minimized");
        chatName.textContent = person.name || person.username;
        chatUsername.textContent = `@${person.username} · ${activeChatOffice} Chat`;
        setChatStatus("Loading messages...");
        peopleList.replaceChildren();
        setOpen(false);
        chatInput.focus();
        try {
            const chatId = await createChatId(person.username, activeChatOffice);
            if (requestId !== chatOpenRequest) return;
            activeChatId = chatId;
            await refreshChat();
        } catch (error) {
            setChatStatus("Unable to open this chat. Try again.", true);
            console.warn("Online chat could not be opened.", error);
        }
    }

    function peopleForOffice(office, requireChatAccess = false) {
        const newestByUsername = new Map();
        cachedOnlinePeople.forEach(person => {
            const assignedOffices = Array.isArray(person.offices) && person.offices.length
                ? person.offices
                : [person.office || "Unassigned"];
            if (!assignedOffices.includes(office)) return;
            if (requireChatAccess && (!userChatOffices.includes(office) || !Array.isArray(person.chatOffices) || !person.chatOffices.includes(office))) return;
            const key = String(person.username || person.id);
            const previous = newestByUsername.get(key);
            if (!previous || Number(person.lastSeen) > Number(previous.lastSeen)) newestByUsername.set(key, person);
        });
        return [...newestByUsername.values()].sort((first, second) => String(first.name || first.username).localeCompare(String(second.name || second.username)));
    }

    function renderPeople() {
        ["Rizal", "Cebu", "Unassigned"].forEach(office => {
            const count = peopleForOffice(office).length;
            navigationItem.querySelector(`[data-office-count="${office}"] b`)?.replaceChildren(document.createTextNode(presenceAvailable ? String(count) : "--"));
            const panelCount = navigationItem.querySelector(`[data-panel-count="${office}"]`);
            if (panelCount) panelCount.textContent = presenceAvailable ? String(count) : "--";
        });

        const total = new Set(cachedOnlinePeople.map(person => String(person.username || person.id))).size;
        summary.textContent = presenceAvailable
            ? `${total} ${total === 1 ? "person" : "people"} online`
            : "Presence unavailable";

        const hasOfficeChat = userChatOffices.includes(selectedOffice);
        const people = presenceAvailable && hasOfficeChat ? peopleForOffice(selectedOffice, true) : [];
        peopleList.replaceChildren();
        if (!presenceAvailable) {
            const message = document.createElement("p");
            message.className = "online-presence-empty";
            message.textContent = presenceErrorMessage;
            peopleList.append(message);
            return;
        }
        if (!hasOfficeChat) {
            const message = document.createElement("p");
            message.className = "online-presence-empty";
            message.textContent = `You do not have access to the ${selectedOffice} chat.`;
            peopleList.append(message);
            return;
        }
        if (!people.length) {
            const message = document.createElement("p");
            message.className = "online-presence-empty";
            message.textContent = `No one is online in ${selectedOffice}.`;
            peopleList.append(message);
            return;
        }

        people.forEach(person => {
            const item = document.createElement("button");
            item.className = "online-presence-person";
            item.type = "button";
            const isSelf = String(person.username).toLowerCase() === username.toLowerCase();
            item.disabled = isSelf;
            item.title = isSelf ? "You are online" : `Chat with ${person.name || person.username}`;
            const identity = document.createElement("span");
            identity.className = "online-presence-person-icon";
            identity.setAttribute("aria-hidden", "true");
            identity.textContent = String(person.name || person.username || "?").trim().charAt(0).toUpperCase();
            const details = document.createElement("span");
            details.className = "online-presence-person-details";
            const name = document.createElement("strong");
            name.textContent = person.name || person.username || "User";
            const user = document.createElement("small");
            user.textContent = `@${person.username || "unknown"}`;
            details.append(name, user);
            const status = document.createElement("span");
            status.className = "online-presence-live-dot";
            status.setAttribute("aria-label", "Online");
            item.append(identity, details, status);
            if (!isSelf) item.addEventListener("click", () => void openChatWith(person));
            peopleList.append(item);
        });
    }

    function setOffice(office) {
        if (!userChatOffices.includes(office)) return;
        selectedOffice = office;
        navigationItem.querySelectorAll("[data-office-tab]").forEach(tab => {
            tab.setAttribute("aria-selected", String(tab.dataset.officeTab === office));
        });
        renderPeople();
    }

    navigationItem.querySelectorAll("[data-office-tab]").forEach(tab => {
        tab.hidden = !userChatOffices.includes(tab.dataset.officeTab);
        tab.setAttribute("aria-selected", String(tab.dataset.officeTab === selectedOffice));
    });

    async function refreshPresence() {
        if (requestInProgress || Date.now() < retryPresenceAfter) return;
        requestInProgress = true;
        try {
            await window.sharedOnlinePresence.save(sessionId, {
                username,
                name: displayName,
                role: account.role || "User",
                offices: userOffices,
                chatOffices: userChatOffices,
                lastSeen: Date.now()
            });
            const now = Date.now();
            const records = await window.sharedOnlinePresence.load();
            cachedOnlinePeople = records.filter(person => Number(person.lastSeen) >= now - ONLINE_WINDOW_MS);
            presenceAvailable = true;
            consecutivePresenceFailures = 0;
            retryPresenceAfter = 0;
            renderPeople();
        } catch (error) {
            presenceAvailable = false;
            consecutivePresenceFailures += 1;
            retryPresenceAfter = Date.now() + Math.min(300000, 30000 * (2 ** Math.min(consecutivePresenceFailures - 1, 3)));
            const errorText = String(error?.message || "");
            presenceErrorMessage = /403|permission|denied/i.test(errorText)
                ? "Firestore denied online status. Publish the onlinePresence rule, then reload."
                : /429|quota|rate limit/i.test(errorText)
                    ? "Firebase is rate-limiting presence updates. Try again shortly."
                    : "Online status is unavailable. Check your connection and Firebase setup.";
            renderPeople();
            console.warn("Online presence could not be synchronized.", error);
        } finally {
            requestInProgress = false;
        }
    }

    toggleButton.addEventListener("click", () => setOpen(panel.hidden));
    navigationItem.querySelector(".online-presence-close").addEventListener("click", () => setOpen(false));
    navigationItem.querySelectorAll("[data-office-tab]").forEach(tab => {
        tab.addEventListener("click", () => setOffice(tab.dataset.officeTab));
    });
    chatWindow.querySelector(".online-chat-minimize").addEventListener("click", event => {
        const minimized = chatWindow.classList.toggle("is-minimized");
        event.currentTarget.setAttribute("aria-label", minimized ? "Restore chat" : "Minimize chat");
        event.currentTarget.title = minimized ? "Restore" : "Minimize";
    });
    chatWindow.querySelector(".online-chat-close").addEventListener("click", () => {
        chatOpenRequest += 1;
        chatWindow.hidden = true;
        activeChatId = "";
        activeChatPerson = null;
        activeChatOffice = "";
    });
    chatWindow.querySelector("#onlineChatCompose").addEventListener("submit", async event => {
        event.preventDefault();
        const text = chatInput.value.trim();
        if (!text || !activeChatId || !activeChatPerson) return;
        const sendButton = event.currentTarget.querySelector("button[type=submit]");
        sendButton.disabled = true;
        try {
            const messageId = window.crypto?.randomUUID
                ? window.crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            await window.sharedOnlineChat.send(activeChatId, {
                id: messageId,
                senderUsername: username,
                senderName: displayName,
                recipientUsername: activeChatPerson.username,
                office: activeChatOffice,
                text,
                createdAt: Date.now()
            });
            chatInput.value = "";
            setChatStatus("");
            await refreshChat();
        } catch (error) {
            setChatStatus("Message could not be sent. Check the onlineChats Firestore rule and Firebase quota.", true);
            console.warn("Online chat message could not be sent.", error);
        } finally {
            sendButton.disabled = false;
            chatInput.focus();
        }
    });
    document.addEventListener("pointerdown", event => {
        if (!panel.hidden && !navigationItem.contains(event.target)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") setOpen(false);
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void refreshPresence();
    });
    window.addEventListener("pagehide", () => {
        void window.sharedOnlinePresence.remove(sessionId).catch(() => {});
    }, { once: true });

    setOffice(selectedOffice);
    void refreshPresence();
    window.setInterval(() => void refreshPresence(), HEARTBEAT_INTERVAL_MS);
    window.setInterval(() => void refreshChat(), 4000);
})();
