Auth.requireAuth();
renderTopbar("profile");

const card = document.getElementById("profile-card");
let currentUserData = null;

async function loadProfile() {
  try {
    const data = await apiRequest("/auth/profile");
    const u = data.user;
    currentUserData = u;
    const photo = AvatarStore.get(u.id);

    card.innerHTML = `
      <div class="profile-avatar-ring" id="avatar-ring" title="Click to change photo">
        <div class="profile-avatar" id="profile-avatar-inner">
          ${photo ? `<img src="${photo}" alt="${escapeHtml(u.name)}" />` : initials(u.name)}
        </div>
        <div class="avatar-edit-badge">${ICONS.camera}</div>
      </div>
      <input type="file" id="avatar-file-input" accept="image/*" style="display:none" />
      <h2 style="margin:0 0 8px 0;">${escapeHtml(u.name)}</h2>
      <span class="role-badge ${u.role}">${u.role}</span>

      <div class="avatar-actions">
        <button class="btn btn-outline btn-sm" id="change-photo-btn">Change photo</button>
        ${photo ? `<button class="btn btn-outline btn-sm" id="remove-photo-btn">Remove photo</button>` : ""}
      </div>
      <p class="avatar-hint">Photos are stored privately in this browser only.</p>

      <div style="margin-top:22px;">
        <div class="profile-row"><span class="label">Email</span><span>${escapeHtml(u.email)}</span></div>
        <div class="profile-row"><span class="label">Role</span><span>${u.role === "admin" ? "Administrator" : "Standard User"}</span></div>
        <div class="profile-row"><span class="label">Member since</span><span>${formatDate(u.createdAt)}</span></div>
        <div class="profile-row"><span class="label">Theme</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <button class="icon-btn theme-toggle" id="profile-theme-toggle">${ICONS.sun}${ICONS.moon}</button>
          </span>
        </div>
        <div class="profile-row">
          <span class="label">User ID</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span class="value-mono">${escapeHtml(u.id)}</span>
            <button class="copy-btn" id="copy-id-btn">Copy</button>
          </span>
        </div>
      </div>

      <button class="btn btn-danger btn-block" style="margin-top:26px;" id="signout-btn">Sign Out</button>
    `;

    document.getElementById("signout-btn").addEventListener("click", () => Auth.logout());
    document.getElementById("copy-id-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(u.id);
        showToast("User ID copied to clipboard.");
      } catch (e) {
        showToast("Couldn't copy — please copy manually.", "error");
      }
    });
    document.getElementById("profile-theme-toggle").addEventListener("click", () => Theme.toggle());

    setupAvatarUpload(u);
  } catch (err) {
    card.innerHTML = `<p style="color:var(--danger);">${escapeHtml(err.message)}</p>`;
  }
}

function setupAvatarUpload(u) {
  const ring = document.getElementById("avatar-ring");
  const fileInput = document.getElementById("avatar-file-input");
  const inner = document.getElementById("profile-avatar-inner");

  const openPicker = () => fileInput.click();
  ring.addEventListener("click", openPicker);
  document.getElementById("change-photo-btn").addEventListener("click", openPicker);

  const removeBtn = document.getElementById("remove-photo-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      AvatarStore.remove(u.id);
      showToast("Photo removed.");
      loadProfile();
      renderTopbar("profile");
    });
  }

  async function handleFile(file) {
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      AvatarStore.set(u.id, dataUrl);
      inner.innerHTML = `<img src="${dataUrl}" alt="${escapeHtml(u.name)}" />`;
      showToast("Profile photo updated.");
      loadProfile();
      renderTopbar("profile");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));

  ["dragenter", "dragover"].forEach((evt) => {
    ring.addEventListener(evt, (e) => { e.preventDefault(); ring.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach((evt) => {
    ring.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === "dragleave" && e.target !== ring) return;
      ring.classList.remove("dragover");
    });
  });
  ring.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
}

loadProfile();
