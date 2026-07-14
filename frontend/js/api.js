// Change this if your backend runs on a different host/port.
const API_BASE = "/api";

const Auth = {
  getToken() { return localStorage.getItem("token"); },
  getUser() {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  },
  save(token, user) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  },
  isLoggedIn() { return !!this.getToken(); },
  requireAuth() {
    if (!this.isLoggedIn()) window.location.href = "index.html";
  },
  requireAdmin() {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user || user.role !== "admin") {
      window.location.href = "dashboard.html";
    }
  },
  logout() {
    this.clear();
    window.location.href = "index.html";
  },
};

async function apiRequest(path, { method = "GET", body, isForm = false } = {}) {
  const headers = {};
  const token = Auth.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (res.status === 401) {
    Auth.clear();
    window.location.href = "index.html";
    throw new Error(data.message || "Session expired.");
  }

  if (!res.ok) {
    throw new Error(data.message || "Something went wrong.");
  }
  return data;
}

// Uploads a file with real progress reporting via XHR (fetch has no
// upload progress event). Resolves with the parsed JSON response.
function apiUpload(path, formData, { onProgress, xhrRef } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (xhrRef) xhrRef.current = xhr;
    xhr.open("POST", `${API_BASE}${path}`);
    const token = Auth.getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* no body */ }
      if (xhr.status === 401) {
        Auth.clear();
        window.location.href = "index.html";
        return reject(new Error(data.message || "Session expired."));
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.message || "Upload failed."));
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.send(formData);
  });
}

/* ============================= Theme ============================= */
const Theme = {
  key: "theme",
  get() { return localStorage.getItem(this.key) || "dark"; },
  apply(mode) {
    document.documentElement.setAttribute("data-theme", mode);
  },
  init() { this.apply(this.get()); },
  toggle() {
    const next = this.get() === "light" ? "dark" : "light";
    localStorage.setItem(this.key, next);
    this.apply(next);
  },
};
Theme.init();

/* ============================ Avatars ============================ */
// Avatar photos live only in this browser's localStorage, keyed per
// user id, since there is no server-side avatar endpoint.
const AvatarStore = {
  keyFor(userId) { return `avatar_${userId}`; },
  get(userId) { return userId ? localStorage.getItem(this.keyFor(userId)) : null; },
  set(userId, dataUrl) { localStorage.setItem(this.keyFor(userId), dataUrl); },
  remove(userId) { localStorage.removeItem(this.keyFor(userId)); },
};

// Resizes/center-crops an image file down to a small square JPEG data
// URL so it stores compactly in localStorage.
function fileToAvatarDataUrl(file, size = 220) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Please choose an image file."));
    if (file.size > 8 * 1024 * 1024) return reject(new Error("Image is too large (max 8MB)."));
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => reject(new Error("Couldn't load that image."));
    reader.readAsDataURL(file);
  });
}

// Returns markup for an avatar circle: an <img> if a local photo is
// stored for this user, otherwise the gradient initials fallback.
function avatarHtml(user, opts = {}) {
  const size = opts.size || 30;
  const extraClass = opts.className || "";
  const photo = user ? AvatarStore.get(user.id) : null;
  const style = size !== 30 ? `style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;"` : "";
  if (photo) {
    return `<div class="avatar has-image ${extraClass}" ${style}><img src="${photo}" alt="${(user.name || "User")}" /></div>`;
  }
  return `<div class="avatar ${extraClass}" ${style}>${initials(user ? user.name : "")}</div>`;
}

/* ======================= Recently viewed files ===================== */
const RecentFiles = {
  keyFor(userId) { return `recent_files_${userId}`; },
  get(userId) {
    if (!userId) return [];
    try { return JSON.parse(localStorage.getItem(this.keyFor(userId)) || "[]"); }
    catch (e) { return []; }
  },
  add(userId, item) {
    if (!userId) return;
    let list = this.get(userId).filter((f) => f.key !== item.key);
    list.unshift(item);
    list = list.slice(0, 8);
    localStorage.setItem(this.keyFor(userId), JSON.stringify(list));
  },
};

/* ============================== Utils ============================== */
function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function formatBytes(bytes) {
  if (bytes === 0 || bytes === undefined || bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Returns { cls, label } for a coloured file-type badge based on extension.
// Used in place of emoji icons across the file tables.
function badgeFor(item) {
  if (item.type === "folder") {
    return { cls: "type-folder", label: "folder", isFolder: true };
  }
  const ext = (item.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return { cls: "type-pdf", label: "PDF" };
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return { cls: "type-doc", label: ext.slice(0, 3).toUpperCase() };
  if (["xls", "xlsx", "csv"].includes(ext)) return { cls: "type-sheet", label: ext.slice(0, 3).toUpperCase() };
  if (["ppt", "pptx", "key"].includes(ext)) return { cls: "type-slide", label: "PPT" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return { cls: "type-image", label: "IMG" };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { cls: "type-archive", label: "ZIP" };
  return { cls: "type-generic", label: (ext || "file").slice(0, 4).toUpperCase() };
}

function isImageItem(item) {
  if (!item || item.type !== "file") return false;
  const ext = (item.name.split(".").pop() || "").toLowerCase();
  return ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(ext);
}
function isPdfItem(item) {
  return item && item.type === "file" && item.name.toLowerCase().endsWith(".pdf");
}

function folderIconSvg() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>`;
}

// Builds the coloured badge markup for a file/folder row.
function badgeHtml(item) {
  const b = badgeFor(item);
  if (b.isFolder) return `<span class="file-badge ${b.cls}">${folderIconSvg()}</span>`;
  return `<span class="file-badge ${b.cls}">${b.label}</span>`;
}

/* ============================== Toasts ============================== */
function showToast(message, type = "success") {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  stack.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));

  const remove = () => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 250);
  };
  setTimeout(remove, 3200);
}

/* ========================= Ripple micro-interaction ========================= */
document.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest(".btn, .icon-btn");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
});

/* ========================= Lightbox preview ========================= */
function ensureLightbox() {
  let overlay = document.getElementById("lightbox-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "lightbox-overlay";
  overlay.className = "lightbox-overlay";
  overlay.innerHTML = `
    <div class="lightbox-box">
      <div class="lightbox-head">
        <span class="name" id="lightbox-name"></span>
        <a class="btn btn-outline btn-sm" id="lightbox-download" target="_blank" rel="noopener">Download</a>
        <button class="icon-btn" id="lightbox-close" aria-label="Close preview">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="lightbox-body" id="lightbox-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeLightbox(); });
  overlay.querySelector("#lightbox-close").addEventListener("click", closeLightbox);
  return overlay;
}
function closeLightbox() {
  const overlay = document.getElementById("lightbox-overlay");
  if (overlay) { overlay.classList.remove("visible"); overlay.querySelector("#lightbox-body").innerHTML = ""; }
}
function openLightbox(item, url) {
  const overlay = ensureLightbox();
  document.getElementById("lightbox-name").textContent = item.name;
  document.getElementById("lightbox-download").href = url;
  const body = document.getElementById("lightbox-body");
  if (isImageItem(item)) {
    body.innerHTML = `<img src="${url}" alt="${escapeHtml(item.name)}" />`;
  } else if (isPdfItem(item)) {
    body.innerHTML = `<iframe src="${url}" title="${escapeHtml(item.name)}"></iframe>`;
  } else {
    body.innerHTML = `<div class="no-preview"><div class="big-icon">📄</div>No inline preview for this file type.<br>Use Download to open it.</div>`;
  }
  overlay.classList.add("visible");
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

/* ========================= Simple context menu ========================= */
function ensureContextMenu() {
  let menu = document.getElementById("context-menu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  document.body.appendChild(menu);
  document.addEventListener("click", () => menu.classList.remove("visible"));
  window.addEventListener("scroll", () => menu.classList.remove("visible"), true);
  return menu;
}
// actions: [{ label, icon, danger, onClick }]
function openContextMenu(x, y, actions) {
  const menu = ensureContextMenu();
  menu.innerHTML = actions.map((a, i) =>
    a.divider ? "<hr/>" : `<button data-i="${i}" class="${a.danger ? "danger" : ""}">${a.icon || ""}${a.label}</button>`
  ).join("");
  menu.querySelectorAll("button[data-i]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.remove("visible");
      actions[Number(btn.dataset.i)].onClick();
    });
  });
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.visibility = "hidden";
  menu.classList.add("visible");
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, vw - rect.width - 10)}px`;
  menu.style.top = `${Math.min(y, vh - rect.height - 10)}px`;
  menu.style.visibility = "visible";
}

/* ============================ Icons (shared) ============================ */
const ICONS = {
  sun: `<svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  moon: `<svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 19c-7 0-11-7-11-7a19.3 19.3 0 0 1 4.2-5.1M9.5 5.2A9.9 9.9 0 0 1 12 5c7 0 11 7 11 7a19.4 19.4 0 0 1-2.4 3.3M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="14" r="3.5"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/></svg>`,
  viewEye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

/* ========================= Shared top navigation ========================= */
// Renders the shared top navigation bar into #topbar-root, highlighting
// the current page, showing the avatar/photo, a theme toggle, and a
// mobile hamburger menu for the nav links.
function renderTopbar(activePage) {
  const root = document.getElementById("topbar-root");
  if (!root) return;
  const user = Auth.getUser();
  if (!user) return;

  root.innerHTML = `
    <div class="brand"><span class="logo">☁</span> SecureDocs</div>
    <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Open menu">${ICONS.menu}</button>
    <div class="nav-links" id="nav-links">
      <a href="dashboard.html" class="${activePage === "dashboard" ? "active" : ""}">My Files</a>
      ${user.role === "admin" ? `<a href="admin.html" class="${activePage === "admin" ? "active" : ""}">Admin</a>` : ""}
      <a href="profile.html" class="${activePage === "profile" ? "active" : ""}">Profile</a>
      <div class="user-chip">
        ${avatarHtml(user)}
        <span>${escapeHtml(user.name)}</span>
      </div>
      <button class="icon-btn theme-toggle" id="theme-toggle-btn" aria-label="Toggle theme">${ICONS.sun}${ICONS.moon}</button>
      <button class="btn btn-outline btn-sm" id="logout-btn">Sign out</button>
    </div>
  `;
  document.getElementById("logout-btn").addEventListener("click", () => Auth.logout());
  document.getElementById("theme-toggle-btn").addEventListener("click", () => Theme.toggle());

  const navLinks = document.getElementById("nav-links");
  const menuToggle = document.getElementById("menu-toggle");
  menuToggle.addEventListener("click", () => navLinks.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!navLinks.contains(e.target) && !menuToggle.contains(e.target)) navLinks.classList.remove("open");
  });
}
