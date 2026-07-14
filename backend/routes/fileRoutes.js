const express = require("express");
const multer = require("multer");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const fileService = require("../services/fileService");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
});

// GET /api/files?path=some/folder
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const path = req.query.path || "";
    const result = await fileService.listFolder(req.user.id, path);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/files/upload  (multipart/form-data: file, path)
router.post("/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided." });
    }
    const path = req.body.path || "";
    const key = await fileService.uploadFile(req.user.id, path, req.file, {
      email: req.user.email,
      name: req.user.name,
    });
    res.status(201).json({ message: "File uploaded.", key });
  } catch (err) {
    next(err);
  }
});

// POST /api/files/folder  { path, name }
router.post("/folder", requireAuth, async (req, res, next) => {
  try {
    const { path = "", name } = req.body;
    if (!name) return res.status(400).json({ message: "Folder name is required." });
    const key = await fileService.createFolder(req.user.id, path, name);
    res.status(201).json({ message: "Folder created.", key });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/files  { key }
router.delete("/", requireAuth, async (req, res, next) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ message: "Key is required." });
    fileService.assertOwnedKey(req.user.id, key);
    await fileService.deleteKey(req.user.id, key);
    res.json({ message: "Deleted successfully." });
  } catch (err) {
    next(err);
  }
});

// GET /api/files/download?key=...&mode=view|download
router.get("/download", requireAuth, async (req, res, next) => {
  try {
    const { key, mode } = req.query;
    if (!key) return res.status(400).json({ message: "Key is required." });
    fileService.assertOwnedKey(req.user.id, key);
    const url = await fileService.getPresignedUrl(key, mode === "download" ? "download" : "view");
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;