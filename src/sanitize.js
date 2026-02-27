"use strict";

// Characters that could break shell argument parsing or RCON protocol frames.
const SHELL_DANGEROUS = /[;&|`$<>\\'"!{}()*?[\]]/g;

/**
 * Sanitizes a Minecraft console command before sending via RCON.
 * - Strips shell metacharacters
 * - Enforces max length
 * - Rejects obviously dangerous patterns
 *
 * Returns { ok: true, safe: sanitizedString } or { ok: false, reason: "..." }
 */
function sanitizeCommand(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "Command must be a non-empty string." };
  }

  const trimmed = raw.trim();

  if (trimmed.length > 256) {
    return { ok: false, reason: "Command exceeds maximum length (256 chars)." };
  }

  // Block obvious shell injection sequences even before regex strip
  const blocked = ["&&", "||", "$(", "`", "../", "sudo", "rm -", "chmod", "chown", "curl ", "wget "];
  for (const b of blocked) {
    if (trimmed.toLowerCase().includes(b)) {
      return { ok: false, reason: `Blocked pattern detected: "${b}"` };
    }
  }

  // Strip remaining metacharacters
  const safe = trimmed.replace(SHELL_DANGEROUS, "");

  if (safe.length === 0) {
    return { ok: false, reason: "Command is empty after sanitization." };
  }

  return { ok: true, safe };
}

module.exports = { sanitizeCommand };
