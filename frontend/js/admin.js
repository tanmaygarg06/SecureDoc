Auth.requireAdmin();
renderTopbar("admin");

const userListEl = document.getElementById("user-list");
const browseSection = document.getElementById("browse-section");
const adminFileListEl = document.getElementById("admin-file-list");
const adminBreadcrumbEl = document.getElementById("admin-breadcrumb");
const browseTitleEl = document.getElementById("browse-title");
const statStripEl = document.getElementById("stat-strip");

let browsingUser = null;
let browsingPath = "";
let browsingItems = [];
let pendingRemoveUser = null;
let pendingDeleteFile = null;
const currentUser = Auth.getUser();
const currentUserId = currentUser ? currentUser.id : null;

async function loadUsers() {
  userListEl.innerHTML = Array.from({ length: 4 }).map((_, i) => `
    <tr class="skeleton-row" style="animation-delay:${i * 40}ms">
      <td><div class="item-name"><span class="skeleton-bar w-badge" style="border-radius:50%;width:36px;height:36px;"></span><span class="skeleton-bar w-name"></span></div></td>
      <td><span class="skeleton-bar" style="width:70%;"></span></td>
      <td><span class="skeleton-bar w-sm"></span></td>
      <td><span class="skeleton-bar w-sm"></span></td>
      <td></td>
      <td></td>
    </tr>`).join("");

  try {
    const data = await apiRequest("/admin/users");

    const admins = data.users.filter((u) => u.role === "admin").length;
    statStripEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">Total users</div><div class="stat-value primary">${data.users.length}</div></div>
      <div class="stat-card"><div class="stat-label">Administrators</div><div class="stat-value accent">${admins}</div></div>
      <div class="stat-card"><div class="stat-label">Standard users</div><div class="stat-value">${data.users.length - admins}</div></div>
    `;

    if (data.users.length === 0) {
      userListEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px;">No users yet.</td></tr>`;
      return;
    }
    userListEl.innerHTML = data.users.map((u, i) => `
      <tr style="animation-delay:${Math.min(i, 10) * 35}ms">
        <td>
          <div class="item-name">
            ${avatarHtml(u, { size: 28 })}
            <span>${escapeHtml(u.name)}</span>
          </div>
        </td>
        <td>${escapeHtml(u.email)}</td>
        <td><span class="role-badge ${u.role}">${u.role}</span></td>
        <td class="mono">${formatDate(u.createdAt)}</td>
        <td><button class="btn btn-outline btn-sm" data-browse="${u.id}" data-name="${escapeHtml(u.name)}">View Files</button></td>
        <td>
          ${u.id === currentUserId
            ? `<button class="btn btn-danger btn-sm" disabled title="You can't remove your own account.">Remove</button>`
            : `<button class="btn btn-danger btn-sm" data-remove="${u.id}" data-name="${escapeHtml(u.name)}">Remove</button>`}
        </td>
      </tr>
    `).join("");

    userListEl.querySelectorAll("[data-browse]").forEach((btn) => {
      btn.addEventListener("click", () => {
        browsingUser = { id: btn.dataset.browse, name: btn.dataset.name };
        browsingPath = "";
        browseSection.style.display = "block";
        browseTitleEl.textContent = `${browsingUser.name}'s Files`;
        loadUserFiles();
        browseSection.scrollIntoView({ behavior: "smooth" });
      });
    });

    userListEl.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openRemoveUserModal(btn.dataset.remove, btn.dataset.name);
      });
    });
  } catch (err) {
    userListEl.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--danger);">${escapeHtml(err.message)}</td></tr>`;
  }
}

/* ---------------- Remove user ---------------- */
const removeUserModal = document.getElementById("remove-user-modal");

function openRemoveUserModal(id, name) {
  pendingRemoveUser = { id, name };
  document.getElementById("remove-user-message").textContent =
    `This will permanently delete "${name}"'s account and every file they own from S3. This can't be undone.`;
  removeUserModal.classList.add("visible");
}

document.getElementById("remove-user-cancel").addEventListener("click", () => {
  removeUserModal.classList.remove("visible");
  pendingRemoveUser = null;
});

document.getElementById("remove-user-confirm").addEventListener("click", async () => {
  if (!pendingRemoveUser) return;
  const confirmBtn = document.getElementById("remove-user-confirm");
  confirmBtn.disabled = true;
  try {
    await apiRequest(`/admin/users/${pendingRemoveUser.id}`, { method: "DELETE" });
    showToast(`${pendingRemoveUser.name} was removed.`);
    removeUserModal.classList.remove("visible");

    // If the removed user was the one currently being browsed, close that panel.
    if (browsingUser && browsingUser.id === pendingRemoveUser.id) {
      browseSection.style.display = "none";
      browsingUser = null;
    }

    pendingRemoveUser = null;
    loadUsers();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    confirmBtn.disabled = false;
  }
});

function renderAdminBreadcrumb() {
  const parts = browsingPath ? browsingPath.split("/").filter(Boolean) : [];
  let html = `<button data-path="">🏠 Root</button>`;
  let accum = "";
  parts.forEach((part) => {
    accum += (accum ? "/" : "") + part;
    html += `<span class="sep">/</span><button data-path="${accum}">${escapeHtml(part)}</button>`;
  });
  adminBreadcrumbEl.innerHTML = html;
  adminBreadcrumbEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      browsingPath = btn.dataset.path;
      loadUserFiles();
    });
  });
}

async function loadUserFiles() {
  renderAdminBreadcrumb();
  adminFileListEl.innerHTML = `<tr><td colspan="4"><div class="spinner-wrap"><span class="loading-spinner spinner-dark"></span></div></td></tr>`;

  try {
    const data = await apiRequest(`/admin/users/${browsingUser.id}/files?path=${encodeURIComponent(browsingPath)}`);
    browsingItems = [...data.folders, ...data.files];

    if (browsingItems.length === 0) {
      adminFileListEl.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="big-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:64px;height:64px;color:var(--primary);opacity:0.8;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div><div class="empty-title">This folder is empty</div></div></td></tr>`;
      return;
    }

    adminFileListEl.innerHTML = browsingItems.map((item, i) => `
      <tr style="animation-delay:${Math.min(i, 10) * 35}ms">
        <td>
          <div class="item-name">
            ${badgeHtml(item)}
            ${item.type === "folder"
              ? `<span class="folder-link" data-open="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>`
              : `<span>${escapeHtml(item.name)}</span>`}
          </div>
        </td>
        <td class="mono">${item.type === "folder" ? "—" : formatBytes(item.size)}</td>
        <td class="mono">${item.type === "folder" ? "—" : formatDate(item.lastModified)}</td>
        <td>
          ${item.type === "file" ? `
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" data-view="${escapeHtml(item.key)}">View</button>
              <button class="btn btn-outline btn-sm" data-download="${escapeHtml(item.key)}">Download</button>
              <button class="btn btn-danger btn-sm" data-delete-file="${escapeHtml(item.key)}" data-file-name="${escapeHtml(item.name)}">Delete</button>
            </div>` : ""}
        </td>
      </tr>
    `).join("");

    adminFileListEl.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => {
        browsingPath = browsingPath ? `${browsingPath}/${el.dataset.open}` : el.dataset.open;
        loadUserFiles();
      });
    });
    adminFileListEl.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => openAdminFile(btn.dataset.view, "view"));
    });
    adminFileListEl.querySelectorAll("[data-download]").forEach((btn) => {
      btn.addEventListener("click", () => openAdminFile(btn.dataset.download, "download"));
    });
    adminFileListEl.querySelectorAll("[data-delete-file]").forEach((btn) => {
      btn.addEventListener("click", () => openDeleteFileModal(btn.dataset.deleteFile, btn.dataset.fileName));
    });
  } catch (err) {
    adminFileListEl.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--danger);">${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openAdminFile(key, mode) {
  try {
    const data = await apiRequest(`/admin/users/${browsingUser.id}/files/download?key=${encodeURIComponent(key)}&mode=${mode}`);
    const item = browsingItems.find((i) => i.key === key) || { key, name: key.split("/").pop(), type: "file" };
    if (mode === "view" && (isImageItem(item) || isPdfItem(item))) {
      openLightbox(item, data.url);
    } else {
      window.open(data.url, "_blank");
    }
  } catch (err) {
    showToast(err.message, "error");
  }
}

/* ---------------- Delete a file from a browsed user's storage ---------------- */
const deleteFileModal = document.getElementById("delete-file-modal");
function openDeleteFileModal(key, name) {
  pendingDeleteFile = { key, name };
  document.getElementById("delete-file-message").textContent =
    `This will permanently delete "${name}" from S3.`;
  deleteFileModal.classList.add("visible");
}
document.getElementById("delete-file-cancel").addEventListener("click", () => {
  deleteFileModal.classList.remove("visible");
  pendingDeleteFile = null;
});
document.getElementById("delete-file-confirm").addEventListener("click", async () => {
  if (!pendingDeleteFile || !browsingUser) return;
  const confirmBtn = document.getElementById("delete-file-confirm");
  confirmBtn.disabled = true;
  try {
    await apiRequest(`/admin/users/${browsingUser.id}/files`, {
      method: "DELETE",
      body: { key: pendingDeleteFile.key },
    });
    showToast("Deleted successfully.");
    deleteFileModal.classList.remove("visible");
    pendingDeleteFile = null;
    loadUserFiles();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    confirmBtn.disabled = false;
  }
});

document.getElementById("close-browse").addEventListener("click", () => {
  browseSection.style.display = "none";
  browsingUser = null;
});

loadUsers();
