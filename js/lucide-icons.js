(function () {
    "use strict";

    const iconMap = {
        "bi-1-circle": "server",
        "bi-2-circle": "server",
        "bi-3-circle": "server",
        "bi-arrow-clockwise": "refresh-cw",
        "bi-arrow-repeat": "refresh-cw",
        "bi-arrow-right": "arrow-right",
        "bi-bar-chart-line": "chart-no-axes-column-increasing",
        "bi-box": "box",
        "bi-box-arrow-in-right": "log-in",
        "bi-box-arrow-right": "log-out",
        "bi-boxes": "boxes",
        "bi-box-seam": "package-open",
        "bi-calendar2-check": "calendar-check-2",
        "bi-calendar3": "calendar-days",
        "bi-calendar-check": "calendar-check-2",
        "bi-check2-circle": "circle-check",
        "bi-check-all": "list-checks",
        "bi-check-circle": "circle-check",
        "bi-check-circle-fill": "circle-check",
        "bi-clock": "clock-3",
        "bi-clock-history": "history",
        "bi-download": "download",
        "bi-exclamation-triangle": "triangle-alert",
        "bi-eye": "eye",
        "bi-eye-slash": "eye-off",
        "bi-fullscreen": "maximize",
        "bi-geo-alt": "map-pin",
        "bi-graph-up-arrow": "chart-no-axes-combined",
        "bi-inbox": "inbox",
        "bi-key": "key-round",
        "bi-list": "menu",
        "bi-list-check": "list-checks",
        "bi-megaphone": "megaphone",
        "bi-moon-stars-fill": "moon-star",
        "bi-pencil-square": "square-pen",
        "bi-people": "users-round",
        "bi-person-check": "user-round-check",
        "bi-person-dash": "user-round-minus",
        "bi-person-plus": "user-round-plus",
        "bi-plus-circle": "circle-plus",
        "bi-plus-lg": "plus",
        "bi-question-circle": "circle-help",
        "bi-router": "router",
        "bi-send": "send",
        "bi-shield-lock": "shield-check",
        "bi-sun-fill": "sun",
        "bi-trash": "trash-2",
        "bi-trash3": "trash-2",
        "bi-upload": "upload",
        "bi-x-circle": "circle-x",
        "bi-x-lg": "x"
    };

    const svgAttributes = {
        width: "1em",
        height: "1em",
        "stroke-width": "1.8",
        focusable: "false"
    };

    function getBootstrapIcon(element) {
        return Array.from(element.classList).find(className => className.startsWith("bi-") && className !== "bi");
    }

    function collectIcons(root) {
        const icons = [];
        if (!root || root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return icons;
        if (root.nodeType === Node.ELEMENT_NODE && root.classList.contains("bi")) icons.push(root);
        if (root.querySelectorAll) icons.push(...root.querySelectorAll(".bi"));
        return icons;
    }

    function createLucidePlaceholder(element) {
        const bootstrapClass = getBootstrapIcon(element);
        const iconName = iconMap[bootstrapClass] || "circle-help";
        const wrapper = document.createElement("span");
        const retainedClasses = Array.from(element.classList).filter(className => className !== "bi" && !className.startsWith("bi-"));
        wrapper.classList.add("app-icon", ...retainedClasses);

        Array.from(element.attributes).forEach(attribute => {
            if (attribute.name !== "class") wrapper.setAttribute(attribute.name, attribute.value);
        });
        if (!wrapper.hasAttribute("aria-hidden") && !wrapper.hasAttribute("aria-label")) {
            wrapper.setAttribute("aria-hidden", "true");
        }
        wrapper.dataset.lucideIcon = iconName;

        const placeholder = document.createElement("i");
        placeholder.setAttribute("data-lucide", iconName);
        wrapper.append(placeholder);
        element.replaceWith(wrapper);
        return wrapper;
    }

    function renderIcons(root) {
        const replacements = collectIcons(root).map(createLucidePlaceholder);
        if (replacements.length && window.lucide?.createIcons) {
            window.lucide.createIcons({ icons: window.lucide.icons, attrs: svgAttributes, root: document });
        }
    }

    window.setLucideIcon = function (element, iconName) {
        const wrapper = element?.closest?.(".app-icon") || element;
        if (!wrapper?.classList?.contains("app-icon") || !window.lucide?.createIcons) return;

        wrapper.dataset.lucideIcon = iconName;
        const placeholder = document.createElement("i");
        placeholder.setAttribute("data-lucide", iconName);
        wrapper.replaceChildren(placeholder);
        window.lucide.createIcons({ icons: window.lucide.icons, attrs: svgAttributes, root: wrapper });
    };

    function observeDynamicIcons() {
        renderIcons(document);
        const observer = new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => renderIcons(node)));
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", observeDynamicIcons, { once: true });
    } else {
        observeDynamicIcons();
    }
})();
