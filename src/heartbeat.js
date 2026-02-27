"use strict";

const admin      = require("firebase-admin");
const { probeServer }  = require("./rcon");
const { getState, setState } = require("./serverControl");
const { startLogTailer } = require("./logTailer");
const { logger }  = require("../utils/logger");

const INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "10000", 10);

let _db = null;

function _initFirebase() {
  if (admin.apps.length) return admin.firestore();

  try {
    const saBase64 = process.env.FIREBASE_SA_BASE64;
    if (!saBase64) {
      logger.warn("FIREBASE_SA_BASE64 not set — Firestore heartbeat disabled.");
      return null;
    }
    const sa = JSON.parse(Buffer.from(saBase64, "base64").toString("utf8"));
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: process.env.FIREBASE_PROJECT_ID });
    return admin.firestore();
  } catch (e) {
    logger.error("Firebase init failed:", e.message);
    return null;
  }
}

async function _writeHeartbeat(probe) {
  if (!_db) return;
  const doc = _db.collection("smp").doc("bridgestatus");
  await doc.set({
    v: {
      ts          : new Date().toISOString(),
      version     : "10.0",
      serverState : getState(),
      tps         : probe.tps ?? null,
      playerCount : probe.playerCount ?? 0,
      maxPlayers  : probe.maxPlayers ?? 20,
      playerNames : probe.playerNames ?? [],
      jarVersion  : probe.jarVersion ?? null,
      reachable   : probe.reachable ?? false,
    },
    ts: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function _tick() {
  const probe = await probeServer();

  // Sync server state from RCON reachability
  const current = getState();
  if (probe.reachable && current !== "running") setState("running");
  else if (!probe.reachable && current === "running") setState("stopped");

  try {
    await _writeHeartbeat(probe);
  } catch (e) {
    logger.warn("Heartbeat write failed:", e.message);
  }
}

function startHeartbeat() {
  _db = _initFirebase();
  startLogTailer();   // Start tailing logs alongside heartbeat
  _tick();            // Immediate first tick
  setInterval(_tick, INTERVAL_MS);
  logger.info(`Heartbeat started (interval: ${INTERVAL_MS}ms)`);
}

module.exports = { startHeartbeat };
