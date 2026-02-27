"use strict";

const { logger } = require("./logger");

/**
 * Rejects any request that doesn't carry the correct API key.
 * Expects header:  X-API-Key: <API_SECRET_KEY>
 */
function apiKeyMiddleware(req, res, next) {
  const provided = req.headers["x-api-key"];
  if (!provided || provided !== process.env.API_SECRET_KEY) {
    logger.warn(`Rejected request from ${req.ip} — invalid or missing API key`);
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
}

/**
 * Checks that the caller has the isAdmin flag injected by the website.
 * The website passes  X-Is-Admin: true  only after verifying the session
 * server-side (or from Firestore). The bridge trusts this header only
 * because the request already passed apiKeyMiddleware.
 */
function requireAdmin(req, res, next) {
  if (req.headers["x-is-admin"] !== "true") {
    return res.status(403).json({ success: false, error: "Admin only" });
  }
  next();
}

module.exports = { apiKeyMiddleware, requireAdmin };
