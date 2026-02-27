"use strict";

const { Rcon } = require("rcon-client");
const { logger } = require("../utils/logger");

const RCON_HOST = process.env.RCON_HOST || "127.0.0.1";
const RCON_PORT = parseInt(process.env.RCON_PORT || "25575", 10);
const RCON_PASS = process.env.RCON_PASSWORD || "";

/**
 * Opens a fresh RCON connection, sends one command, closes the connection.
 * Returns the server's response string, or throws on failure.
 *
 * We open/close per call to avoid stale connection issues; RCON commands
 * are infrequent enough that connection overhead is negligible.
 */
async function sendRconCommand(command) {
  const rcon = new Rcon({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASS });

  await rcon.connect();
  try {
    const response = await rcon.send(command);
    return response;
  } finally {
    rcon.end().catch(() => {});
  }
}

/**
 * Probe the server — returns { reachable, tps, playerCount, playerNames, version }
 * Used by the heartbeat writer.
 */
async function probeServer() {
  try {
    const listOut  = await sendRconCommand("list");
    const tpsOut   = await sendRconCommand("tps");
    const verOut   = await sendRconCommand("version");

    // Parse player count — vanilla/Paper: "There are X of a max of Y players online: ..."
    const countMatch = listOut.match(/There are (\d+) of a max of (\d+)/);
    const playerCount = countMatch ? parseInt(countMatch[1], 10) : 0;
    const maxPlayers  = countMatch ? parseInt(countMatch[2], 10) : 20;

    // Parse player names from list output
    const namesSection = listOut.split(":").slice(1).join(":").trim();
    const playerNames  = namesSection ? namesSection.split(",").map(n => n.trim()).filter(Boolean) : [];

    // Parse TPS — Paper: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0"
    const tpsMatch = tpsOut.match(/[\d.]+(?:,\s*[\d.]+)*/);
    const tps = tpsMatch ? parseFloat(tpsMatch[0].split(",")[0]) : null;

    // Parse version
    const versionMatch = verOut.match(/[\d.]+(?:-\S+)?/);
    const jarVersion = versionMatch ? versionMatch[0] : null;

    return { reachable: true, tps, playerCount, maxPlayers, playerNames, jarVersion };
  } catch {
    return { reachable: false };
  }
}

module.exports = { sendRconCommand, probeServer };
