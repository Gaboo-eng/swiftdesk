import { firebaseReady } from "./firebase-client.js";
import { initializeThemeToggle } from "./theme.js";

const form = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const configNotice = document.querySelector("#config-notice");
const loginButton = form.querySelector('button[type="submit"]');
let firebase = null;

initializeThemeToggle();

function showMessage(message, isError = false) {
  loginMessage.textContent = message;
  loginMessage.classList.toggle("error", isError);
}

function humanizeAuthError(error) {
  const messages = {
    "auth/invalid-credential": "El correo o la contraseña no son correctos.",
    "auth/invalid-login-credentials": "El correo o la contraseña no son correctos.",
    "auth/user-not-found": "No encontramos una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a probar.",
    "auth/invalid-email": "Escribe un correo electrónico válido."
  };
  return messages[error.code] || `No se pudo completar la operación: ${error.message}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#login-email").value.trim();
  const password = document.querySelector("#login-password").value;
  if (!firebase || !email || !password) return;

  loginButton.disabled = true;
  showMessage("Verificando tus datos...");
  try {
    await firebase.signInWithEmailAndPassword(firebase.auth, email, password);
    window.location.replace("./dashboard.html");
  } catch (error) {
    showMessage(humanizeAuthError(error), true);
    loginButton.disabled = false;
  }
});

document.querySelector("#forgot-password").addEventListener("click", async () => {
  const email = document.querySelector("#login-email").value.trim();
  if (!firebase) return showMessage("Firebase aún no está listo. Recarga la página e inténtalo de nuevo.", true);
  if (!email) return showMessage("Escribe tu correo para enviarte el enlace de recuperación.", true);
  try {
    firebase.auth.languageCode = "es";
    await firebase.sendPasswordResetEmail(firebase.auth, email);
    showMessage("Si la cuenta existe, recibirás un correo con el enlace para crear una nueva contraseña. Revisa también el correo no deseado.");
  } catch (error) {
    showMessage(humanizeAuthError(error), true);
  }
});

const searchParams = new URLSearchParams(window.location.search);
const reason = searchParams.get("reason");
if (reason === "profile") {
  showMessage("Tu sesión no tiene un perfil válido en SwiftDesk. Contacta al administrador.", true);
} else if (reason === "session") {
  showMessage("Inicia sesión para continuar.", true);
} else if (searchParams.get("password") === "updated") {
  showMessage("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
}

loginButton.disabled = true;
showMessage("Conectando con Firebase...");

try {
  firebase = await firebaseReady;
  loginButton.disabled = false;
  if (!reason && searchParams.get("password") !== "updated") showMessage("");
} catch (error) {
  configNotice.textContent = `No se pudo iniciar Firebase: ${error.message}`;
  configNotice.classList.remove("hidden");
  showMessage("Verifica la configuración de Firebase y vuelve a cargar la página.", true);
}
