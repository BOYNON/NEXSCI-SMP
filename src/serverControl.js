"use strict";

const { execFile } = require("child_process");
const path         = require("path");
const { logger }   = require("../utils/logger");

// ─── State machine ────────────────────────────────────────────────────────────
//  Possible values: "stopped" | "starting" | "running" | "stopping"
let _state = "stopped";

function getState()        { return _state; }
function setState(s)       { _state = s; logger.info(`Server state → ${s}`); }

// ─── Shell script runner ──────────────────────────────────────────────────────
const SCRIPTS_DIR = path.resolve(__dirname, "../../");   // scripts sit next to /bridge

function runScript(name) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, name);
    execFile("/bin/bash", [scriptPath], { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function startServer() {
  if (_state === "running" || _state === "starting") {
    return { success: false, reason: "already_running" };
  }
  setState("starting");
  try {
    await runScript("start.sh");
    // Heartbeat will flip to "running" once it can reach RCON
    return { success: true, state: "starting" };
  } catch (e) {
    setState("stopped");
    logger.error("start.sh failed:", e.message);
    return { success: false, reason: e.message };
  }
}

async function stopServer() {
  if (_state === "stopped" || _state === "stopping") {
    return { success: false, reason: "already_stopped" };
  }
  setState("stopping");
  try {
    await runScript("stop.sh");
    setState("stopped");
    return { success: true, state: "stopped" };
  } catch (e) {
    setState("running");   // rollback
    logger.error("stop.sh failed:", e.message);
    return { success: false, reason: e.message };
  }
}

async function restartServer() {
  if (_state === "stopped") return { success: false, reason: "server_not_running" };
  setState("stopping");
  try {
    await runScript("restart.sh");
    setState("starting");
    return { success: true, state: "starting" };
  } catch (e) {
    logger.error("restart.sh failed:", e.message);
    setState("stopped");
    return { success: false, reason: e.message };
  }
}

module.exports = { getState, setState, startServer, stopServer, restartServer };
