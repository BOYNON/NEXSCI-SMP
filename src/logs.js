"use strict";

const router = require("express").Router();
const { getLogBuffer } = require("../services/logTailer");

// GET /logs — Returns recent parsed log entries (no raw spam dumps)
router.get("/logs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 300);
  const type  = req.query.type;   // optional filter: "join" | "leave" | "death" | "error" | ...

  let entries = getLogBuffer();

  if (type) {
    entries = entries.filter(e => e.type === type);
  }

  // Return newest-first, capped at limit
  const result = entries.slice(-limit).reverse();

  res.json({ success: true, count: result.length, logs: result });
});

module.exports = router;
