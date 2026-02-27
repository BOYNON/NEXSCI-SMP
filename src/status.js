"use strict";

const router = require("express").Router();
const { getState }   = require("../services/serverControl");
const { probeServer } = require("../services/rcon");

// GET /status — Returns current server state + live metrics
router.get("/status", async (_req, res) => {
  const state = getState();
  const probe = state === "running" ? await probeServer() : { reachable: false };

  res.json({
    success      : true,
    state,                               // "running" | "stopped" | "starting" | "stopping"
    reachable    : probe.reachable || false,
    tps          : probe.tps         ?? null,
    playerCount  : probe.playerCount ?? 0,
    maxPlayers   : probe.maxPlayers  ?? 20,
    playerNames  : probe.playerNames ?? [],
    jarVersion   : probe.jarVersion  ?? null,
    ts           : new Date().toISOString(),
  });
});

module.exports = router;
