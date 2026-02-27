"use strict";

const fs     = require("fs");
const path   = require("path");
const { logger } = require("../utils/logger");

const LOG_PATH   = process.env.LOG_PATH || path.join(process.env.MC_SERVER_PATH || "", "logs", "latest.log");
const MAX_LINES  = parseInt(process.env.LOG_BUFFER_SIZE || "300", 10);

// In-memory circular buffer of parsed log lines
let _buffer = [];
let _watcher = null;
let _position = 0;   // byte offset we've already read

// ─── Log line parser ──────────────────────────────────────────────────────────
const PATTERNS = {
  join    : /: (\w+) joined the game/,
  leave   : /: (\w+) left the game/,
  death   : /: (\w+) (was|drowned|suffocated|fell|starved|burned|hit|experienced|tried|went|walked|didn't|blew|froze|died)/,
  warn    : /\[WARN\]/i,
  error   : /\[ERROR\]/i,
  tps     : /TPS from last/,
};

function parseLine(raw) {
  const ts = new Date().toISOString();
  let type = "log";
  if (PATTERNS.error.test(raw)) type = "error";
  else if (PATTERNS.warn.test(raw))  type = "warn";
  else if (PATTERNS.join.test(raw))  type = "join";
  else if (PATTERNS.leave.test(raw)) type = "leave";
  else if (PATTERNS.death.test(raw)) type = "death";

  return { id: Date.now() + Math.random(), ts, type, message: raw.trim(), source: "server" };
}

// ─── Tail implementation ──────────────────────────────────────────────────────
function _readNewLines() {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const fd   = fs.openSync(LOG_PATH, "r");
    const stat = fs.fstatSync(fd);

    if (stat.size < _position) {
      // Log was rotated — reset
      _position = 0;
    }

    if (stat.size === _position) {
      fs.closeSync(fd);
      return;
    }

    const len    = stat.size - _position;
    const buf    = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, _position);
    fs.closeSync(fd);

    _position = stat.size;

    const lines = buf.toString("utf8").split("\n").filter(l => l.trim());
    for (const line of lines) {
      _buffer.push(parseLine(line));
    }

    // Trim to MAX_LINES
    if (_buffer.length > MAX_LINES) {
      _buffer = _buffer.slice(_buffer.length - MAX_LINES);
    }
  } catch (e) {
    logger.warn("Log read error:", e.message);
  }
}

function startLogTailer() {
  if (_watcher) return;

  // Bootstrap: read existing content
  _readNewLines();

  // Watch for changes
  _watcher = fs.watch(path.dirname(LOG_PATH), { persistent: false }, (event, filename) => {
    if (filename && filename === path.basename(LOG_PATH)) {
      _readNewLines();
    }
  });

  logger.info(`Log tailer watching: ${LOG_PATH}`);
}

function getLogBuffer() {
  return [..._buffer];
}

module.exports = { startLogTailer, getLogBuffer, parseLine };
