if (Auth.isLoggedIn()) {
  window.location.href = Auth.getUser()?.role === "admin" ? "admin.html" : "dashboard.html";
}

const form = document.getElementById("signup-form");
const errorBox = document.getElementById("error-box");
const submitBtn = document.getElementById("submit-btn");
const pwInput = document.getElementById("password");
const pwToggle = document.getElementById("pw-toggle");
const strengthEl = document.getElementById("pw-strength");
const strengthLabel = document.getElementById("pw-strength-label");

pwToggle.innerHTML = ICONS.eye;
pwToggle.addEventListener("click", () => {
  const show = pwInput.type === "password";
  pwInput.type = show ? "text" : "password";
  pwToggle.innerHTML = show ? ICONS.eyeOff : ICONS.eye;
  pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

function scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}
const STRENGTH_LABELS = ["Enter a password", "Weak", "Fair", "Good", "Strong"];

pwInput.addEventListener("input", () => {
  const score = scorePassword(pwInput.value);
  strengthEl.className = `pw-strength ${score > 0 ? "s" + score : ""}`;
  strengthLabel.textContent = pwInput.value ? STRENGTH_LABELS[score] : "Enter a password";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.classList.remove("visible");

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = pwInput.value;

  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="loading-spinner"></span> Creating account...`;

  try {
    const data = await apiRequest("/auth/signup", { method: "POST", body: { name, email, password } });
    Auth.save(data.token, data.user);
    window.location.href = data.user.role === "admin" ? "admin.html" : "dashboard.html";
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove("visible");
    void errorBox.offsetWidth;
    errorBox.classList.add("visible");
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Account";
  }
});
