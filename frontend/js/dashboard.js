Auth.requireAuth();
renderTopbar("dashboard");

const CURRENT_USER = Auth.getUser();

let currentPath = ""; // "" = root, otherwise "folder/subfolder"
let pendingDelete = null; // { key, name } or { bulk: true, keys: [] }
let currentItems = []; // raw items for the current folder, as loaded from the API
let searchTerm = "";
let sortKey = "name";
let sortDir = 1; // 1 = asc, -1 = desc
let viewMode = localStorage.getItem("fileViewMode") || "list"; // "list" | "grid"
let selectedKeys = new Set();
let uploadSeq = 0;

const fileListEl = document.getElementById("file-list");
const fileGridEl = document.getElementById("file-grid");
const fileTableEl = document.getElementById("file-table");
const breadcrumbEl = document.getElementById("breadcrumb");
const fileInput = document.getElementById("file-input");
const statStripEl = document.getElementById("stat-strip");
const breakdownEl = document.getElementById("breakdown-card");
const recentStripEl = document.getElementById("recent-strip");
const recentRowEl = document.getElementById("recent-row");
const searchInput = document.getElementById("search-input");
const searchBox = document.getElementById("search-box");
const tableCard = document.getElementById("table-card");
const bulkBar = document.getElementById("bulk-bar");
const bulkCountEl = document.getElementById("bulk-count");
const selectAllChk = document.getElementById("select-all-chk");
const uploadTray = document.getElementById("upload-tray");

/* ---------------- View toggle ---------------- */
const viewListBtn = document.getElementById("view-list-btn");
const viewGridBtn = document.getElementById("view-grid-btn");
viewListBtn.innerHTML = ICONS.list;
viewGridBtn.innerHTML = ICONS.grid;

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem("fileViewMode", mode);
  viewListBtn.classList.toggle("active", mode === "list");
  viewGridBtn.classList.toggle("active", mode === "grid");
  fileTableEl.style.display = mode === "list" ? "table" : "none";
  fileGridEl.style.display = mode === "grid" ? "grid" : "none";
  renderList();
}
viewListBtn.addEventListener("click", () => setViewMode("list"));
viewGridBtn.addEventListener("click", () => setViewMode("grid"));

/* ---------------- Breadcrumb ---------------- */
function renderBreadcrumb() {
  const parts = currentPath ? currentPath.split("/").filter(Boolean) : [];
  let html = `<button data-path="">🏠 My Files</button>`;
  let accum = "";
  parts.forEach((part) => {
    accum += (accum ? "/" : "") + part;
    html += `<span class="sep">/</span><button data-path="${accum}">${escapeHtml(part)}</button>`;
  });
  breadcrumbEl.innerHTML = html;
  breadcrumbEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPath = btn.dataset.path;
      searchInput.value = "";
      searchTerm = "";
      clearSelection();
      loadFiles();
    });
  });
}

/* ---------------- Stats + storage breakdown ---------------- */
function renderStats(items) {
  const folders = items.filter((i) => i.type === "folder").length;
  const files = items.filter((i) => i.type === "file");
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  statStripEl.innerHTML = `
    <div class="stat-card"><div class="stat-label">Folders here</div><div class="stat-value primary">${folders}</div></div>
    <div class="stat-card"><div class="stat-label">Files here</div><div class="stat-value">${files.length}</div></div>
    <div class="stat-card"><div class="stat-label">Storage in view</div><div class="stat-value accent">${formatBytes(totalSize)}</div></div>
  `;
  renderBreakdown(files, totalSize);
}

const TYPE_COLORS = {
  "type-pdf": "#F2645A", "type-doc": "#5B7FFF", "type-sheet": "#33C481",
  "type-image": "#B36BE0", "type-archive": "#E8A34D", "type-slide": "#FF9457", "type-generic": "#5B6478",
};
const TYPE_NAMES = {
  "type-pdf": "PDF", "type-doc": "Docs", "type-sheet": "Sheets",
  "type-image": "Images", "type-archive": "Archives", "type-slide": "Slides", "type-generic": "Other",
};

function renderBreakdown(files, totalSize) {
  if (files.length === 0 || totalSize === 0) { breakdownEl.style.display = "none"; return; }
  const byType = {};
  files.forEach((f) => {
    const cls = badgeFor(f).cls;
    byType[cls] = (byType[cls] || 0) + (f.size || 0);
  });
  const order = Object.keys(byType).sort((a, b) => byType[b] - byType[a]);

  breakdownEl.innerHTML = `
    <div class="breakdown-head">
      <span class="title">Storage breakdown</span>
      <span class="total">${formatBytes(totalSize)} total</span>
    </div>
    <div class="breakdown-bar" id="breakdown-bar"></div>
    <div class="breakdown-legend">
      ${order.map((cls) => `
        <div class="item">
          <span class="swatch" style="background:${TYPE_COLORS[cls]}"></span>
          ${TYPE_NAMES[cls]} · ${formatBytes(byType[cls])}
        </div>
      `).join("")}
    </div>
  `;
  breakdownEl.style.display = "block";

  const barEl = document.getElementById("breakdown-bar");
  barEl.innerHTML = order.map((cls) =>
    `<div class="seg" data-w="${(byType[cls] / totalSize) * 100}" style="background:${TYPE_COLORS[cls]}"></div>`
  ).join("");
  requestAnimationFrame(() => {
    barEl.querySelectorAll(".seg").forEach((seg) => { seg.style.width = `${seg.dataset.w}%`; });
  });
}

/* ---------------- Recently viewed ---------------- */
function renderRecent() {
  const list = RecentFiles.get(CURRENT_USER?.id);
  if (!list.length) { recentStripEl.style.display = "none"; return; }
  recentStripEl.style.display = "block";
  recentRowEl.innerHTML = list.map((item) => `
    <div class="recent-chip" data-key="${escapeHtml(item.key)}" data-name="${escapeHtml(item.name)}">
      ${badgeHtml(item)}
      <span class="rname">${escapeHtml(item.name)}</span>
    </div>
  `).join("");
  recentRowEl.querySelectorAll(".recent-chip").forEach((chip) => {
    chip.addEventListener("click", () => openFile(chip.dataset.key, "view", chip.dataset.name));
  });
}

/* ---------------- Filter + sort ---------------- */
function applyFilterAndSort(items) {
  let out = items;
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    out = out.filter((i) => i.name.toLowerCase().includes(q));
  }
  const folders = out.filter((i) => i.type === "folder");
  const files = out.filter((i) => i.type === "file");

  const cmp = (a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === "name") { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    if (sortKey === "size") { av = a.size || 0; bv = b.size || 0; }
    if (sortKey === "lastModified") { av = a.lastModified ? new Date(a.lastModified).getTime() : 0; bv = b.lastModified ? new Date(b.lastModified).getTime() : 0; }
    if (av < bv) return -1 * sortDir;
    if (av > bv) return 1 * sortDir;
    return 0;
  };
  folders.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  files.sort(cmp);
  return [...folders, ...files];
}

function updateSortArrows() {
  ["name", "size", "lastModified"].forEach((key) => {
    const el = document.getElementById(`arrow-${key}`);
    if (!el) return;
    el.textContent = key === sortKey ? (sortDir === 1 ? "▲" : "▼") : "";
  });
}

/* ---------------- Selection / bulk bar ---------------- */
function clearSelection() {
  selectedKeys.clear();
  updateBulkBar();
}
function updateBulkBar() {
  bulkCountEl.textContent = selectedKeys.size;
  bulkBar.style.display = selectedKeys.size > 0 ? "flex" : "none";
  const visibleFileKeys = applyFilterAndSort(currentItems).filter((i) => i.type === "file").map((i) => i.key);
  const selectedVisible = visibleFileKeys.filter((k) => selectedKeys.has(k));
  selectAllChk.checked = visibleFileKeys.length > 0 && selectedVisible.length === visibleFileKeys.length;
  selectAllChk.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleFileKeys.length;
  document.querySelectorAll("[data-select-key]").forEach((chk) => {
    chk.checked = selectedKeys.has(chk.dataset.selectKey);
  });
}
selectAllChk.addEventListener("change", () => {
  const visibleFileItems = applyFilterAndSort(currentItems).filter((i) => i.type === "file");
  if (selectAllChk.checked) visibleFileItems.forEach((i) => selectedKeys.add(i.key));
  else visibleFileItems.forEach((i) => selectedKeys.delete(i.key));
  updateBulkBar();
});
document.getElementById("bulk-clear-btn").addEventListener("click", clearSelection);
document.getElementById("bulk-download-btn").addEventListener("click", async () => {
  const keys = [...selectedKeys];
  showToast(`Preparing ${keys.length} download${keys.length > 1 ? "s" : ""}…`);
  for (const key of keys) {
    try {
      const data = await apiRequest(`/files/download?key=${encodeURIComponent(key)}&mode=download`);
      const a = document.createElement("a");
      a.href = data.url; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      showToast(`Failed: ${err.message}`, "error");
    }
  }
});
document.getElementById("bulk-delete-btn").addEventListener("click", () => {
  const keys = [...selectedKeys];
  if (!keys.length) return;
  pendingDelete = { bulk: true, keys };
  document.getElementById("delete-message").textContent =
    `This will permanently delete ${keys.length} selected item${keys.length > 1 ? "s" : ""} from S3.`;
  document.getElementById("delete-modal").classList.add("visible");
});

/* ---------------- Rendering: list + grid ---------------- */
function renderList() {
  const items = applyFilterAndSort(currentItems);

  if (currentItems.length === 0) {
    const emptyHtml = `
      <div class="empty-state">
        <div class="big-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:64px;height:64px;color:var(--primary);opacity:0.8;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
        </div>
        <div class="empty-title">This folder is empty</div>
        <div class="empty-sub">Upload a file or create a subfolder to get started.</div>
      </div>`;
    fileListEl.innerHTML = `<tr><td colspan="5">${emptyHtml}</td></tr>`;
    fileGridEl.innerHTML = emptyHtml;
    return;
  }

  if (items.length === 0) {
    const emptyHtml = `
      <div class="empty-state">
        <div class="big-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:64px;height:64px;color:var(--accent);opacity:0.8;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>
        <div class="empty-title">No matches</div>
        <div class="empty-sub">Nothing here matches "${escapeHtml(searchTerm)}".</div>
      </div>`;
    fileListEl.innerHTML = `<tr><td colspan="5">${emptyHtml}</td></tr>`;
    fileGridEl.innerHTML = emptyHtml;
    return;
  }

  if (viewMode === "list") {
    fileListEl.innerHTML = items.map((item, i) => rowHtml(item, i)).join("");
    attachRowHandlers();
  } else {
    fileGridEl.innerHTML = items.map((item, i) => cardHtml(item, i)).join("");
    attachGridHandlers();
    lazyLoadThumbnails();
  }
  updateBulkBar();
}

function rowHtml(item, index) {
  const isFolder = item.type === "folder";
  const delay = Math.min(index, 10) * 35;
  return `
    <tr data-key="${escapeHtml(item.key)}" data-type="${item.type}" data-name="${escapeHtml(item.name)}" style="animation-delay:${delay}ms">
      <td class="chk-col">${!isFolder ? `<input type="checkbox" class="chk" data-select-key="${escapeHtml(item.key)}" />` : ""}</td>
      <td>
        <div class="item-name">
          ${badgeHtml(item)}
          ${isFolder
            ? `<span class="folder-link" data-open-folder="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>`
            : `<span>${escapeHtml(item.name)}</span>`}
        </div>
      </td>
      <td class="mono">${isFolder ? "—" : formatBytes(item.size)}</td>
      <td class="mono">${isFolder ? "—" : formatDate(item.lastModified)}</td>
      <td>
        <div class="row-actions">
          ${!isFolder ? `
            <button class="btn btn-outline btn-sm" data-action="view">View</button>
            <button class="btn btn-outline btn-sm" data-action="download">Download</button>
          ` : ""}
          <button class="btn btn-danger btn-sm" data-action="delete">Delete</button>
        </div>
      </td>
    </tr>`;
}

function cardHtml(item, index) {
  const isFolder = item.type === "folder";
  const delay = Math.min(index, 12) * 30;
  const thumbInner = isFolder
    ? `<svg class="folder-icon-lg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>`
    : (isImageItem(item) ? `<span class="thumb-placeholder" data-thumb-key="${escapeHtml(item.key)}">${badgeHtml(item)}</span>` : badgeHtml(item));
  return `
    <div class="grid-card" data-key="${escapeHtml(item.key)}" data-type="${item.type}" data-name="${escapeHtml(item.name)}" style="animation-delay:${delay}ms">
      ${!isFolder ? `<input type="checkbox" class="chk" data-select-key="${escapeHtml(item.key)}" />` : ""}
      <div class="grid-thumb">${thumbInner}</div>
      <div class="grid-name" ${isFolder ? `data-open-folder="${escapeHtml(item.name)}"` : ""}>${escapeHtml(item.name)}</div>
      <div class="grid-meta">${isFolder ? "Folder" : formatBytes(item.size)}</div>
      <div class="row-actions">
        ${!isFolder ? `
          <button class="btn btn-outline btn-sm" data-action="view">View</button>
          <button class="btn btn-danger btn-sm" data-action="delete">Del</button>
        ` : `<button class="btn btn-outline btn-sm" data-open-folder="${escapeHtml(item.name)}">Open</button>`}
      </div>
    </div>`;
}

// Lazily fetches real thumbnails for image files visible in grid view,
// using the existing view/download presigned-URL endpoint.
function lazyLoadThumbnails() {
  const placeholders = fileGridEl.querySelectorAll("[data-thumb-key]");
  if (!placeholders.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(async (entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      io.unobserve(el);
      const key = el.dataset.thumbKey;
      try {
        const data = await apiRequest(`/files/download?key=${encodeURIComponent(key)}&mode=view`);
        const img = document.createElement("img");
        img.src = data.url;
        img.alt = "";
        img.loading = "lazy";
        el.replaceWith(img);
      } catch (e) { /* keep badge fallback silently */ }
    });
  }, { root: null, rootMargin: "200px" });
  placeholders.forEach((el) => io.observe(el));
}

function attachRowHandlers() {
  fileListEl.querySelectorAll("[data-open-folder]").forEach((el) => {
    el.addEventListener("click", () => openFolder(el.dataset.openFolder));
  });
  fileListEl.querySelectorAll("[data-select-key]").forEach((chk) => {
    chk.addEventListener("click", (e) => e.stopPropagation());
    chk.addEventListener("change", () => {
      if (chk.checked) selectedKeys.add(chk.dataset.selectKey);
      else selectedKeys.delete(chk.dataset.selectKey);
      updateBulkBar();
    });
  });

  fileListEl.querySelectorAll("tr[data-key]").forEach((row) => {
    const key = row.dataset.key;
    const name = row.dataset.name;

    row.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === "view") await openFile(key, "view", name);
        if (action === "download") await openFile(key, "download", name);
        if (action === "delete") openDeleteModal(key, name);
      });
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showRowContextMenu(e, row.dataset.type === "folder", key, name);
    });
  });
}

function attachGridHandlers() {
  fileGridEl.querySelectorAll("[data-open-folder]").forEach((el) => {
    el.addEventListener("click", (e) => { e.stopPropagation(); openFolder(el.dataset.openFolder); });
  });
  fileGridEl.querySelectorAll("[data-select-key]").forEach((chk) => {
    chk.addEventListener("click", (e) => e.stopPropagation());
    chk.addEventListener("change", () => {
      if (chk.checked) selectedKeys.add(chk.dataset.selectKey);
      else selectedKeys.delete(chk.dataset.selectKey);
      updateBulkBar();
    });
  });
  fileGridEl.querySelectorAll(".grid-card").forEach((card) => {
    const key = card.dataset.key;
    const name = card.dataset.name;
    const isFolder = card.dataset.type === "folder";

    card.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      if (isFolder) openFolder(name);
      else openFile(key, "view", name);
    });
    card.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === "view") await openFile(key, "view", name);
        if (action === "delete") openDeleteModal(key, name);
      });
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showRowContextMenu(e, isFolder, key, name);
    });
  });
}

function showRowContextMenu(e, isFolder, key, name) {
  const actions = isFolder
    ? [{ label: "Open", icon: "", onClick: () => openFolder(name) }, { divider: true },
       { label: "Delete", icon: ICONS.trash, danger: true, onClick: () => openDeleteModal(key, name) }]
    : [
        { label: "View", icon: ICONS.viewEye, onClick: () => openFile(key, "view", name) },
        { label: "Download", icon: ICONS.download, onClick: () => openFile(key, "download", name) },
        { divider: true },
        { label: "Delete", icon: ICONS.trash, danger: true, onClick: () => openDeleteModal(key, name) },
      ];
  openContextMenu(e.clientX, e.clientY, actions);
}

function openFolder(name) {
  currentPath = currentPath ? `${currentPath}/${name}` : name;
  searchInput.value = "";
  searchTerm = "";
  clearSelection();
  loadFiles();
}

async function openFile(key, mode, name) {
  try {
    const data = await apiRequest(`/files/download?key=${encodeURIComponent(key)}&mode=${mode}`);
    const item = currentItems.find((i) => i.key === key) || { key, name: name || key.split("/").pop(), type: "file" };
    RecentFiles.add(CURRENT_USER?.id, { key: item.key, name: item.name, type: "file" });
    renderRecent();
    if (mode === "view" && (isImageItem(item) || isPdfItem(item))) {
      openLightbox(item, data.url);
    } else {
      window.open(data.url, "_blank");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function loadFiles() {
  renderBreadcrumb();
  renderRecent();
  const skeletonRows = Array.from({ length: 6 }).map((_, i) => `
    <tr class="skeleton-row" style="animation-delay:${i * 40}ms">
      <td></td>
      <td><div class="item-name"><span class="skeleton-bar w-badge"></span><span class="skeleton-bar w-name"></span></div></td>
      <td><span class="skeleton-bar w-sm"></span></td>
      <td><span class="skeleton-bar w-sm"></span></td>
      <td></td>
    </tr>`).join("");
  fileListEl.innerHTML = skeletonRows;
  fileGridEl.innerHTML = Array.from({ length: 6 }).map((_, i) => `
    <div class="skeleton-card" style="animation-delay:${i * 40}ms">
      <div class="skeleton-bar" style="height:60px;"></div>
      <div class="skeleton-bar" style="width:70%;"></div>
      <div class="skeleton-bar" style="width:40%;"></div>
    </div>`).join("");

  try {
    const data = await apiRequest(`/files?path=${encodeURIComponent(currentPath)}`);
    currentItems = [...data.folders, ...data.files];
    renderStats(currentItems);
    updateSortArrows();
    renderList();
  } catch (err) {
    const errHtml = `<div style="text-align:center; padding:40px; color:var(--danger);">${escapeHtml(err.message)}</div>`;
    fileListEl.innerHTML = `<tr><td colspan="5">${errHtml}</td></tr>`;
    fileGridEl.innerHTML = errHtml;
  }
}

/* ---------------- Search ---------------- */
const runSearch = debounce(() => { searchTerm = searchInput.value.trim(); renderList(); }, 120);
searchInput.addEventListener("input", runSearch);
searchInput.addEventListener("focus", () => searchBox.classList.add("focused"));
searchInput.addEventListener("blur", () => { if (!searchInput.value) searchBox.classList.remove("focused"); });

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && document.activeElement !== searchInput && !e.metaKey && !e.ctrlKey) {
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    searchInput.focus();
    searchBox.classList.add("focused");
  }
});

/* ---------------- Sort ---------------- */
document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir *= -1;
    } else {
      sortKey = key;
      sortDir = 1;
    }
    updateSortArrows();
    renderList();
  });
});

/* ---------------- Upload (shared by button + drag/drop), with progress tray ---------------- */
function addUploadItem(name) {
  const id = `upl-${++uploadSeq}`;
  const el = document.createElement("div");
  el.className = "upload-item";
  el.id = id;
  el.innerHTML = `
    <div class="row">
      <span class="fname">${escapeHtml(name)}</span>
      <span class="pct">0%</span>
      <svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <div class="bar-track"><div class="bar-fill"></div></div>
  `;
  uploadTray.appendChild(el);
  return {
    setProgress(pct) {
      el.querySelector(".pct").textContent = `${pct}%`;
      el.querySelector(".bar-fill").style.width = `${pct}%`;
    },
    done() {
      el.classList.add("done");
      el.querySelector(".bar-fill").style.width = "100%";
      setTimeout(() => el.remove(), 2200);
    },
    error() {
      el.classList.add("error");
      setTimeout(() => el.remove(), 3200);
    },
  };
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", currentPath);

  const tracker = addUploadItem(file.name);
  try {
    await apiUpload("/files/upload", formData, { onProgress: (pct) => tracker.setProgress(pct) });
    tracker.done();
    showToast(`${file.name} uploaded successfully.`);
    loadFiles();
  } catch (err) {
    tracker.error();
    showToast(err.message, "error");
  }
}

document.getElementById("upload-btn").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const files = [...fileInput.files];
  fileInput.value = "";
  for (const file of files) await uploadFile(file);
});

// Drag-and-drop straight onto the file table/grid.
["dragenter", "dragover"].forEach((evt) => {
  tableCard.addEventListener(evt, (e) => {
    e.preventDefault();
    tableCard.classList.add("is-dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  tableCard.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === "dragleave" && e.target !== tableCard) return;
    tableCard.classList.remove("is-dragover");
  });
});
tableCard.addEventListener("drop", async (e) => {
  const files = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
  for (const file of files) await uploadFile(file);
});

/* ---------------- New folder ---------------- */
const folderModal = document.getElementById("folder-modal");
document.getElementById("new-folder-btn").addEventListener("click", () => {
  document.getElementById("folder-name").value = "";
  folderModal.classList.add("visible");
  setTimeout(() => document.getElementById("folder-name").focus(), 50);
});
document.getElementById("folder-cancel").addEventListener("click", () => folderModal.classList.remove("visible"));
document.getElementById("folder-create").addEventListener("click", async () => {
  const name = document.getElementById("folder-name").value.trim();
  if (!name) return showToast("Please enter a folder name.", "error");
  try {
    await apiRequest("/files/folder", { method: "POST", body: { path: currentPath, name } });
    folderModal.classList.remove("visible");
    showToast("Folder created.");
    loadFiles();
  } catch (err) {
    showToast(err.message, "error");
  }
});
document.getElementById("folder-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("folder-create").click();
});

/* ---------------- Delete (single + bulk) ---------------- */
const deleteModal = document.getElementById("delete-modal");
function openDeleteModal(key, name) {
  pendingDelete = { key, name };
  document.getElementById("delete-message").textContent =
    key.endsWith("/")
      ? `This will permanently delete the folder "${name}" and everything inside it from S3.`
      : `This will permanently delete "${name}" from S3.`;
  deleteModal.classList.add("visible");
}
document.getElementById("delete-cancel").addEventListener("click", () => deleteModal.classList.remove("visible"));
document.getElementById("delete-confirm").addEventListener("click", async () => {
  if (!pendingDelete) return;
  try {
    if (pendingDelete.bulk) {
      for (const key of pendingDelete.keys) {
        await apiRequest("/files", { method: "DELETE", body: { key } });
      }
      showToast(`Deleted ${pendingDelete.keys.length} item(s).`);
      clearSelection();
    } else {
      await apiRequest("/files", { method: "DELETE", body: { key: pendingDelete.key } });
      showToast("Deleted successfully.");
    }
    deleteModal.classList.remove("visible");
    loadFiles();
  } catch (err) {
    showToast(err.message, "error");
  }
});

/* ---------------- Init ---------------- */
setViewMode(viewMode);
loadFiles();
