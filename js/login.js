(function () {
    "use strict";

    const form = document.getElementById("form1");
    const usernameInput = document.getElementById("UsernameInput");
    const passwordInput = document.getElementById("PasswordInput");
    const message = document.getElementById("divMessage");
    const passwordToggle = document.getElementById("togglePasswordIcon");
    const signInButton = document.getElementById("SignInButton");

    function showError(text) {
        message.textContent = text;
        message.style.color = "red";
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const login = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!login || !password) {
            showError("Enter your email address and password.");
            return;
        }
        if (!login.includes("@")) {
            showError("Sign in with your email address. Username sign-in requires Firebase Functions and is unavailable on the free plan.");
            return;
        }

        signInButton.disabled = true;
        message.textContent = "";
        try {
            await window.firebaseAuth.signInWithEmailAndPassword(login.toLowerCase(), password);
        } catch (error) {
            console.error("Sign-in failed.", error);
            const messageByCode = {
                "auth/invalid-credential": "Email or password is incorrect.",
                "auth/user-not-found": "Email or password is incorrect.",
                "auth/wrong-password": "Email or password is incorrect.",
                "auth/invalid-email": "Enter a valid email address.",
                "functions/unauthenticated": "Username or password is incorrect.",
                "functions/not-found": "Username sign-in is not configured. Sign in with your email or contact your administrator.",
                "functions/unavailable": "The sign-in service is temporarily unavailable. Try again later.",
                "auth/user-disabled": "This account has been disabled. Contact your administrator.",
                "auth/too-many-requests": "Too many sign-in attempts. Try again later.",
                "auth/network-request-failed": "Could not connect to Firebase. Check your connection."
            };
            showError(messageByCode[error.code] || "Sign-in failed. Check your credentials and Firebase setup.");
            signInButton.disabled = false;
        }
    });

    passwordToggle?.addEventListener("click", () => {
        const reveal = passwordInput.type === "password";
        passwordInput.type = reveal ? "text" : "password";
        window.setLucideIcon?.(passwordToggle, reveal ? "eye-off" : "eye");
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "profile") {
        showError("This account is not enabled for the app. Contact your administrator.");
    }
})();
