"use strict";

const router = require("express").Router();
const { requireAdmin }     = require("../utils/auth");
const { sanitizeCommand }  = require("../utils/sanitize");
const { sendRconCommand }  = require("../services/rcon");
const { getState }         = require("../services/serverControl");
const { logger }           = require("../utils/logger");

// POST /command — Admin only. Body: { command: "say Hello" }
router.post("/command", requireAdmin, async (req, res) => {
  const { command } = req.body;

  // Validate & sanitize
  const { ok, safe, reason } = sanitizeCommand(command);
  if (!ok) {
    return res.status(400).json({ success: false, error: reason });
  }

  // Must be running to accept commands
  if (getState() !== "running") {
    return res.status(409).json({ success: false, error: "Server is not running." });
  }

  try {
    logger.info(`RCON command from ${req.ip}: ${safe}`);
    const output = await sendRconCommand(safe);
    res.json({ success: true, command: safe, output: output || "(no output)" });
  } catch (e) {
    logger.error("RCON command failed:", e.message);
    res.status(502).json({ success: false, error: `RCON error: ${e.message}` });
  }
});

module.exports = router;
