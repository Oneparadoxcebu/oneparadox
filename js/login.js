(function () {
    "use strict";

    const form = document.getElementById("form1");
    const emailInput = document.getElementById("UsernameInput");
    const passwordInput = document.getElementById("PasswordInput");
    const message = document.getElementById("divMessage");
    const passwordToggle = document.getElementById("togglePasswordIcon");
    const showPasswordIcon = document.getElementById("showPasswordIcon");
    const hidePasswordIcon = document.getElementById("hidePasswordIcon");
    const signInButton = document.getElementById("SignInButton");

    function showError(text) {
        message.textContent = text;
        message.style.color = "red";
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (!email || !password) {
            showError("Enter your email address and password.");
            return;
        }

        signInButton.disabled = true;
        message.textContent = "";
        try {
            await window.firebaseAuth.signInWithEmailAndPassword(email.toLowerCase(), password);
        } catch (error) {
            console.error("Sign-in failed.", error);
            const errorCode = String(error?.code || "").toLowerCase();
            const errorMessage = String(error?.message || "").toLowerCase();
            const invalidCredentials =
                ["auth/invalid-credential", "auth/invalid-login-credentials", "auth/user-not-found", "auth/wrong-password"]
                    .includes(errorCode) ||
                /invalid[ _-]?(login[ _-]?)?credentials|invalid[ _-]?password|wrong[ _-]?password|email[ _-]?not[ _-]?found/.test(errorMessage);
            const messageByCode = {
                "auth/invalid-credential": "Email or password is incorrect.",
                "auth/invalid-login-credentials": "Email or password is incorrect.",
                "auth/user-not-found": "Email or password is incorrect.",
                "auth/wrong-password": "Email or password is incorrect.",
                "auth/invalid-email": "Enter a valid email address.",
                "auth/unauthorized-domain": "This website is not authorized to sign in with Firebase. Add oneparadoxcebu.github.io in Firebase Console under Authentication > Settings > Authorized domains.",
                "auth/operation-not-allowed": "Email/password sign-in is disabled. Enable the Email/Password provider in Firebase Console under Authentication > Sign-in method.",
                "auth/configuration-not-found": "Firebase Authentication is not configured for this project. Check the Authentication setup in Firebase Console.",
                "auth/user-disabled": "This account has been disabled. Contact your administrator.",
                "auth/too-many-requests": "Too many sign-in attempts. Try again later.",
                "auth/network-request-failed": "Could not connect to Firebase. Check your connection."
            };
            showError(invalidCredentials
                ? "Email or password is incorrect."
                : messageByCode[errorCode] || "Sign-in failed. Check your credentials and Firebase setup.");
            signInButton.disabled = false;
        }
    });

    passwordToggle?.addEventListener("click", event => {
        event.preventDefault();
        const reveal = passwordInput.type === "password";
        passwordInput.type = reveal ? "text" : "password";
        passwordToggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
        passwordToggle.setAttribute("aria-pressed", String(reveal));
        showPasswordIcon.hidden = reveal;
        hidePasswordIcon.hidden = !reveal;
    });

    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "profile") {
        showError("This account is not enabled for the app. Contact your administrator.");
    }
})();
