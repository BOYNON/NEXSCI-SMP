/**
 * NexSci SMP — Oracle Bridge Daemon  v10.0
 * Runs on Oracle Cloud Free Tier (ARM Ampere A1 · Ubuntu LTS)
 *
 * Architecture:
 *   Website → this bridge (Node.js) → Shell scripts / RCON → Minecraft server
 *   Website NEVER touches the server directly.
 */

"use strict";

const express      = require("express");
const cors         = require("cors");
const dotenv       = require("dotenv");
const path         = require("path");

dotenv.config();

const { apiKeyMiddleware } = require("./utils/auth");
const { startHeartbeat }   = require("./services/heartbeat");
const serverRoutes         = require("./routes/server");
const statusRoutes         = require("./routes/status");
const logsRoutes           = require("./routes/logs");
const commandRoutes        = require("./routes/command");
const jarRoutes            = require("./routes/jarRoutes");   // ← NEW
const { logger }           = require("./utils/logger");

// ─── Validate critical env vars ──────────────────────────────────────────────
const REQUIRED_ENV = ["API_SECRET_KEY", "MC_SERVER_PATH", "RCON_PASSWORD", "RCON_PORT"];
for (const k of REQUIRED_ENV) {
  if (!process.env[k]) {
    logger.error(`Missing required env var: ${k}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.BRIDGE_PORT || "4000", 10);

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: "*" }));           // Restrict in production via nginx
app.use(express.json({ limit: "64kb" }));

// ── Health check (no auth — used by Firestore heartbeat writer) ──────────────
app.get("/ping", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── All real endpoints require API key ───────────────────────────────────────
app.use(apiKeyMiddleware);

app.use("/", serverRoutes);   // POST /start, /stop, /restart
app.use("/", statusRoutes);   // GET  /status
app.use("/", logsRoutes);     // GET  /logs
app.use("/", commandRoutes);  // POST /command
app.use("/", jarRoutes);      // GET  /jar/versions · POST /jar/apply  ← NEW

// ─── Global error handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  logger.info(`NexSci Bridge v10.0 listening on port ${PORT}`);
  startHeartbeat();   // Writes bridgestatus to Firestore every 10 s
});
