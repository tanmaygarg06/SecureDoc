const express = require("express");
const router = express.Router();
const userService = require("../services/userService");
const { signToken } = require("../utils/jwt");
const { requireAuth } = require("../middleware/auth");

function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

router.post("/signup", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const role = isAdminEmail(email) ? "admin" : "user";
    const user = await userService.createUser({ name, email, password, role });
    const safeUser = userService.sanitizeUser(user);

    const token = signToken({ id: safeUser.id, email: safeUser.email, name: safeUser.name, role: safeUser.role });
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const user = await userService.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const valid = await userService.verifyPassword(user, password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const safeUser = userService.sanitizeUser(user);
    const token = signToken({ id: safeUser.id, email: safeUser.email, name: safeUser.name, role: safeUser.role });
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const user = await userService.getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ message: "User not found." });
    res.json({ user: userService.sanitizeUser(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
