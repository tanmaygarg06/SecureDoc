if (Auth.isLoggedIn()) {
  window.location.href = Auth.getUser()?.role === "admin" ? "admin.html" : "dashboard.html";
}

const form = document.getElementById("login-form");
const errorBox = document.getElementById("error-box");
const submitBtn = document.getElementById("submit-btn");
const pwInput = document.getElementById("password");
const pwToggle = document.getElementById("pw-toggle");

pwToggle.innerHTML = ICONS.eye;
pwToggle.addEventListener("click", () => {
  const show = pwInput.type === "password";
  pwInput.type = show ? "text" : "password";
  pwToggle.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
  pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.remove("visible");

  const email = document.getElementById("email").value.trim();
  const password = pwInput.value;

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="loading-spinner"></span> Signing in...`;

  try {
    const data = await apiRequest("/auth/login", { method: "POST", body: { email, password } });
    Auth.save(data.token, data.user);
    window.location.href = data.user.role === "admin" ? "admin.html" : "dashboard.html";
  } catch (err) {
    errorBox.textContent = err.message;
    // Re-trigger the shake animation even on repeated identical errors.
    errorBox.classList.remove("visible");
    void errorBox.offsetWidth;
    errorBox.classList.add("visible");
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign In";
  }
});
