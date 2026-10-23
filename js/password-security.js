(function () {
    const ALGORITHM = "PBKDF2";
    const HASH_NAME = "SHA-256";
    const ITERATIONS = 120000;

    function toBase64Url(bytes) {
        let binary = "";
        bytes.forEach(byte => { binary += String.fromCharCode(byte); });
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    }

    function fromBase64Url(value) {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
        return Uint8Array.from(binary, character => character.charCodeAt(0));
    }

    function timingSafeEqual(left, right) {
        if (left.length !== right.length) return false;
        let difference = 0;
        for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
        return difference === 0;
    }

    async function derive(password, salt, iterations) {
        const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), ALGORITHM, false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits({ name: ALGORITHM, salt, iterations, hash: HASH_NAME }, keyMaterial, 256);
        return new Uint8Array(bits);
    }

    window.passwordSecurity = {
        async hash(password) {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const hash = await derive(password, salt, ITERATIONS);
            return `pbkdf2$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
        },
        async verify(password, storedPassword) {
            if (!String(storedPassword || "").startsWith("pbkdf2$")) return storedPassword === password;
            const [, iterationText, saltText, hashText] = storedPassword.split("$");
            const expected = fromBase64Url(hashText);
            const actual = await derive(password, fromBase64Url(saltText), Number(iterationText));
            return timingSafeEqual(actual, expected);
        }
    };
})();
