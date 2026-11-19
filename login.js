import { firebaseReady } from "./firebase-client.js";

const form = document.querySelector("#login-form");
const loginMessage = document.querySelector("#login-message");
const configNotice = document.querySelector("#config-notice");
const loginButton = form.querySelector('button[type="submit"]');
let firebase = null;

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

async function validateAndOpenDashboard(user) {
  try {
    const snapshot = await firebase.getDoc(firebase.doc(firebase.db, "users", user.uid));
    const role = snapshot.data()?.role;
    if (!snapshot.exists() || !["admin", "advisor"].includes(role)) {
      await firebase.signOut(firebase.auth);
      showMessage("La cuenta no tiene un perfil válido en SwiftDesk. Contacta al administrador.", true);
      loginButton.disabled = false;
      return;
    }
    window.location.replace("./dashboard.html");
  } catch (error) {
    await firebase.signOut(firebase.auth);
    showMessage(`No se pudo validar tu perfil: ${error.message}`, true);
    loginButton.disabled = false;
  }
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
    await firebase.sendPasswordResetEmail(firebase.auth, email);
    showMessage("Si la cuenta existe, recibirás un correo con los pasos para restablecer la contraseña.");
  } catch (error) {
    showMessage(humanizeAuthError(error), true);
  }
});

const reason = new URLSearchParams(window.location.search).get("reason");
if (reason === "profile") {
  showMessage("Tu sesión no tiene un perfil válido en SwiftDesk. Contacta al administrador.", true);
} else if (reason === "session") {
  showMessage("Inicia sesión para continuar.", true);
}

loginButton.disabled = true;
showMessage("Conectando con Firebase...");

try {
  firebase = await firebaseReady;
  firebase.onAuthStateChanged(firebase.auth, (user) => {
    if (user) {
      loginButton.disabled = true;
      showMessage("Sesión encontrada. Abriendo SwiftDesk...");
      void validateAndOpenDashboard(user);
    } else {
      loginButton.disabled = false;
      if (!reason) showMessage("");
    }
  });
} catch (error) {
  configNotice.textContent = `No se pudo iniciar Firebase: ${error.message}`;
  configNotice.classList.remove("hidden");
  showMessage("Verifica la configuración de Firebase y vuelve a cargar la página.", true);
}
