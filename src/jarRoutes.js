"use strict";

/**
 * NexSci SMP — JAR Routes
 * Endpoints:
 *   GET  /jar/versions  → returns normalized build list for all providers
 *   POST /jar/apply     → downloads and switches the active server JAR
 *
 * Auth: apiKeyMiddleware (applied globally in server.js) + requireAdmin
 */

const express = require("express");
const { requireAdmin } = require("../utils/auth");
const { getVersions } = require("../services/jarVersionService");
const { switchJar, isSwitching } = require("../services/jarManager");
const { logger } = require("../utils/logger");

const router = express.Router();

const ALLOWED_PROVIDERS = ["Paper", "Purpur", "Vanilla", "Fabric", "Spigot"];

// ── Strict input sanitization ─────────────────────────────────────────────────

function sanitizeInput(str, maxLen = 64) {
  if (typeof str !== "string") return "";
  return str.replace(/[^a-zA-Z0-9.\-_]/g, "").slice(0, maxLen);
}

function validateVersion(ver) {
  return typeof ver === "string" && /^\d+\.\d+(\.\d+)?$/.test(ver);
}

function validateBuild(build) {
  return typeof build === "string" && /^[a-zA-Z0-9.\-_]+$/.test(build) && build.length < 64;
}

// ── GET /jar/versions ─────────────────────────────────────────────────────────

router.get("/jar/versions", async (_req, res) => {
  try {
    const versions = await getVersions();
    res.json({ success: true, versions });
  } catch (e) {
    logger.error("GET /jar/versions error:", e.message);
    res.status(500).json({ success: false, error: "Failed to fetch JAR versions" });
  }
});

// ── POST /jar/apply ───────────────────────────────────────────────────────────

router.post("/jar/apply", requireAdmin, async (req, res) => {
  const { provider, version, build } = req.body || {};

  // ── Validate inputs ─────────────────────────────────────────────────────────
  const cleanProvider = sanitizeInput(provider, 32);
  const cleanVersion  = sanitizeInput(version,  16);
  const cleanBuild    = sanitizeInput(build,     64);

  if (!ALLOWED_PROVIDERS.includes(cleanProvider)) {
    return res.status(400).json({ success: false, error: `Invalid provider. Allowed: ${ALLOWED_PROVIDERS.join(", ")}` });
  }
  if (!validateVersion(cleanVersion)) {
    return res.status(400).json({ success: false, error: "Invalid version format. Expected: x.y or x.y.z" });
  }
  if (!validateBuild(cleanBuild)) {
    return res.status(400).json({ success: false, error: "Invalid build identifier." });
  }

  // ── Check lock ──────────────────────────────────────────────────────────────
  if (isSwitching()) {
    return res.status(409).json({ success: false, error: "A JAR switch is already in progress." });
  }

  // ── Fetch the versions to get the actual jarUrl ─────────────────────────────
  let jarUrl = null;
  let jarManifestUrl = null;

  try {
    const versions = await getVersions();
    const providerBuilds = versions[cleanProvider] || [];
    const match = providerBuilds.find(
      b => b.version === cleanVersion && b.build === cleanBuild
    );

    if (!match && cleanProvider !== "Spigot") {
      return res.status(404).json({
        success: false,
        error: `Build not found: ${cleanProvider} ${cleanVersion} #${cleanBuild}. Versions may have changed — try refreshing.`,
      });
    }

    jarUrl         = match?.jarUrl         || null;
    jarManifestUrl = match?.jarManifestUrl || null;
  } catch (e) {
    logger.error("Failed to resolve JAR URL for apply:", e.message);
    return res.status(500).json({ success: false, error: "Failed to resolve JAR download URL." });
  }

  // ── Respond immediately — switch runs in background ────────────────────────
  res.json({ success: true, state: "switching", provider: cleanProvider, version: cleanVersion, build: cleanBuild });

  // Fire-and-forget (client polls bridge status for completion)
  setImmediate(async () => {
    try {
      const result = await switchJar({
        provider: cleanProvider,
        version:  cleanVersion,
        build:    cleanBuild,
        jarUrl,
        jarManifestUrl,
      });
      logger.info(`JAR switch complete:`, result);
    } catch (e) {
      logger.error(`JAR switch background error: ${e.message}`);
    }
  });
});

module.exports = router;
