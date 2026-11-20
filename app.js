import { firebaseReady } from "./firebase-client.js";
import { firebaseConfig } from "./firebase-config.js";
import { initializeThemeToggle } from "./theme.js";

const appShell = document.querySelector("#app-shell");
const dashboardStatus = document.querySelector("#dashboard-status");
const mainView = document.querySelector("#main-view");
const toast = document.querySelector("#toast");
const roleNames = { admin: "Administrador", advisor: "Asesor" };
const viewNames = {
  portal: "Portal informativo",
  calendar: "Calendario de guardias",
  speech: "Speech de atención",
  suggestions: "Sugerencias recibidas",
  pdf: "Convertidor de PDF",
  auxiliary: "Módulo auxiliar",
  team: "Gestionar equipo"
};
let firebase = null;
let currentUser = null;
let currentProfile = null;
let currentProfileUid = null;
let authInitializationUid = null;
let authInitializationPromise = null;
let activeView = "portal";
let portalItems = [];
let shifts = [];
let portalLoaded = false;
let shiftsLoaded = false;
let speeches = [];
let suggestions = [];
let teamMembers = [];
let toastTimer;
let editingPortalId = null;
let editingSpeechId = null;
let speechesLoaded = false;
let speechLoadError = "";
let speechLoadPromise = null;
let suggestionsLoaded = false;
let suggestionsLoading = false;
let suggestionsLoadError = "";
let suggestionsLoadPromise = null;
let pendingAuthRedirectReason = null;

initializeThemeToggle();

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function cacheKey(collectionName, uid = currentUser?.uid) {
  const version = collectionName === "portal" || collectionName === "shifts" ? 2 : 1;
  return `swiftdesk:${firebaseConfig.projectId}:${uid}:${collectionName}:v${version}`;
}

function validCacheItem(collectionName, item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string") return false;
  if (collectionName === "portal") {
    return typeof item.title === "string" && typeof item.body === "string" &&
      (item.category === undefined || typeof item.category === "string") &&
      (item.published === undefined || typeof item.published === "boolean") &&
      (item.updatedAt === undefined || typeof item.updatedAt === "string");
  }
  if (collectionName === "shifts") {
    return ["person", "date", "start", "end", "department"].every((key) => typeof item[key] === "string");
  }
  if (collectionName === "team") {
    return ["name", "email", "department"].every((key) => typeof item[key] === "string") &&
      ["admin", "advisor"].includes(item.role);
  }
  if (collectionName === "speeches") {
    return ["title", "description", "text"].every((key) => typeof item[key] === "string");
  }
  return false;
}

function readLocalCache(collectionName) {
  if (!currentUser) return null;
  const key = cacheKey(collectionName);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!Array.isArray(cache.items) || !cache.items.every((item) => validCacheItem(collectionName, item)) ||
        !Number.isFinite(cache.savedAt)) {
      localStorage.removeItem(key);
      return null;
    }
    return cache;
  } catch (error) {
    showToast(`No se pudo leer la caché local de ${collectionName}: ${error.message}`);
    return null;
  }
}

function writeLocalCache(collectionName, items) {
  if (!currentUser) return false;
  try {
    localStorage.setItem(cacheKey(collectionName), JSON.stringify({ savedAt: Date.now(), items }));
    return true;
  } catch (error) {
    showToast(`No se pudo guardar ${collectionName} localmente: ${error.message}`);
    return false;
  }
}

function clearLocalDataCache(uid) {
  for (const collectionName of ["portal", "shifts", "team", "speeches"]) {
    try {
      localStorage.removeItem(cacheKey(collectionName, uid));
      if (collectionName === "portal" || collectionName === "shifts") {
        localStorage.removeItem(`swiftdesk:${firebaseConfig.projectId}:${uid}:${collectionName}:v1`);
      }
    } catch (error) {
      showToast(`No se pudo limpiar la caché de ${collectionName}: ${error.message}`);
    }
  }
}

function createContentId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cacheableTeamMember(snapshotDoc) {
  const member = snapshotDoc.data();
  return {
    id: snapshotDoc.id,
    name: member.name || "",
    email: member.email || "",
    role: member.role || "advisor",
    department: member.department || ""
  };
}

function saveTeamCache() {
  writeLocalCache("team", teamMembers.map(({ id, name, email, role, department }) => ({
    id, name, email, role, department
  })));
}

function renderTeamMembers() {
  const list = document.querySelector("#team-list");
  if (!list) return;
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
    const member = teamMembers.find((entry) => entry.id === select.dataset.id);
    try {
      await firebase.updateDoc(firebase.doc(firebase.db, "users", select.dataset.id), { role: select.value });
      if (member) member.role = select.value;
      saveTeamCache();
      showToast("Rol actualizado.");
    } catch (error) {
      showToast(`No se pudo actualizar el rol: ${error.message}`);
      select.value = member?.role || "advisor";
    }
  }));
  list.querySelectorAll(".member-department").forEach((select) => select.addEventListener("change", async () => {
    const member = teamMembers.find((entry) => entry.id === select.dataset.id);
    try {
      await firebase.updateDoc(firebase.doc(firebase.db, "users", select.dataset.id), { department: select.value });
      if (member) member.department = select.value;
      saveTeamCache();
      showToast("Departamento actualizado.");
    } catch (error) {
      showToast(`No se pudo actualizar el departamento: ${error.message}`);
      if (member) select.value = member.department;
    }
  }));
  list.querySelectorAll(".deactivate-member").forEach((button) => button.addEventListener("click", async () => {
    const member = teamMembers.find((entry) => entry.id === button.dataset.id);
    if (!member || !window.confirm(`¿Desactivar el acceso SwiftDesk de ${member.name || member.email}?`)) return;
    try {
      await firebase.deleteDoc(firebase.doc(firebase.db, "users", member.id));
      teamMembers = teamMembers.filter((entry) => entry.id !== member.id);
      saveTeamCache();
      renderTeamMembers();
      showToast("Perfil SwiftDesk desactivado. Elimina la cuenta Auth desde Firebase Console.");
    } catch (error) {
      showToast(`No se pudo desactivar: ${error.message}`);
    }
  }));
}

async function loadTeamMembers(forceRefresh = false) {
  const list = document.querySelector("#team-list");
  if (!list) return;
  const cached = readLocalCache("team");
  if (cached && !forceRefresh) {
    teamMembers = cached.items;
    renderTeamMembers();
    return;
  }
  if (cached) teamMembers = cached.items;
  list.innerHTML = '<p class="muted small">Cargando miembros...</p>';
  try {
    const snapshot = await firebase.getDocs(firebase.collection(firebase.db, "users"));
    teamMembers = snapshot.docs.map(cacheableTeamMember);
    saveTeamCache();
    renderTeamMembers();
  } catch (error) {
    if (cached) {
      teamMembers = cached.items;
      renderTeamMembers();
      showToast(`No se pudo actualizar el equipo; se muestran los datos guardados: ${error.message}`);
    } else {
      list.innerHTML = `<p class="form-message error">No se pudo cargar el equipo: ${escapeHtml(error.message)}</p>`;
    }
  }
}

async function createTeamMember(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = document.querySelector("#team-name").value.trim();
  const email = document.querySelector("#team-email").value.trim();
  const password = document.querySelector("#team-password").value;
  const role = document.querySelector("#team-role").value;
  const department = document.querySelector("#team-department").value;
  const message = document.querySelector("#team-message");

  if (!name || !email || password.length < 6 || !["admin", "advisor"].includes(role)) {
    showMessage(message, "Completa los datos; la contraseña debe tener al menos 6 caracteres.", true);
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showMessage(message, "Creando cuenta y perfil...");
  let secondaryApp = null;
  let createdUser = null;

  try {
    secondaryApp = firebase.initializeApp(firebaseConfig, `swiftdesk-provision-${Date.now()}`);
    const secondaryAuth = firebase.getAuth(secondaryApp);
    await firebase.setPersistence(secondaryAuth, firebase.inMemoryPersistence);
    const credential = await firebase.createUserWithEmailAndPassword(secondaryAuth, email, password);
    createdUser = credential.user;

    await firebase.setDoc(firebase.doc(firebase.db, "users", createdUser.uid), {
      name,
      email,
      role,
      department,
      createdAt: firebase.serverTimestamp()
    });

    teamMembers = teamMembers.filter((member) => member.id !== createdUser.uid);
    teamMembers.push({ id: createdUser.uid, name, email, role, department });
    saveTeamCache();
    form.reset();
    showMessage(message, `Cuenta creada para ${email}. Comunica la contraseña inicial por un canal seguro.`);
    renderTeamMembers();
  } catch (error) {
    if (createdUser) {
      try {
        await firebase.deleteUser(createdUser);
        showMessage(message, `No se guardó el perfil y se eliminó la cuenta recién creada. Error de Firestore: ${error.message}`, true);
      } catch (cleanupError) {
        showMessage(
          message,
          `Falló el perfil (${error.message}) y no se pudo eliminar la cuenta Auth (${cleanupError.message}). Revisa Authentication → Users.`,
          true
        );
      }
    } else {
      showMessage(message, `No se pudo crear la cuenta: ${humanizeAuthError(error)}`, true);
    }
  } finally {
    if (secondaryApp) {
      try {
        await firebase.deleteApp(secondaryApp);
      } catch (error) {
        showToast(`No se pudo cerrar el contexto temporal de Auth: ${error.message}`);
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
  const date = value.toDate
    ? value.toDate()
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
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
      ${isAdmin() ? `<div class="admin-actions"><button id="new-portal" class="button button-primary" type="button" ${portalLoaded ? "" : "disabled"}>＋ Nuevo contenido</button></div>` : ""}
    </div>
    ${isAdmin() ? `<form id="portal-form" class="editor-card hidden">
      <div class="editor-heading"><h3>${editingPortalId ? "Editar contenido" : "Publicar contenido"}</h3><button id="cancel-portal" class="text-button" type="button">Cancelar</button></div>
      <label for="portal-title">Título</label><input id="portal-title" maxlength="120" required>
      <label for="portal-category">Categoría</label><input id="portal-category" maxlength="60" placeholder="Procesos, comunicado...">
      <label for="portal-body">Contenido</label><textarea id="portal-body" rows="5" maxlength="10000" required></textarea>
      <button class="button button-primary" type="submit" ${portalLoaded ? "" : "disabled"}>Guardar y publicar</button>
    </form>` : ""}
    <div class="content-grid">${cards || '<div class="empty-state"><span>▤</span><h3>Aún no hay publicaciones</h3><p>Los comunicados y procesos aparecerán aquí.</p></div>'}</div>`;
  bindPortalActions();
}

function renderTeamManagement() {
  if (!isAdmin()) return;
  mainView.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">ADMINISTRACIÓN</p><h2>Gestionar equipo</h2><p class="muted">Crea cuentas y administra roles y departamentos.</p></div>
      <button id="refresh-team" class="button button-secondary" type="button">Actualizar lista</button>
    </div>
    <section class="editor-card">
      <div class="editor-heading"><div><h3>Administrar perfiles</h3><p class="muted small">La cuenta de Authentication y su perfil SwiftDesk se crean juntos.</p></div></div>
      <div class="team-console-guide">
        <strong>Alta desde SwiftDesk</strong>
        <span>Ingresa una contraseña inicial segura y comunícala al miembro del equipo por un canal privado.</span>
      </div>
      <form id="team-form" class="team-form">
        <div><label for="team-name">Nombre</label><input id="team-name" maxlength="120" required></div>
        <div><label for="team-email">Correo electrónico</label><input id="team-email" type="email" autocomplete="email" required></div>
        <div><label for="team-password">Contraseña inicial</label><input id="team-password" type="password" minlength="6" autocomplete="new-password" required></div>
        <div><label for="team-role">Rol</label><select id="team-role"><option value="advisor">Asesor</option><option value="admin">Administrador</option></select></div>
        <div><label for="team-department">Departamento</label><select id="team-department"><option>Soporte Técnico</option><option>Administración</option><option>Ventas</option><option>Atención al Cliente</option></select></div>
        <button class="button button-primary" type="submit">Crear cuenta</button>
      </form>
      <p id="team-message" class="form-message" role="status" aria-live="polite"></p>
      <div id="team-list" class="team-list"><p class="muted small">Cargando miembros...</p></div>
      <p class="muted small">Desactivar acceso elimina el perfil SwiftDesk, pero no la cuenta Auth. Para revocar completamente el acceso, elimina también esa cuenta en Firebase Console.</p>
    </section>`;
  document.querySelector("#team-form").addEventListener("submit", createTeamMember);
  document.querySelector("#refresh-team").addEventListener("click", () => loadTeamMembers(true));
  loadTeamMembers();
}

function bindPortalActions() {
  const form = document.querySelector("#portal-form");
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
      const nextItems = await mutateWorkspaceItems("portal", (items) => {
        const updated = items.filter((item) => item.id !== button.dataset.id);
        if (updated.length === items.length) {
          throw new Error("La publicación ya no existe. Actualiza los datos e inténtalo de nuevo.");
        }
        return updated;
      });
      portalItems = nextItems;
      writeLocalCache("portal", portalItems);
      renderPortal();
      const query = document.querySelector("#global-search").value;
      if (query.trim()) renderSearchResults(query);
      showToast("Publicación eliminada.");
    } catch (error) {
      showToast(`No se pudo eliminar: ${error.message}`);
    }
  }));
}

async function savePortalItem(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const title = document.querySelector("#portal-title").value.trim();
  const category = document.querySelector("#portal-category").value.trim() || "General";
  const body = document.querySelector("#portal-body").value.trim();
  if (!title || !body) return;
  submitButton.disabled = true;
  try {
    const updatedAt = new Date().toISOString();
    const editingId = editingPortalId;
    const itemId = editingId || createContentId();
    const nextItems = await mutateWorkspaceItems("portal", (items) => {
      if (editingId) {
        let found = false;
        const updated = items.map((item) => {
          if (item.id !== itemId) return item;
          found = true;
          return { ...item, title, category, body, published: true, updatedAt, createdBy: currentUser.uid };
        });
        if (!found) throw new Error("La publicación ya no existe. Actualiza los datos e inténtalo de nuevo.");
        return updated;
      }
      return [...items, {
        id: itemId, title, category, body, published: true, updatedAt, createdBy: currentUser.uid
      }];
    });
    portalItems = nextItems;
    writeLocalCache("portal", portalItems);
    editingPortalId = null;
    renderPortal();
    const query = document.querySelector("#global-search").value;
    if (query.trim()) renderSearchResults(query);
    showToast("Contenido publicado.");
  } catch (error) {
    showToast(`No se pudo guardar: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

function renderShifts() {
  const sortedShifts = [...shifts].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  mainView.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">COBERTURA OPERATIVA</p><h2>Calendario de guardias</h2><p class="muted">Consulta los turnos asignados al equipo.</p></div></div>
    ${isAdmin() ? `<form id="shift-form" class="editor-card shift-form">
      <div class="editor-heading"><h3>Asignar una guardia</h3></div>
      <div class="shift-fields"><div><label for="shift-person">Asesor o responsable</label><input id="shift-person" maxlength="120" required ${shiftsLoaded ? "" : "disabled"}></div>
      <div><label for="shift-date">Fecha</label><input id="shift-date" type="date" required ${shiftsLoaded ? "" : "disabled"}></div>
      <div><label for="shift-start">Inicio</label><input id="shift-start" type="time" value="09:00" required ${shiftsLoaded ? "" : "disabled"}></div>
      <div><label for="shift-end">Fin</label><input id="shift-end" type="time" value="18:00" required ${shiftsLoaded ? "" : "disabled"}></div>
      <div><label for="shift-department">Departamento</label><select id="shift-department" required ${shiftsLoaded ? "" : "disabled"}><option value="" selected disabled>Selecciona</option><option value="Administración">Administración</option><option value="Soporte Técnico">Soporte</option><option value="Atención al Cliente">Atención al cliente</option><option value="Ventas">Ventas</option></select></div>
      <button class="button button-primary" type="submit" ${shiftsLoaded ? "" : "disabled"}>＋ Asignar turno</button></div>
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
      const nextShifts = await mutateWorkspaceItems("shifts", (items) => {
        const updated = items.filter((shift) => shift.id !== button.dataset.id);
        if (updated.length === items.length) {
          throw new Error("La guardia ya no existe. Actualiza los datos e inténtalo de nuevo.");
        }
        return updated;
      });
      shifts = nextShifts;
      writeLocalCache("shifts", shifts);
      renderShifts();
      updateCurrentDuty();
      showToast("Turno eliminado.");
    } catch (error) {
      showToast(`No se pudo eliminar: ${error.message}`);
    }
  }));
}

async function createShift(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const person = document.querySelector("#shift-person").value.trim();
  const date = document.querySelector("#shift-date").value;
  const start = document.querySelector("#shift-start").value;
  const end = document.querySelector("#shift-end").value;
  const department = document.querySelector("#shift-department").value;
  if (!person || !date || !start || !end || !department || end <= start) {
    showToast("Revisa los datos: selecciona un departamento y verifica que la hora de fin sea posterior al inicio.");
    return;
  }
  submitButton.disabled = true;
  try {
    const newShift = {
      id: createContentId(),
      person, date, start, end, department
    };
    const nextShifts = await mutateWorkspaceItems("shifts", (items) => [...items, newShift]);
    shifts = nextShifts;
    writeLocalCache("shifts", shifts);
    renderShifts();
    updateCurrentDuty();
    event.target.reset();
    document.querySelector("#shift-start").value = "09:00";
    document.querySelector("#shift-end").value = "18:00";
    showToast("Guardia asignada.");
  } catch (error) {
    showToast(`No se pudo asignar: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

function renderSpeeches() {
  const cards = speeches.map((speech) => `
    <article class="content-card speech-card">
      <div class="speech-card-heading"><div><p class="eyebrow">GUION DE ATENCIÓN</p><h3>${escapeHtml(speech.title)}</h3></div></div>
      <p class="speech-description">${escapeHtml(speech.description).replace(/\n/g, "<br>")}</p>
      <div class="speech-text">${escapeHtml(speech.text).replace(/\n/g, "<br>")}</div>
      <div class="card-actions speech-actions">
        <button class="text-button copy-speech" data-id="${escapeHtml(speech.id)}" type="button">Copiar</button>
        ${isAdmin() ? `<button class="text-button edit-speech" data-id="${escapeHtml(speech.id)}" type="button">Editar</button><button class="text-button danger delete-speech" data-id="${escapeHtml(speech.id)}" type="button">Eliminar</button>` : ""}
      </div>
    </article>`).join("");
  mainView.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">RECURSOS DE ATENCIÓN</p><h2>Speech de atención</h2><p class="muted">Guiones y respuestas aprobadas para atender a clientes.</p></div>
      <div class="admin-actions">
        ${isAdmin() ? `<button id="new-speech" class="button button-primary" type="button" ${speechesLoaded ? "" : "disabled"}>＋ Agregar speech</button>` : ""}
      </div>
    </div>
    ${isAdmin() ? `<form id="speech-form" class="editor-card hidden">
      <div class="editor-heading"><h3 id="speech-form-title">${editingSpeechId ? "Editar speech" : "Agregar speech"}</h3><button id="cancel-speech" class="text-button" type="button">Cancelar</button></div>
      <label for="speech-title">Nombre del speech</label><input id="speech-title" maxlength="120" required>
      <label for="speech-description">Descripción</label><textarea id="speech-description" rows="2" maxlength="500" required></textarea>
      <label for="speech-text">Texto para copiar</label><textarea id="speech-text" rows="6" maxlength="10000" required></textarea>
      <button class="button button-primary" type="submit">Guardar speech</button>
    </form>` : ""}
    ${!speechesLoaded ? `<div class="empty-state"><span>…</span><h3>${speechLoadError ? "No se pudieron cargar los speeches" : "Cargando speeches"}</h3><p>${speechLoadError ? escapeHtml(speechLoadError) : "Un momento, estamos consultando el repositorio."}</p></div>` :
      `<div class="speech-grid">${cards || '<div class="empty-state"><span>☷</span><h3>Aún no hay speeches</h3><p>Los guiones aprobados aparecerán aquí.</p></div>'}</div>`}`;
  bindSpeechActions();
}

function bindSpeechActions() {
  const form = document.querySelector("#speech-form");
  document.querySelector("#new-speech")?.addEventListener("click", () => {
    editingSpeechId = null;
    form?.reset();
    const formTitle = form?.querySelector("#speech-form-title");
    if (formTitle) formTitle.textContent = "Agregar speech";
    form?.classList.remove("hidden");
    form?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.querySelector("#cancel-speech")?.addEventListener("click", () => {
    editingSpeechId = null;
    form?.classList.add("hidden");
  });
  form?.addEventListener("submit", saveSpeech);
  document.querySelectorAll(".copy-speech").forEach((button) => button.addEventListener("click", async () => {
    const speech = speeches.find((item) => item.id === button.dataset.id);
    if (!speech) return;
    try {
      await navigator.clipboard.writeText(speech.text);
      showToast("Speech copiado al portapapeles.");
    } catch (error) {
      showToast(`No se pudo copiar el speech: ${error.message}`);
    }
  }));
  document.querySelectorAll(".edit-speech").forEach((button) => button.addEventListener("click", () => {
    const speech = speeches.find((item) => item.id === button.dataset.id);
    if (!speech || !form) return;
    editingSpeechId = speech.id;
    form.querySelector("#speech-title").value = speech.title;
    form.querySelector("#speech-description").value = speech.description;
    form.querySelector("#speech-text").value = speech.text;
    form.querySelector("#speech-form-title").textContent = "Editar speech";
    form.classList.remove("hidden");
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }));
  document.querySelectorAll(".delete-speech").forEach((button) => button.addEventListener("click", async () => {
    const speech = speeches.find((item) => item.id === button.dataset.id);
    if (!speech || !window.confirm(`¿Eliminar el speech «${speech.title}»?`)) return;
    try {
      const nextSpeeches = await mutateWorkspaceItems("speeches", (items) => {
        const updated = items.filter((item) => item.id !== speech.id);
        if (updated.length === items.length) {
          throw new Error("El speech ya no existe. Actualiza los datos e inténtalo de nuevo.");
        }
        return updated;
      });
      speeches = nextSpeeches;
      writeLocalCache("speeches", speeches);
      renderSpeeches();
      showToast("Speech eliminado.");
    } catch (error) {
      showToast(`No se pudo eliminar: ${error.message}`);
    }
  }));
}

async function saveSpeech(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const title = document.querySelector("#speech-title").value.trim();
  const description = document.querySelector("#speech-description").value.trim();
  const text = document.querySelector("#speech-text").value.trim();
  if (!title || !description || !text) {
    showToast("Completa el nombre, la descripción y el texto del speech.");
    return;
  }
  submitButton.disabled = true;
  const updatedAt = new Date().toISOString();
  const editingId = editingSpeechId;
  const speechId = editingId || createContentId();
  try {
    const nextSpeeches = await mutateWorkspaceItems("speeches", (items) => {
      if (editingId) {
        let found = false;
        const updated = items.map((item) => {
          if (item.id !== editingId) return item;
          found = true;
          return { ...item, title, description, text, updatedAt };
        });
        if (!found) throw new Error("El speech ya no existe. Actualiza los datos e inténtalo de nuevo.");
        return updated;
      }
      return [...items, { id: speechId, title, description, text, updatedAt }];
    });
    speeches = nextSpeeches;
    writeLocalCache("speeches", speeches);
    editingSpeechId = null;
    renderSpeeches();
    showToast("Speech guardado.");
  } catch (error) {
    showToast(`No se pudo guardar el speech: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

async function loadSpeechData(forceRefresh = false) {
  if (speechLoadPromise) return speechLoadPromise;
  const cached = readLocalCache("speeches");
  if (cached && !forceRefresh) {
    speeches = cached.items;
    speechesLoaded = true;
    updateLastSyncLabel();
    if (activeView === "speech") renderSpeeches();
    return;
  }
  if (cached) speeches = cached.items;
  speechesLoaded = Boolean(cached);
  speechLoadError = "";
  if (activeView === "speech") renderSpeeches();

  speechLoadPromise = (async () => {
    try {
      const items = await getWorkspaceItems("speeches");
      speeches = items || [];
      speechesLoaded = true;
      speechLoadError = "";
      if (items) writeLocalCache("speeches", speeches);
      updateLastSyncLabel();
      if (activeView === "speech") renderSpeeches();
      if (forceRefresh) showToast("Speech actualizado desde Firebase.");
    } catch (error) {
      speechLoadError = error.message;
      showToast(`No se pudieron cargar los speeches: ${error.message}`);
      if (activeView === "speech") renderSpeeches();
    }
  })();
  try {
    await speechLoadPromise;
  } finally {
    speechLoadPromise = null;
  }
}

function renderReservedView(view) {
  const descriptions = {
    pdf: ["Herramientas para documentos", "El convertidor está reservado para una futura herramienta de maquetación en el navegador."],
    auxiliary: ["Un espacio para nuevas ideas", "Este módulo está listo para crecer con las necesidades del equipo."]
  };
  const [title, description] = descriptions[view];
  mainView.innerHTML = `<div class="section-heading"><div><p class="eyebrow">PRÓXIMAMENTE</p><h2>${escapeHtml(viewNames[view])}</h2><p class="muted">${escapeHtml(description)}</p></div></div>
    <div class="placeholder-card"><div class="placeholder-icon">${view === "pdf" ? "▧" : "＋"}</div><h3>${escapeHtml(title)}</h3><p>La estructura está preparada para una próxima actualización de SwiftDesk.</p><span class="coming-soon">MÓDULO PREPARADO</span></div>`;
}

function selectView(view) {
  if (!viewNames[view]) return;
  if (view === "team" && !isAdmin()) return;
  activeView = view;
  document.querySelector("#breadcrumb-current").textContent = viewNames[view];
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "portal") renderPortal();
  else if (view === "calendar") renderShifts();
  else if (view === "speech") {
    renderSpeeches();
    loadSpeechData();
  }
  else if (view === "suggestions") {
    renderSuggestions();
    loadSuggestions();
  }
  else if (view === "team") renderTeamManagement();
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

function updateLastSyncLabel() {
  const label = document.querySelector("#last-sync");
  if (!label) return;
  const cachedSpeeches = readLocalCache("speeches");
  const collectionNames = cachedSpeeches ? ["portal", "shifts", "speeches"] : ["portal", "shifts"];
  const timestamps = collectionNames.map((name) => readLocalCache(name)?.savedAt).filter(Number.isFinite);
  if (timestamps.length < 2) {
    label.textContent = "Datos aún no sincronizados";
    return;
  }
  const lastSync = new Date(Math.min(...timestamps));
  label.textContent = `Última actualización: ${new Intl.DateTimeFormat("es", {
    dateStyle: "short", timeStyle: "short"
  }).format(lastSync)}`;
}

async function getWorkspaceItems(moduleId) {
  const reference = firebase.doc(firebase.db, "workspace", moduleId);
  const snapshot = await firebase.getDoc(reference);
  if (!snapshot.exists()) return [];
  const items = snapshot.data().items;
  if (!Array.isArray(items)) {
    throw new Error(`El documento workspace/${moduleId} no contiene una lista "items" válida.`);
  }
  return items;
}

async function mutateWorkspaceItems(moduleId, updateItems) {
  const reference = firebase.doc(firebase.db, "workspace", moduleId);
  return firebase.runTransaction(firebase.db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const items = snapshot.exists() ? snapshot.data().items : [];
    if (!Array.isArray(items)) {
      throw new Error(`El documento workspace/${moduleId} no contiene una lista "items" válida.`);
    }
    const updatedItems = updateItems(items);
    transaction.set(reference, {
      items: updatedItems,
      updatedAt: firebase.serverTimestamp()
    });
    return updatedItems;
  });
}

async function loadWorkspaceData(forceRefresh = false) {
  const portalCache = readLocalCache("portal");
  const shiftsCache = readLocalCache("shifts");
  portalLoaded = Boolean(portalCache);
  shiftsLoaded = Boolean(shiftsCache);
  if (forceRefresh) {
    portalLoaded = false;
    shiftsLoaded = false;
  }
  if (portalCache) portalItems = portalCache.items;
  if (shiftsCache) shifts = shiftsCache.items;
  updateLastSyncLabel();
  selectView(activeView);
  updateCurrentDuty();

  const errors = [];
  const requests = [];
  if (forceRefresh || !portalCache) {
    requests.push(getWorkspaceItems("portal")
      .then((items) => {
        portalItems = items || [];
        portalLoaded = true;
        if (items) writeLocalCache("portal", portalItems);
      })
      .catch((error) => {
        portalLoaded = Boolean(portalCache);
        errors.push(`portal: ${error.message}`);
      }));
  }
  if (forceRefresh || !shiftsCache) {
    requests.push(getWorkspaceItems("shifts")
      .then((items) => {
        shifts = items || [];
        shiftsLoaded = true;
        if (items) writeLocalCache("shifts", shifts);
      })
      .catch((error) => {
        shiftsLoaded = Boolean(shiftsCache);
        errors.push(`guardias: ${error.message}`);
      }));
  }
  await Promise.all(requests);
  updateLastSyncLabel();
  selectView(activeView);
  updateCurrentDuty();
  const query = document.querySelector("#global-search").value;
  if (query.trim()) renderSearchResults(query);
  if (errors.length) showToast(`No se pudieron actualizar los datos (${errors.join("; ")}).`);
  else if (forceRefresh) showToast("Datos actualizados desde Firebase.");
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

async function handleAuthState(user) {
  const previousUid = currentUser?.uid;
  if (user && currentProfileUid === user.uid && currentProfile) {
    currentUser = user;
    return;
  }
  if (user && authInitializationUid === user.uid && authInitializationPromise) {
    return authInitializationPromise;
  }

  currentUser = user;
  currentProfile = null;
  currentProfileUid = null;
  portalItems = [];
  shifts = [];
  portalLoaded = false;
  shiftsLoaded = false;
  speeches = [];
  speechesLoaded = false;
  speechLoadError = "";
  speechLoadPromise = null;
  suggestions = [];
  suggestionsLoaded = false;
  suggestionsLoading = false;
  suggestionsLoadError = "";
  suggestionsLoadPromise = null;
  editingSpeechId = null;
  teamMembers = [];
  if (!user) {
    if (previousUid) clearLocalDataCache(previousUid);
    authInitializationUid = null;
    authInitializationPromise = null;
    const reason = pendingAuthRedirectReason || "session";
    pendingAuthRedirectReason = null;
    window.location.replace(`./index.html?reason=${reason}`);
    return;
  }

  if (previousUid && previousUid !== user.uid) clearLocalDataCache(previousUid);
  authInitializationUid = user.uid;
  const initialization = initializeAuthenticatedUser(user);
  authInitializationPromise = initialization;
  try {
    await initialization;
  } finally {
    if (authInitializationPromise === initialization) {
      authInitializationUid = null;
      authInitializationPromise = null;
    }
  }
}

async function initializeAuthenticatedUser(user) {
  try {
    const profileSnapshot = await firebase.getDoc(firebase.doc(firebase.db, "users", user.uid));
    if (currentUser?.uid !== user.uid) return;
    if (!profileSnapshot.exists()) {
      pendingAuthRedirectReason = "profile";
      await firebase.signOut(firebase.auth);
      window.location.replace("./index.html?reason=profile");
      return;
    }
    const profile = profileSnapshot.data();
    if (!["admin", "advisor"].includes(profile.role)) {
      pendingAuthRedirectReason = "profile";
      await firebase.signOut(firebase.auth);
      window.location.replace("./index.html?reason=profile");
      return;
    }
    currentProfile = profile;
    currentProfileUid = user.uid;
    document.querySelector('[data-view="suggestions"]').classList.toggle("hidden", !isAdmin());
    document.querySelector('[data-view="team"]').classList.toggle("hidden", !isAdmin());
    loadUserNotes();
    dashboardStatus.classList.add("hidden");
    appShell.classList.remove("hidden");
    const displayName = profile.name || user.displayName || user.email || "Usuario";
    document.querySelector("#user-name").textContent = displayName;
    document.querySelector("#user-role").textContent = roleNames[profile.role];
    document.querySelector("#user-avatar").textContent = displayName.charAt(0).toLocaleUpperCase();
    document.querySelector("#welcome-copy").textContent = `Qué bueno tenerte aquí, ${displayName}. Aquí tienes las novedades y recursos para tu jornada.`;
    updateGreeting();
    await loadWorkspaceData();
  } catch (error) {
    if (currentUser?.uid !== user.uid) return;
    currentProfile = null;
    currentProfileUid = null;
    dashboardStatus.textContent = `No se pudo validar tu perfil. Revisa tu conexión y vuelve a cargar: ${error.message}`;
    dashboardStatus.classList.add("error");
    dashboardStatus.classList.remove("hidden");
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
    const suggestionRef = await firebase.addDoc(firebase.collection(firebase.db, "suggestions"), {
      text,
      uid: currentUser.uid,
      email: currentUser.email || "",
      createdAt: firebase.serverTimestamp()
    });
    if (isAdmin() && suggestionsLoaded) {
      suggestions.unshift({
        id: suggestionRef.id,
        text,
        uid: currentUser.uid,
        email: currentUser.email || "",
        createdAt: new Date()
      });
      if (activeView === "suggestions") renderSuggestions();
    }
    field.value = "";
    showMessage(message, "¡Gracias! Tu sugerencia fue enviada.");
  } catch (error) {
    showMessage(message, `No se pudo enviar: ${error.message}`, true);
  }
}

function renderSuggestions() {
  if (!isAdmin()) {
    mainView.innerHTML = '<div class="empty-state"><h3>Sección no disponible</h3></div>';
    return;
  }
  const sortedSuggestions = [...suggestions].sort((a, b) => {
    const timestamp = (value) => value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime();
    return timestamp(b.createdAt) - timestamp(a.createdAt);
  });
  const content = suggestionsLoading
    ? '<div class="empty-state"><h3>Cargando sugerencias</h3><p>Un momento, estamos consultando los mensajes recibidos.</p></div>'
    : suggestionsLoadError
      ? `<div class="empty-state"><h3>No se pudieron cargar las sugerencias</h3><p>${escapeHtml(suggestionsLoadError)}</p></div>`
      : `<div class="suggestion-list">${sortedSuggestions.map((suggestion) => `
        <article class="suggestion-card">
          <div class="suggestion-meta"><strong>${escapeHtml(suggestion.email || "Usuario")}</strong><span>${escapeHtml(formatDate(suggestion.createdAt))}</span></div>
          <p>${escapeHtml(suggestion.text).replace(/\n/g, "<br>")}</p>
        </article>`).join("") || '<div class="empty-state"><span>✉</span><h3>No hay sugerencias todavía</h3><p>Las propuestas enviadas desde el buzón aparecerán aquí.</p></div>'}</div>`;
  mainView.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">IDEAS DEL EQUIPO</p><h2>Sugerencias recibidas</h2><p class="muted">Solo los administradores pueden consultar estos mensajes.</p></div>
      <button id="refresh-suggestions" class="button button-secondary" type="button" ${suggestionsLoading ? "disabled" : ""}>Actualizar sugerencias</button>
    </div>
    ${content}`;
  document.querySelector("#refresh-suggestions")?.addEventListener("click", () => loadSuggestions(true));
}

async function loadSuggestions(forceRefresh = false) {
  if (!isAdmin()) return;
  if (suggestionsLoadPromise) return suggestionsLoadPromise;
  if (suggestionsLoaded && !forceRefresh) {
    renderSuggestions();
    return;
  }
  suggestionsLoading = true;
  suggestionsLoadError = "";
  renderSuggestions();
  const request = (async () => {
    try {
      const snapshot = await firebase.getDocs(firebase.collection(firebase.db, "suggestions"));
      suggestions = snapshot.docs.map((suggestionDoc) => {
        const suggestion = suggestionDoc.data();
        return {
          id: suggestionDoc.id,
          text: suggestion.text || "",
          email: suggestion.email || "",
          createdAt: suggestion.createdAt || null
        };
      });
      suggestionsLoaded = true;
      if (forceRefresh) showToast("Sugerencias actualizadas.");
    } catch (error) {
      suggestionsLoadError = error.message;
      showToast(`No se pudieron cargar las sugerencias: ${error.message}`);
    } finally {
      suggestionsLoading = false;
      suggestionsLoadPromise = null;
      if (activeView === "suggestions") renderSuggestions();
    }
  })();
  suggestionsLoadPromise = request;
  return request;
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

async function refreshActiveView(button = null) {
  const originalContent = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.textContent = "Actualizando...";
  }
  try {
    if (activeView === "speech") await loadSpeechData(true);
    else if (activeView === "suggestions") await loadSuggestions(true);
    else if (activeView === "team") await loadTeamMembers(true);
    else await loadWorkspaceData(true);
  } catch (error) {
    showToast(`No se pudieron actualizar los datos: ${error.message}`);
  } finally {
    if (button) {
      button.innerHTML = originalContent;
      button.disabled = false;
    }
  }
}

function setupPullToRefresh() {
  const scrollArea = document.querySelector(".content-area");
  const indicator = document.querySelector("#pull-refresh-indicator");
  const label = document.querySelector("#pull-refresh-label");
  if (!scrollArea || !indicator || !label) return;

  let startY = null;
  let pullDistance = 0;
  let refreshing = false;
  const threshold = 72;
  const resetIndicator = () => {
    indicator.classList.remove("visible", "ready", "refreshing");
    label.textContent = "Desliza hacia abajo para actualizar";
  };

  scrollArea.addEventListener("touchstart", (event) => {
    if (refreshing || event.touches.length !== 1 || scrollArea.scrollTop > 0) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
    startY = event.touches[0].clientY;
    pullDistance = 0;
  }, { passive: true });

  scrollArea.addEventListener("touchmove", (event) => {
    if (startY === null || event.touches.length !== 1 || refreshing) return;
    const distance = event.touches[0].clientY - startY;
    if (distance <= 0) return;
    if (scrollArea.scrollTop > 0) {
      startY = null;
      return;
    }
    event.preventDefault();
    pullDistance = Math.min(distance, 110);
    indicator.classList.add("visible");
    const ready = pullDistance >= threshold;
    indicator.classList.toggle("ready", ready);
    label.textContent = ready ? "Suelta para actualizar" : "Desliza hacia abajo para actualizar";
  }, { passive: false });

  scrollArea.addEventListener("touchend", async () => {
    const shouldRefresh = pullDistance >= threshold && !refreshing;
    startY = null;
    pullDistance = 0;
    if (!shouldRefresh) {
      if (!refreshing) resetIndicator();
      return;
    }
    refreshing = true;
    indicator.classList.add("visible", "refreshing");
    label.textContent = "Actualizando...";
    try {
      await refreshActiveView();
    } finally {
      refreshing = false;
      window.setTimeout(resetIndicator, 250);
    }
  }, { passive: true });

  scrollArea.addEventListener("touchcancel", () => {
    startY = null;
    pullDistance = 0;
    if (!refreshing) resetIndicator();
  }, { passive: true });
}

function setupUI() {
  document.querySelector("#logout-button").addEventListener("click", async () => {
    try {
      clearLocalDataCache(currentUser.uid);
      await firebase.signOut(firebase.auth);
      window.location.replace("./index.html");
    } catch (error) {
      showToast(`No se pudo cerrar la sesión: ${error.message}`);
    }
  });
  document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.view)));
  document.querySelector("#refresh-workspace").addEventListener("click", (event) => refreshActiveView(event.currentTarget));
  document.querySelector("#global-search").addEventListener("input", (event) => renderSearchResults(event.target.value));
  document.querySelector("#open-sidebar").addEventListener("click", openSidebar);
  document.querySelector("#close-sidebar").addEventListener("click", closeSidebar);
  document.querySelector("#sidebar-scrim").addEventListener("click", closeSidebar);
  setupPullToRefresh();
  setupUtilityPanels();
  updateGreeting();
}

setupUI();
try {
  firebase = await firebaseReady;
  firebase.onAuthStateChanged(firebase.auth, handleAuthState);
} catch (error) {
  dashboardStatus.textContent = `No se pudo iniciar Firebase: ${error.message}`;
  dashboardStatus.classList.add("error");
  dashboardStatus.classList.remove("hidden");
}
