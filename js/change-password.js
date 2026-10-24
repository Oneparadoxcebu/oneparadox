(function () {
    "use strict";

    const menuButton = document.getElementById("changePasswordMenuBtn");
    const modal = document.getElementById("changePasswordModal");
    const saveButton = document.getElementById("savePasswordBtn");
    const cancelButton = document.getElementById("cancelPasswordBtn");
    const newInput = document.getElementById("newPasswordInput");
    const confirmInput = document.getElementById("confirmPasswordInput");

    if (!menuButton || !modal || !saveButton || !cancelButton || !newInput || !confirmInput) return;

    function closeModal() {
        modal.classList.remove("active");
        modal.style.display = "none";
        newInput.value = "";
        confirmInput.value = "";
        if (new URLSearchParams(window.location.search).get("changePassword") === "1" && window.parent !== window) {
            window.parent.postMessage({ type: "closePasswordOverlay" }, "*");
        }
    }

    menuButton.addEventListener("click", () => {
        if (document.getElementById("inventoryPasswordOverlay")) return;
        modal.classList.add("active");
        modal.style.display = "flex";
        newInput.focus();
    });
    cancelButton.addEventListener("click", closeModal);
    modal.addEventListener("click", event => {
        if (event.target === modal) closeModal();
    });

    saveButton.addEventListener("click", async () => {
        const newPassword = newInput.value;
        if (!newPassword || newPassword !== confirmInput.value) {
            alert("Enter matching new passwords.");
            return;
        }
        if (newPassword.length < 6) {
            alert("The new password must be at least 6 characters.");
            return;
        }

        try {
            await window.authSession.ready;
            const user = window.firebaseAuth.currentUser;
            if (!user) throw new Error("You must be signed in to change your password.");
            await user.updatePassword(newPassword);
        } catch (error) {
            console.error("Firebase password change failed.", error);
            const message = error.code === "auth/requires-recent-login"
                ? "For security, sign out and sign in again before changing your password."
                : error.message || "Please try again.";
            alert(`The password could not be saved. ${message}`);
            return;
        }

        closeModal();
        alert("Password changed successfully.");
    });
})();
