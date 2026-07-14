const express = require("express");
const router = express.Router();
const { requireAuth, requireAdmin } = require("../middleware/auth");
const userService = require("../services/userService");
const fileService = require("../services/fileService");

// GET /api/admin/users
router.get("/users", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const users = await userService.listAllUsers();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users/:userId/files?path=
// Lets an admin browse a specific user's documents
router.get("/users/:userId/files", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const path = req.query.path || "";
    const result = await fileService.listFolder(userId, path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users/:userId/files/download?key=...&mode=view|download
router.get("/users/:userId/files/download", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { key, mode } = req.query;
    if (!key) return res.status(400).json({ message: "Key is required." });
    const url = await fileService.getPresignedUrl(key, mode === "download" ? "download" : "view");
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:userId/files  { key }
// Lets an admin delete a single file/folder from a user's storage.
router.delete("/users/:userId/files", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { key } = req.body;
    if (!key) return res.status(400).json({ message: "Key is required." });
    await fileService.deleteKey(userId, key);
    res.json({ message: "Deleted successfully." });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:userId
// Permanently removes a user account and every file they own.
router.delete("/users/:userId", requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (userId === req.user.id) {
      return res.status(400).json({ message: "You can't remove your own account while signed in as it." });
    }

    const target = await userService.getUserById(userId);
    if (!target) {
      return res.status(404).json({ message: "User not found." });
    }

    await fileService.deleteAllUserFiles(userId);
    await userService.deleteUser(userId);

    res.json({ message: `${target.user.name} was removed.` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
