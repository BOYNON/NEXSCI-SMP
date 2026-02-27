"use strict";

/**
 * NexSci SMP — JAR Manager
 * Safely downloads and switches the active Minecraft server JAR.
 *
 * VPS layout:
 *   /minecraft/
 *     server.jar      → symlink to active JAR
 *     jars/           → downloaded JARs
 *     backups/        → timestamped backups of previous server.jar
 */

const fs       = require("fs");
const fsp      = require("fs/promises");
const path     = require("path");
const { execFile } = require("child_process");
const { logger }   = require("../utils/logger");

const MC_PATH      = process.env.MC_SERVER_PATH || "/home/ubuntu/minecraft";
const JARS_DIR     = path.join(MC_PATH, "jars");
const BACKUPS_DIR  = path.join(MC_PATH, "backups");
const ACTIVE_JAR   = path.join(MC_PATH, "server.jar");
const SCRIPTS_DIR  = path.resolve(__dirname, "../../../");  // start.sh / stop.sh live here

// Allowed provider names (whitelist against injection)
const ALLOWED_PROVIDERS = ["Paper", "Purpur", "Vanilla", "Fabric", "Spigot"];

// Global lock: prevents concurrent switch operations
let _switching = false;

// ── Utilities ─────────────────────────────────────────────────────────────────

function sanitizeFilename(str) {
  // Allow only alphanumeric, hyphens, dots, underscores
  return str.replace(/[^a-zA-Z0-9.\-_]/g, "");
}

function validateVersion(ver) {
  return /^\d+\.\d+(\.\d+)?$/.test(ver);
}

function validateBuild(build) {
  // Build may be a number, "release", "curated", or "loader-x.y.z"
  return /^[a-zA-Z0-9.\-_]+$/.test(build) && build.length < 64;
}

function runScript(name) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, name);
    // Verify script exists before exec
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script not found: ${scriptPath}`));
    }
    execFile("/bin/bash", [scriptPath], { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

async function ensureDirs() {
  await fsp.mkdir(JARS_DIR,    { recursive: true });
  await fsp.mkdir(BACKUPS_DIR, { recursive: true });
}

/**
 * Download a URL to a local file path.
 * Streams to disk — no full buffer in memory.
 */
async function downloadFile(url, destPath) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(120_000),
    headers: { "User-Agent": "NexSci-Bridge/10.0" },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise((resolve, reject) => {
        fileStream.write(value, (err) => (err ? reject(err) : resolve()));
      });
    }
    await new Promise((resolve, reject) => fileStream.close((err) => (err ? reject(err) : resolve())));
  } catch (e) {
    fileStream.destroy();
    // Clean up partial file
    try { await fsp.unlink(destPath); } catch (_) {}
    throw e;
  }
}

/**
 * For Vanilla: resolve the manifest URL to get the actual server JAR download URL.
 */
async function resolveVanillaJarUrl(manifestUrl) {
  const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Vanilla manifest fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const jarUrl = data.downloads?.server?.url;
  if (!jarUrl) throw new Error("Vanilla version manifest missing server download URL");
  return jarUrl;
}

// ── Backup current JAR ────────────────────────────────────────────────────────

async function backupCurrentJar() {
  try {
    const stat = await fsp.lstat(ACTIVE_JAR).catch(() => null);
    if (!stat) {
      logger.info("No existing server.jar to backup.");
      return null;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(BACKUPS_DIR, `server.jar.bak.${ts}`);
    if (stat.isSymbolicLink()) {
      const real = await fsp.readlink(ACTIVE_JAR);
      await fsp.copyFile(real, backupPath);
    } else {
      await fsp.copyFile(ACTIVE_JAR, backupPath);
    }
    logger.info(`Backed up server.jar → ${backupPath}`);
    return backupPath;
  } catch (e) {
    logger.error("Backup failed:", e.message);
    throw new Error(`Backup failed: ${e.message}`);
  }
}

// ── Restore from backup ───────────────────────────────────────────────────────

async function restoreBackup(backupPath) {
  if (!backupPath) return;
  try {
    // Remove current symlink or file
    await fsp.unlink(ACTIVE_JAR).catch(() => {});
    await fsp.copyFile(backupPath, ACTIVE_JAR);
    logger.info(`Restored server.jar from ${backupPath}`);
  } catch (e) {
    logger.error("Restore failed:", e.message);
  }
}

// ── Main switch function ──────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.provider  - "Paper"|"Purpur"|"Vanilla"|"Fabric"|"Spigot"
 * @param {string} opts.version   - e.g. "1.20.4"
 * @param {string} opts.build     - e.g. "412"
 * @param {string} opts.jarUrl    - direct download URL
 * @param {string} [opts.jarManifestUrl] - for Vanilla two-step
 */
async function switchJar(opts) {
  const { provider, version, build, jarUrl, jarManifestUrl } = opts;

  // ── Input validation ────────────────────────────────────────────────────────
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}`);
  }
  if (!validateVersion(version)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  if (!validateBuild(build)) {
    throw new Error(`Invalid build identifier: ${build}`);
  }

  // Spigot: no API — cannot auto-switch
  if (provider === "Spigot") {
    throw new Error("Spigot has no official download API. Use BuildTools to obtain the JAR manually.");
  }

  // ── Concurrency lock ────────────────────────────────────────────────────────
  if (_switching) {
    throw new Error("A JAR switch is already in progress. Please wait.");
  }
  _switching = true;

  let backupPath = null;

  try {
    await ensureDirs();

    // ── 1. Resolve download URL ─────────────────────────────────────────────
    let resolvedUrl = jarUrl;
    if (provider === "Vanilla" && !resolvedUrl && jarManifestUrl) {
      logger.info(`Resolving Vanilla JAR URL from manifest: ${jarManifestUrl}`);
      resolvedUrl = await resolveVanillaJarUrl(jarManifestUrl);
    }
    if (!resolvedUrl) {
      throw new Error(`No download URL available for ${provider} ${version} build ${build}`);
    }

    // Safety: ensure URL is https
    if (!resolvedUrl.startsWith("https://")) {
      throw new Error("Download URL must use HTTPS");
    }

    // ── 2. Stop server if running ───────────────────────────────────────────
    logger.info("Stopping server before JAR switch...");
    try {
      await runScript("stop.sh");
      logger.info("Server stopped.");
    } catch (e) {
      logger.warn(`stop.sh warning (server may already be stopped): ${e.message}`);
    }

    // ── 3. Backup current JAR ───────────────────────────────────────────────
    backupPath = await backupCurrentJar();

    // ── 4. Download new JAR ─────────────────────────────────────────────────
    const safeName = sanitizeFilename(`${provider}-${version}-${build}.jar`).toLowerCase();
    const destPath = path.join(JARS_DIR, safeName);

    logger.info(`Downloading ${provider} ${version} build ${build} → ${destPath}`);
    await downloadFile(resolvedUrl, destPath);
    logger.info(`Download complete: ${destPath}`);

    // ── 5. Verify downloaded file is non-empty ──────────────────────────────
    const stat = await fsp.stat(destPath);
    if (stat.size < 1024) {
      throw new Error(`Downloaded JAR is suspiciously small (${stat.size} bytes). Aborting.`);
    }

    // ── 6. Atomic switch via symlink ────────────────────────────────────────
    // Remove current server.jar (symlink or file)
    await fsp.unlink(ACTIVE_JAR).catch(() => {});
    // Create symlink: server.jar → jars/provider-version-build.jar
    await fsp.symlink(destPath, ACTIVE_JAR);
    logger.info(`Symlink created: ${ACTIVE_JAR} → ${destPath}`);

    // ── 7. Start server ─────────────────────────────────────────────────────
    logger.info("Starting server with new JAR...");
    await runScript("start.sh");
    logger.info("Server start.sh executed.");

    return {
      success: true,
      provider,
      version,
      build,
      jarPath: destPath,
      backupPath,
    };
  } catch (e) {
    logger.error(`JAR switch failed: ${e.message}`);

    // Attempt to restore backup
    if (backupPath) {
      logger.info("Attempting to restore backup...");
      await restoreBackup(backupPath);

      // Try to restart with old JAR
      try {
        await runScript("start.sh");
        logger.info("Server restarted with old JAR after failure.");
      } catch (restartErr) {
        logger.error("Failed to restart server after rollback:", restartErr.message);
      }
    }

    throw e;
  } finally {
    _switching = false;
  }
}

function isSwitching() {
  return _switching;
}

module.exports = { switchJar, isSwitching };
