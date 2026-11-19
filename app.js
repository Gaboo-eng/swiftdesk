import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";

const loginScreen = document.querySelector("#login-screen");
const appShell = document.querySelector("#app-shell");
const loginMessage = document.querySelector("#login-message");
const configNotice = document.querySelector("#config-notice");
const mainView = document.querySelector("#main-view");
const toast = document.querySelector("#toast");
const roleNames = { admin: "Administrador", advisor: "Asesor" };
const viewNames = {
  portal: "Portal informativo",
  calendar: "Calendario de guardias",
  speech: "Speech de atención",
  pdf: "Convertidor de PDF",
  auxiliary: "Módulo auxiliar"
};
let firebase = null;
let currentUser = null;
let currentProfile = null;
let activeView = "portal";
let portalItems = [];
let shifts = [];
let teamMembers = [];
let toastTimer;
let unsubscribePortal = null;
let unsubscribeShifts = null;
let editingPortalId = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function loadTeamMembers() {
  const list = document.querySelector("#team-list");
  if (!list) return;
  list.innerHTML = '<p class="muted small">Cargando miembros...</p>';
  try {
    const snapshot = await firebase.getDocs(firebase.collection(firebase.db, "users"));
    teamMembers = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    list.innerHTML = teamMembers.map((member) => `<article class="team-member">
      <div><strong>${escapeHtml(member.name || "Sin nombre")}</strong><span>${escapeHtml(member.email || "")} · ${escapeHtml(member.department || "Sin departamento")}</span></div>
      <select class="member-role" data-id="${escapeHtml(member.id)}" aria-label="Rol de ${escapeHtml(member.name || member.email || "usuario")}" ${member.id === currentUser.uid ? "disabled" : ""}>
        <option value="advisor" ${member.role === "advisor" ? "selected" : ""}>Asesor</option>
        <option value="admin" ${member.role === "admin" ? "selected" : ""}>Administrador</option>
      </select>
      <select class="member-department" data-id="${escapeHtml(member.id)}" aria-label="Departamento de ${escapeHtml(member.name || member.email || "usuario")}">
        ${["Soporte Técnico", "Administración", "Ventas", "Atención al Cliente"].map((department) => `<option ${member.department === department ? "selected" : ""}>${escapeHtml(department)}</option>`).join("")}
      </select>
      <button class="text-button danger deactivate-member" data-id="${escapeHtml(member.id)}" type="button" ${member.id === currentUser.uid ? "disabled" : ""}>Desactivar</button>
    </article>`).join("") || '<p class="muted small">No hay perfiles registrados.</p>';
    list.querySelectorAll(".member-role").forEach((select) => select.addEventListener("change", async () => {
      try {
        await firebase.updateDoc(firebase.doc(firebase.db, "users", select.dataset.id), { role: select.value });
        showToast("Rol actualizado.");
      } catch (error) {
        showToast(`No se pudo actualizar el rol: ${error.message}`);
        await loadTeamMembers();
      }
    }));
    list.querySelectorAll(".member-department").forEach((select) => select.addEventListener("change", async () => {
      try {
        await firebase.updateDoc(firebase.doc(firebase.db, "users", select.dataset.id), { department: select.value });
        showToast("Departamento actualizado.");
      } catch (error) {
        showToast(`No se pudo actualizar el departamento: ${error.message}`);
        await loadTeamMembers();
      }
    }));
    list.querySelectorAll(".deactivate-member").forEach((button) => button.addEventListener("click", async () => {
      const member = teamMembers.find((entry) => entry.id === button.dataset.id);
      if (!member || !window.confirm(`¿Desactivar el acceso SwiftDesk de ${member.name || member.email}?`)) return;
      try {
        await firebase.deleteDoc(firebase.doc(firebase.db, "users", member.id));
        showToast("Perfil SwiftDesk desactivado. Elimina la cuenta Auth desde Firebase Console.");
        await loadTeamMembers();
      } catch (error) {
        showToast(`No se pudo desactivar: ${error.message}`);
      }
    }));
  } catch (error) {
    list.innerHTML = `<p class="form-message error">No se pudo cargar el equipo: ${escapeHtml(error.message)}</p>`;
  }
}

async function createTeamMember(event) {
  event.preventDefault();
  const name = document.querySelector("#team-name").value.trim();
  const email = document.querySelector("#team-email").value.trim();
  const password = document.querySelector("#team-password").value;
  const role = document.querySelector("#team-role").value;
  const department = document.querySelector("#team-department").value;
  if (name.length === 0 || !email || password.length < 6 || !["admin", "advisor"].includes(role)) {
    showToast("Completa los datos; la contraseña debe tener al menos 6 caracteres.");
    return;
  }
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(document.querySelector("#team-message"), "Creando cuenta y perfil...");
  let provisionedUser = null;
  let secondaryApp = null;
  try {
    secondaryApp = firebase.initializeApp(firebaseConfig, `swiftdesk-provision-${Date.now()}`);
    const secondaryAuth = firebase.getAuth(secondaryApp);
    await firebase.setPersistence(secondaryAuth, firebase.inMemoryPersistence);
    const credential = await firebase.createUserWithEmailAndPassword(secondaryAuth, email, password);
    provisionedUser = credential.user;
    await firebase.setDoc(firebase.doc(firebase.db, "users", provisionedUser.uid), {
      name, email, role, department, createdAt: firebase.serverTimestamp()
    });
    event.currentTarget.reset();
    showMessage(document.querySelector("#team-message"), `Cuenta creada para ${email}. El asesor puede iniciar sesión con la contraseña inicial asignada.`);
    await loadTeamMembers();
  } catch (error) {
    if (provisionedUser) {
      try {
        await firebase.deleteUser(provisionedUser);
        showMessage(
          document.querySelector("#team-message"),
          `No se guardó el perfil en Firestore y se eliminó la cuenta Auth recién creada. Error: ${error.message}`,
          true
        );
      } catch (cleanupError) {
        showMessage(
          document.querySelector("#team-message"),
          `Falló el perfil (${error.message}) y no se pudo eliminar la cuenta Auth (${cleanupError.message}). Revisa Authentication → Users.`,
          true
        );
      }
    } else {
      showMessage(document.querySelector("#team-message"), `No se pudo crear la cuenta: ${humanizeAuthError(error)}`, true);
    }
  } finally {
    if (secondaryApp) {
      try {
        await firebase.deleteApp(secondaryApp);
      } catch (error) {
        showToast(`La cuenta se creó, pero no se pudo cerrar el contexto temporal: ${error.message}`);
      }
    }
    submitButton.disabled = false;
  }
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function loadUserNotes() {
  const notes = document.querySelector("#quick-notes");
  if (!currentUser) {
    notes.value = "";
    return;
  }
  try {
    notes.value = localStorage.getItem(`swiftdesk-notes-${currentUser.uid}`) || "";
  } catch (error) {
    showToast(`No se pudieron cargar las notas: ${error.message}`);
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function isAdmin() {
  return currentProfile?.role === "admin";
}

function formatDate(value) {
  if (!value) return "";
  const date = value.toDate ? value.toDate() : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es", {
    day: "numeric", month: "long", year: "numeric"
  }).format(date);
}

function updateGreeting() {
  const hour = new Date().getHours();
  document.querySelector("#greeting").textContent =
    hour < 12 ? "Buenos días" : hour < 19 ? "Buenas tardes" : "Buenas noches";
  document.querySelector("#today-date").textContent = new Intl.DateTimeFormat("es", {
    weekday: "long", day: "numeric", month: "long"
  }).format(new Date());
}

function setAuthenticatedView(isAuthenticated) {
  loginScreen.classList.toggle("hidden", isAuthenticated);
  appShell.classList.toggle("hidden", !isAuthenticated);
}

function cleanupSubscriptions() {
  if (unsubscribePortal) unsubscribePortal();
  if (unsubscribeShifts) unsubscribeShifts();
  unsubscribePortal = null;
  unsubscribeShifts = null;
}

function renderPortal() {
  const publishedItems = portalItems.filter((item) => item.published !== false);
  const cards = publishedItems.map((item) => `
    <article class="content-card">
      <div class="card-meta"><span class="category-tag">${escapeHtml(item.category || "General")}</span><span>${escapeHtml(formatDate(item.updatedAt))}</span></div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body).replace(/\n/g, "<br>")}</p>
      ${isAdmin() ? `<div class="card-actions"><button class="text-button edit-portal" data-id="${escapeHtml(item.id)}" type="button">Editar</button><button class="text-button danger delete-portal" data-id="${escapeHtml(item.id)}" type="button">Eliminar</button></div>` : ""}
    </article>`).join("");
  mainView.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">NOVEDADES Y RECURSOS</p><h2>Portal informativo</h2><p class="muted">Procesos, comunicados y recursos para todo el equipo.</p></div>
      ${isAdmin() ? '<div class="admin-actions"><button id="manage-team" class="button button-secondary" type="button">Gestionar equipo</button><button id="new-portal" class="button button-primary" type="button">＋ Nuevo contenido</button></div>' : ""}
    </div>
    ${isAdmin() ? `<section id="team-management" class="editor-card hidden">
      <div class="editor-heading"><div><h3>Administrar equipo</h3><p class="muted small">Crear cuentas y gestionar roles y departamentos.</p></div><button id="close-team" class="text-button" type="button">Cerrar</button></div>
      <form id="team-form" class="team-form">
        <div><label for="team-name">Nombre</label><input id="team-name" maxlength="120" required></div>
        <div><label for="team-email">Correo electrónico</label><input id="team-email" type="email" required></div>
        <div><label for="team-password">Contraseña inicial</label><input id="team-password" type="password" minlength="6" autocomplete="new-password" required></div>
        <div><label for="team-role">Rol</label><select id="team-role"><option value="advisor">Asesor</option><option value="admin">Administrador</option></select></div>
        <div><label for="team-department">Departamento</label><select id="team-department"><option>Soporte Técnico</option><option>Administración</option><option>Ventas</option><option>Atención al Cliente</option></select></div>
        <button class="button button-primary" type="submit">Crear cuenta</button>
      </form>
      <p id="team-message" class="form-message" role="status" aria-live="polite"></p>
      <div id="team-list" class="team-list"><p class="muted small">Cargando miembros...</p></div>
      <p class="muted small">Desactivar acceso elimina el perfil de SwiftDesk, pero no la cuenta de Firebase Authentication; elimínala también en Firebase Console.</p>
    </section>` : ""}
    ${isAdmin() ? `<form id="portal-form" class="editor-card hidden">
      <div class="editor-heading"><h3>${editingPortalId ? "Editar contenido" : "Publicar contenido"}</h3><button id="cancel-portal" class="text-button" type="button">Cancelar</button></div>
      <label for="portal-title">Título</label><input id="portal-title" maxlength="120" required>
      <label for="portal-category">Categoría</label><input id="portal-category" maxlength="60" placeholder="Procesos, comunicado...">
      <label for="portal-body">Contenido</label><textarea id="portal-body" rows="5" maxlength="10000" required></textarea>
      <button class="button button-primary" type="submit">Guardar y publicar</button>
    </form>` : ""}
    <div class="content-grid">${cards || '<div class="empty-state"><span>▤</span><h3>Aún no hay publicaciones</h3><p>Los comunicados y procesos aparecerán aquí.</p></div>'}</div>`;
  bindPortalActions();
}

function bindPortalActions() {
  const form = document.querySelector("#portal-form");
  const teamPanel = document.querySelector("#team-management");
  document.querySelector("#manage-team")?.addEventListener("click", async () => {
    teamPanel?.classList.toggle("hidden");
    if (teamPanel && !teamPanel.classList.contains("hidden")) await loadTeamMembers();
  });
  document.querySelector("#close-team")?.addEventListener("click", () => teamPanel?.classList.add("hidden"));
  document.querySelector("#team-form")?.addEventListener("submit", createTeamMember);
  document.querySelector("#new-portal")?.addEventListener("click", () => {
    editingPortalId = null;
    form?.classList.remove("hidden");
    form?.reset();
    form?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.querySelector("#cancel-portal")?.addEventListener("click", () => {
    editingPortalId = null;
    form?.classList.add("hidden");
  });
  form?.addEventListener("submit", savePortalItem);
  document.querySelectorAll(".edit-portal").forEach((button) => button.addEventListener("click", () => {
    const item = portalItems.find((entry) => entry.id === button.dataset.id);
    if (!item || !form) return;
    editingPortalId = item.id;
    form.querySelector("#portal-title").value = item.title || "";
    form.querySelector("#portal-category").value = item.category || "";
    form.querySelector("#portal-body").value = item.body || "";
    form.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  document.querySelectorAll(".delete-portal").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("¿Eliminar esta publicación?")) return;
    try {
      await firebase.deleteDoc(firebase.doc(firebase.db, "portal", button.dataset.id));
      showToast("Publicación eliminada.");
    } catch (error) {
      showToast(`No se pudo eliminar: ${error.message}`);
    }
  }));
}

async function savePortalItem(event) {
  event.preventDefault();
  const title = document.querySelector("#portal-title").value.trim();
  const category = document.querySelector("#portal-category").value.trim() || "General";
  const body = document.querySelector("#portal-body").value.trim();
  if (!title || !body) return;
  try {
    const payload = {
      title, category, body, published: true,
      updatedAt: firebase.serverTimestamp(), createdBy: currentUser.uid
    };
    if (editingPortalId) {
      await firebase.updateDoc(firebase.doc(firebase.db, "portal", editingPortalId), payload);
    } else {
      await firebase.addDoc(firebase.collection(firebase.db, "portal"), payload);
    }
    editingPortalId = null;
    showToast("Contenido publicado.");
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
  }
}

function renderShifts() {
  const sortedShifts = [...shifts].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  mainView.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">COBERTURA OPERATIVA</p><h2>Calendario de guardias</h2><p class="muted">Consulta los turnos asignados al equipo.</p></div></div>
    ${isAdmin() ? `<form id="shift-form" class="editor-card shift-form">
      <div class="editor-heading"><h3>Asignar una guardia</h3></div>
      <div class="shift-fields"><div><label for="shift-person">Asesor o responsable</label><input id="shift-person" maxlength="120" required></div>
      <div><label for="shift-date">Fecha</label><input id="shift-date" type="date" required></div>
      <div><label for="shift-start">Inicio</label><input id="shift-start" type="time" value="09:00" required></div>
      <div><label for="shift-end">Fin</label><input id="shift-end" type="time" value="18:00" required></div>
      <button class="button button-primary" type="submit">＋ Asignar turno</button></div>
    </form>` : ""}
    <div class="shift-list">${sortedShifts.map((shift) => `<article class="shift-card">
      <div class="shift-date"><strong>${escapeHtml(new Date(`${shift.date}T12:00:00`).getDate())}</strong><span>${escapeHtml(new Intl.DateTimeFormat("es", { month: "short" }).format(new Date(`${shift.date}T12:00:00`)))}</span></div>
      <div class="shift-person"><strong>${escapeHtml(shift.person)}</strong><span>${escapeHtml(formatDate(shift.date))} · ${escapeHtml(shift.start || "")}–${escapeHtml(shift.end || "")}</span></div>
      <span class="category-tag">${escapeHtml(shift.department || "Operaciones")}</span>
      ${isAdmin() ? `<button class="icon-button delete-shift" data-id="${escapeHtml(shift.id)}" type="button" aria-label="Eliminar turno">×</button>` : ""}
    </article>`).join("") || '<div class="empty-state"><span>▦</span><h3>Sin guardias programadas</h3><p>Los próximos turnos aparecerán aquí.</p></div>'}</div>`;
  document.querySelector("#shift-form")?.addEventListener("submit", createShift);
  document.querySelectorAll(".delete-shift").forEach((button) => button.addEventListener("click", async () => {
    if (!window.confirm("¿Eliminar este turno?")) return;
    try {
      await firebase.deleteDoc(firebase.doc(firebase.db, "shifts", button.dataset.id));
      showToast("Turno eliminado.");
    } catch (error) {
      showToast(`No se pudo eliminar: ${error.message}`);
    }
  }));
}

async function createShift(event) {
  event.preventDefault();
  const person = document.querySelector("#shift-person").value.trim();
  const date = document.querySelector("#shift-date").value;
  const start = document.querySelector("#shift-start").value;
  const end = document.querySelector("#shift-end").value;
  if (!person || !date || !start || !end || end <= start) {
    showToast("Revisa los datos: la hora de fin debe ser posterior al inicio.");
    return;
  }
  try {
    await firebase.addDoc(firebase.collection(firebase.db, "shifts"), {
      person, date, start, end, department: "Operaciones",
      createdBy: currentUser.uid, createdAt: firebase.serverTimestamp()
    });
    event.target.reset();
    document.querySelector("#shift-start").value = "09:00";
    document.querySelector("#shift-end").value = "18:00";
    showToast("Guardia asignada.");
  } catch (error) {
    showToast(`No se pudo asignar: ${error.message}`);
  }
}

function renderReservedView(view) {
  const descriptions = {
    speech: ["Respuestas y guiones de soporte", "Este espacio queda preparado para centralizar respuestas aprobadas y guiones de atención."],
    pdf: ["Herramientas para documentos", "El convertidor está reservado para una futura herramienta de maquetación en el navegador."],
    auxiliary: ["Un espacio para nuevas ideas", "Este módulo está listo para crecer con las necesidades del equipo."]
  };
  const [title, description] = descriptions[view];
  mainView.innerHTML = `<div class="section-heading"><div><p class="eyebrow">PRÓXIMAMENTE</p><h2>${escapeHtml(viewNames[view])}</h2><p class="muted">${escapeHtml(description)}</p></div></div>
    <div class="placeholder-card"><div class="placeholder-icon">${view === "pdf" ? "▧" : view === "speech" ? "☷" : "＋"}</div><h3>${escapeHtml(title)}</h3><p>La estructura está preparada para una próxima actualización de SwiftDesk.</p><span class="coming-soon">MÓDULO PREPARADO</span></div>`;
}

function selectView(view) {
  if (!viewNames[view]) return;
  activeView = view;
  document.querySelector("#breadcrumb-current").textContent = viewNames[view];
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "portal") renderPortal();
  else if (view === "calendar") renderShifts();
  else renderReservedView(view);
  closeSidebar();
}

function updateCurrentDuty() {
  const now = new Date();
  const currentDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const onDuty = shifts.find((shift) => shift.date === currentDate && shift.start <= currentTime && shift.end > currentTime);
  document.querySelector("#current-duty").textContent = onDuty ? onDuty.person : "Sin turno asignado";
}

function renderSearchResults(query) {
  const resultsElement = document.querySelector("#search-results");
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    resultsElement.classList.add("hidden");
    resultsElement.innerHTML = "";
    return;
  }
  const matches = portalItems.filter((item) => item.published !== false &&
    `${item.title} ${item.category} ${item.body}`.toLocaleLowerCase().includes(normalized)).slice(0, 8);
  resultsElement.innerHTML = matches.length
    ? `<p class="eyebrow">RESULTADOS DEL PORTAL</p>${matches.map((item) => `<button class="search-result" data-id="${escapeHtml(item.id)}" type="button"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.category || "General")} · ${escapeHtml(item.body.slice(0, 115))}${item.body.length > 115 ? "…" : ""}</span></button>`).join("")}`
    : '<p class="muted">No se encontraron resultados en el portal.</p>';
  resultsElement.classList.remove("hidden");
  resultsElement.querySelectorAll(".search-result").forEach((button) => button.addEventListener("click", () => {
    selectView("portal");
    document.querySelector("#global-search").value = "";
    renderSearchResults("");
    const item = portalItems.find((entry) => entry.id === button.dataset.id);
    if (item) showToast(item.title);
  }));
}

function subscribeToWorkspace() {
  cleanupSubscriptions();
  unsubscribePortal = firebase.onSnapshot(firebase.collection(firebase.db, "portal"), (snapshot) => {
    portalItems = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    if (activeView === "portal") renderPortal();
    if (document.querySelector("#global-search").value.trim()) renderSearchResults(document.querySelector("#global-search").value);
  }, (error) => showToast(`Error al cargar el portal: ${error.message}`));
  unsubscribeShifts = firebase.onSnapshot(firebase.collection(firebase.db, "shifts"), (snapshot) => {
    shifts = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    if (activeView === "calendar") renderShifts();
    updateCurrentDuty();
  }, (error) => showToast(`Error al cargar las guardias: ${error.message}`));
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.querySelector("#login-email").value.trim();
  const password = document.querySelector("#login-password").value;
  if (!firebase || !email || !password) return;
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(loginMessage, "Verificando tus datos...");
  try {
    await firebase.signInWithEmailAndPassword(firebase.auth, email, password);
  } catch (error) {
    showMessage(loginMessage, humanizeAuthError(error), true);
  } finally {
    submitButton.disabled = false;
  }
}

function humanizeAuthError(error) {
  const messages = {
    "auth/invalid-credential": "El correo o la contraseña no son correctos.",
    "auth/user-not-found": "No encontramos una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña no es correcta.",
    "auth/email-already-in-use": "Ese correo ya tiene una cuenta en Firebase Authentication.",
    "auth/weak-password": "La contraseña debe cumplir la política de Firebase y tener al menos 6 caracteres.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento y vuelve a probar.",
    "auth/invalid-email": "Escribe un correo electrónico válido."
  };
  return messages[error.code] || `No se pudo completar la operación: ${error.message}`;
}

async function handlePasswordReset() {
  const email = document.querySelector("#login-email").value.trim();
  if (!firebase) return showMessage(loginMessage, "Primero configura Firebase siguiendo la guía del proyecto.", true);
  if (!email) return showMessage(loginMessage, "Escribe tu correo para enviarte el enlace de recuperación.", true);
  try {
    await firebase.sendPasswordResetEmail(firebase.auth, email);
    showMessage(loginMessage, "Si la cuenta existe, recibirás un correo con los pasos para restablecer la contraseña.");
  } catch (error) {
    showMessage(loginMessage, humanizeAuthError(error), true);
  }
}

async function handleAuthState(user) {
  cleanupSubscriptions();
  currentUser = user;
  currentProfile = null;
  if (!user) {
    setAuthenticatedView(false);
    return;
  }
  try {
    const profileSnapshot = await firebase.getDoc(firebase.doc(firebase.db, "users", user.uid));
    if (!profileSnapshot.exists()) {
      await firebase.signOut(firebase.auth);
      showMessage(loginMessage, "Tu cuenta aún no tiene un perfil asignado. Solicita acceso a un administrador.", true);
      return;
    }
    const profile = profileSnapshot.data();
    if (!["admin", "advisor"].includes(profile.role)) {
      await firebase.signOut(firebase.auth);
      showMessage(loginMessage, "El perfil no tiene un rol válido. Contacta al administrador.", true);
      return;
    }
    currentProfile = profile;
    loadUserNotes();
    setAuthenticatedView(true);
    const displayName = profile.name || user.displayName || user.email || "Usuario";
    document.querySelector("#user-name").textContent = displayName;
    document.querySelector("#user-role").textContent = roleNames[profile.role];
    document.querySelector("#user-avatar").textContent = displayName.charAt(0).toLocaleUpperCase();
    document.querySelector("#welcome-copy").textContent = `Qué bueno tenerte aquí, ${displayName}. Aquí tienes las novedades y recursos para tu jornada.`;
    updateGreeting();
    selectView(activeView);
    subscribeToWorkspace();
  } catch (error) {
    await firebase.signOut(firebase.auth);
    showMessage(loginMessage, `No se pudo cargar tu perfil: ${error.message}`, true);
  }
}

async function createSuggestion(event) {
  event.preventDefault();
  const field = document.querySelector("#suggestion-text");
  const message = document.querySelector("#suggestion-message");
  const text = field.value.trim();
  if (text.length < 5 || text.length > 2000) {
    showMessage(message, "La sugerencia debe tener entre 5 y 2.000 caracteres.", true);
    return;
  }
  try {
    await firebase.addDoc(firebase.collection(firebase.db, "suggestions"), {
      text,
      uid: currentUser.uid,
      email: currentUser.email || "",
      createdAt: firebase.serverTimestamp()
    });
    field.value = "";
    showMessage(message, "¡Gracias! Tu sugerencia fue enviada.");
  } catch (error) {
    showMessage(message, `No se pudo enviar: ${error.message}`, true);
  }
}

function setupUtilityPanels() {
  document.querySelectorAll(".quick-button").forEach((button) => button.addEventListener("click", () => {
    const panel = document.getElementById(button.dataset.panel);
    const wasHidden = panel.classList.contains("hidden");
    document.querySelectorAll(".utility-panel").forEach((entry) => entry.classList.add("hidden"));
    if (wasHidden) panel.classList.remove("hidden");
  }));
  document.querySelectorAll(".panel-close").forEach((button) => button.addEventListener("click", () => {
    button.closest(".utility-panel").classList.add("hidden");
  }));
  const notes = document.querySelector("#quick-notes");
  notes.addEventListener("input", () => {
    if (!currentUser) return;
    try {
      localStorage.setItem(`swiftdesk-notes-${currentUser.uid}`, notes.value);
    } catch (error) {
      showToast(`No se pudieron guardar las notas: ${error.message}`);
    }
  });
  const calendarUrl = document.querySelector("#calendar-url");
  try {
    calendarUrl.value = localStorage.getItem("swiftdesk-calendar-url") || "";
  } catch (error) {
    showToast(`No se pudo leer el calendario guardado: ${error.message}`);
  }
  document.querySelector("#save-calendar-url").addEventListener("click", () => {
    const value = calendarUrl.value.trim();
    let url;
    try {
      url = new URL(value);
    } catch {
      return showMessage(document.querySelector("#calendar-message"), "Pega una URL válida de Google Calendar.", true);
    }
    if (url.protocol !== "https:" || url.hostname !== "calendar.google.com" || !url.pathname.startsWith("/calendar/embed")) {
      return showMessage(document.querySelector("#calendar-message"), "Usa la URL de inserción HTTPS de calendar.google.com.", true);
    }
    try {
      localStorage.setItem("swiftdesk-calendar-url", url.toString());
    } catch (error) {
      return showMessage(document.querySelector("#calendar-message"), `No se pudo guardar la URL: ${error.message}`, true);
    }
    const frame = document.querySelector("#calendar-frame");
    frame.src = url.toString();
    frame.classList.remove("hidden");
    showMessage(document.querySelector("#calendar-message"), "Calendario cargado.");
  });
  if (calendarUrl.value) document.querySelector("#save-calendar-url").click();
  document.querySelector("#suggestion-form").addEventListener("submit", createSuggestion);
  const total = document.querySelector("#prorate-total");
  const days = document.querySelector("#prorate-days");
  const calculate = () => {
    const monthly = Math.max(0, Number(total.value) || 0);
    const count = Math.min(30, Math.max(0, Number(days.value) || 0));
    document.querySelector("#prorate-result").textContent = new Intl.NumberFormat("es", {
      style: "currency", currency: "USD"
    }).format(monthly * count / 30);
  };
  total.addEventListener("input", calculate);
  days.addEventListener("input", calculate);
}

function openSidebar() {
  document.querySelector("#sidebar").classList.add("sidebar-open");
  document.querySelector("#sidebar-scrim").classList.add("visible");
}

function closeSidebar() {
  document.querySelector("#sidebar").classList.remove("sidebar-open");
  document.querySelector("#sidebar-scrim").classList.remove("visible");
}

function setupUI() {
  document.querySelector("#login-form").addEventListener("submit", handleLogin);
  document.querySelector("#forgot-password").addEventListener("click", handlePasswordReset);
  document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
      cleanupSubscriptions();
      await firebase.signOut(firebase.auth);
      document.querySelector("#login-form").reset();
      showMessage(loginMessage, "Sesión cerrada correctamente.");
    } catch (error) {
      showToast(`No se pudo cerrar la sesión: ${error.message}`);
    }
  });
  document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.view)));
  document.querySelector("#global-search").addEventListener("input", (event) => renderSearchResults(event.target.value));
  document.querySelector("#open-sidebar").addEventListener("click", openSidebar);
  document.querySelector("#close-sidebar").addEventListener("click", closeSidebar);
  document.querySelector("#sidebar-scrim").addEventListener("click", closeSidebar);
  setupUtilityPanels();
  updateGreeting();
}

setupUI();
const loginButton = document.querySelector("#login-form button[type='submit']");
loginButton.disabled = true;
showMessage(loginMessage, "Conectando con Firebase...");

if (!firebaseConfigured) {
  configNotice.textContent = "La aplicación todavía no está conectada a Firebase. Copia la configuración web de tu proyecto en firebase-config.js para habilitar el acceso.";
  configNotice.classList.remove("hidden");
  document.querySelector("#login-form button[type='submit']").disabled = true;
} else {
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
    ]);
    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    const db = firestoreSdk.getFirestore(app);
    firebase = {
      auth, db, signInWithEmailAndPassword: authSdk.signInWithEmailAndPassword,
      sendPasswordResetEmail: authSdk.sendPasswordResetEmail, signOut: authSdk.signOut,
      onAuthStateChanged: authSdk.onAuthStateChanged,
      collection: firestoreSdk.collection, doc: firestoreSdk.doc, getDoc: firestoreSdk.getDoc,
      getDocs: firestoreSdk.getDocs, addDoc: firestoreSdk.addDoc, setDoc: firestoreSdk.setDoc,
      updateDoc: firestoreSdk.updateDoc, deleteDoc: firestoreSdk.deleteDoc,
      onSnapshot: firestoreSdk.onSnapshot, serverTimestamp: firestoreSdk.serverTimestamp,
      initializeApp: appSdk.initializeApp, getAuth: authSdk.getAuth,
      createUserWithEmailAndPassword: authSdk.createUserWithEmailAndPassword,
      deleteUser: authSdk.deleteUser, deleteApp: appSdk.deleteApp,
      setPersistence: authSdk.setPersistence,
      browserLocalPersistence: authSdk.browserLocalPersistence,
      inMemoryPersistence: authSdk.inMemoryPersistence
    };
    await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    loginButton.disabled = false;
    showMessage(loginMessage, "");
    authSdk.onAuthStateChanged(auth, handleAuthState);
  } catch (error) {
    configNotice.textContent = `No se pudo iniciar Firebase: ${error.message}`;
    configNotice.classList.remove("hidden");
    showMessage(loginMessage, "Verifica la configuración de Firebase y vuelve a cargar la página.", true);
  }
}
