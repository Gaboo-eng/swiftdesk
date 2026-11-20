import { firebaseReady } from "./firebase-client.js";
import { initializeThemeToggle } from "./theme.js";

const resetForm = document.querySelector("#reset-form");
const resetMessage = document.querySelector("#reset-message");
const resetStatus = document.querySelector("#reset-status");
const resetEmail = document.querySelector("#reset-email");
const resetSuccess = document.querySelector("#reset-success");
const backToLogin = document.querySelector("#back-to-login");
const resetTitle = document.querySelector("#reset-title");
const resetIntro = document.querySelector(".reset-intro");
const submitButton = resetForm.querySelector('button[type="submit"]');
const submitLabel = submitButton.querySelector(".button-label");
const passwordInput = document.querySelector("#new-password");
const confirmationInput = document.querySelector("#confirm-password");
const strengthMeter = document.querySelector(".password-strength");
const strengthLabel = document.querySelector("#password-strength-label");
const passwordGuidance = document.querySelector("#password-guidance");
const passwordMatch = document.querySelector("#password-match");
const actionParams = new URLSearchParams(window.location.search);
const actionMode = actionParams.get("mode");
const actionCode = actionParams.get("oobCode");
const strengthSegments = [...strengthMeter.children];
let firebase = null;

initializeThemeToggle();

function showMessage(message, state = "loading") {
  resetMessage.textContent = message;
  resetStatus.className = `reset-status is-${state}`;
}

function humanizeResetError(error) {
  const messages = {
    "auth/expired-action-code": "Este enlace de recuperación expiró. Solicita uno nuevo desde el inicio de sesión.",
    "auth/invalid-action-code": "Este enlace no es válido o ya fue utilizado. Solicita uno nuevo.",
    "auth/user-disabled": "Esta cuenta está desactivada. Contacta al administrador.",
    "auth/weak-password": "La contraseña no cumple los requisitos de Firebase. Elige otra contraseña.",
    "auth/password-does-not-meet-requirements": "La contraseña no cumple los requisitos de seguridad configurados.",
    "auth/too-many-requests": "Se hicieron demasiados intentos. Espera un momento y solicita otro enlace.",
    "auth/network-request-failed": "No se pudo conectar con Firebase. Revisa tu conexión e inténtalo otra vez."
  };
  return messages[error.code] || `No se pudo restablecer la contraseña: ${error.message}`;
}

function updatePasswordFeedback() {
  const password = passwordInput.value;
  const score = password
    ? Math.max(1, Math.min(4, Number(password.length >= 8) + Number(password.length >= 12)
      + Number(/[a-z]/.test(password) && /[A-Z]/.test(password))
      + Number(/\d/.test(password) || /[^a-zA-Z0-9]/.test(password))))
    : 0;
  const labels = ["Sin evaluar", "Débil", "Básica", "Buena", "Fuerte"];

  strengthSegments.forEach((segment, index) => {
    segment.classList.toggle("active", index < score);
  });
  strengthMeter.dataset.level = score;
  strengthLabel.textContent = labels[score];
  passwordGuidance.textContent = password.length > 0 && password.length < 6
    ? `Te faltan ${6 - password.length} caracteres como mínimo.`
    : "La fortaleza es orientativa.";

  if (!confirmationInput.value) {
    passwordMatch.textContent = "";
    passwordMatch.className = "password-match";
    return;
  }

  const matches = password === confirmationInput.value;
  passwordMatch.textContent = matches ? "Las contraseñas coinciden." : "Las contraseñas no coinciden.";
  passwordMatch.className = `password-match ${matches ? "is-match" : "is-mismatch"}`;
}

document.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.getElementById(toggle.dataset.passwordToggle);
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    toggle.classList.toggle("is-visible", !isVisible);
    toggle.setAttribute("aria-pressed", String(!isVisible));
    toggle.setAttribute("aria-label", isVisible ? "Mostrar contraseña" : "Ocultar contraseña");
  });
});

passwordInput.addEventListener("input", updatePasswordFeedback);
confirmationInput.addEventListener("input", updatePasswordFeedback);

async function verifyResetLink() {
  if (actionMode !== "resetPassword" || !actionCode) {
    showMessage("El enlace está incompleto o no corresponde a una recuperación de contraseña. Solicita uno nuevo.", "error");
    return;
  }

  try {
    firebase = await firebaseReady;
    const email = await firebase.verifyPasswordResetCode(firebase.auth, actionCode);
    resetEmail.textContent = `La contraseña que cambiarás pertenece a ${email}.`;
    resetForm.classList.remove("hidden");
    submitButton.disabled = false;
    showMessage("Enlace verificado. Ya puedes crear tu nueva contraseña.", "ready");
  } catch (error) {
    showMessage(humanizeResetError(error), "error");
  }
}

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordInput.value;
  const confirmation = confirmationInput.value;
  if (password.length < 6) {
    showMessage("La contraseña debe tener al menos 6 caracteres.", "error");
    passwordInput.focus();
    return;
  }
  if (password !== confirmation) {
    showMessage("Las contraseñas no coinciden.", "error");
    confirmationInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.classList.add("is-saving");
  submitLabel.textContent = "Guardando de forma segura...";
  showMessage("Actualizando tu contraseña de forma segura...", "loading");
  try {
    await firebase.confirmPasswordReset(firebase.auth, actionCode, password);
    resetForm.classList.add("hidden");
    resetStatus.classList.add("hidden");
    resetSuccess.classList.remove("hidden");
    backToLogin.classList.add("hidden");
    resetTitle.textContent = "Tu acceso está protegido";
    resetIntro.textContent = "La actualización se completó correctamente.";
  } catch (error) {
    showMessage(humanizeResetError(error), "error");
    submitButton.disabled = false;
    submitButton.classList.remove("is-saving");
    submitLabel.textContent = "Guardar nueva contraseña";
  }
});

if (actionParams.size) {
  window.history.replaceState(null, "", window.location.pathname);
}

resetForm.addEventListener("input", (event) => {
  if (event.target === passwordInput || event.target === confirmationInput) {
    if (resetStatus.classList.contains("is-error")) {
      showMessage("Enlace verificado. Ya puedes crear tu nueva contraseña.", "ready");
    }
  }
});

verifyResetLink();
