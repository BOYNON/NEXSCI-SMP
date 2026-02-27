"use strict";

/**
 * NexSci SMP — JAR Version Service
 * Fetches latest 5 stable builds from Paper, Purpur, Fabric, Vanilla, Spigot.
 * Results are cached for CACHE_TTL_MS to avoid hammering upstream APIs.
 */

const { logger } = require("../utils/logger");

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _cache = null;
let _cacheTs = 0;

// ── Spigot curated fallback (no reliable public API) ─────────────────────────
const SPIGOT_VERSIONS = [
  { version: "1.20.4", build: "curated", jarUrl: null, stability: "stable" },
  { version: "1.20.1", build: "curated", jarUrl: null, stability: "stable" },
  { version: "1.19.4", build: "curated", jarUrl: null, stability: "stable" },
  { version: "1.18.2", build: "curated", jarUrl: null, stability: "stable" },
  { version: "1.16.5", build: "curated", jarUrl: null, stability: "stable" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJson(url, label) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "NexSci-Bridge/10.0" },
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

// ── Per-provider fetchers ─────────────────────────────────────────────────────

async function fetchPaper() {
  try {
    const projects = await fetchJson("https://api.papermc.io/v2/projects/paper", "Paper/projects");
    const versions = projects.versions || [];
    // Take last 5 stable (no snapshot suffix)
    const stable = versions.filter(v => !/snapshot|pre|rc|alpha|beta/i.test(v)).slice(-5).reverse();

    const builds = await Promise.all(
      stable.map(async (ver) => {
        try {
          const data = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${ver}/builds`, "Paper/builds");
          const stableBuilds = (data.builds || []).filter(b => b.channel === "default");
          const latest = stableBuilds.at(-1);
          if (!latest) return null;
          const jarName = latest.downloads?.application?.name;
          return {
            version: ver,
            build: String(latest.build),
            jarUrl: jarName
              ? `https://api.papermc.io/v2/projects/paper/versions/${ver}/builds/${latest.build}/downloads/${jarName}`
              : null,
            stability: "stable",
          };
        } catch (e) {
          logger.warn(`Paper build fetch failed for ${ver}: ${e.message}`);
          return null;
        }
      })
    );
    return builds.filter(Boolean);
  } catch (e) {
    logger.error("Paper provider failed:", e.message);
    return [];
  }
}

async function fetchPurpur() {
  try {
    const data = await fetchJson("https://api.purpurmc.org/v2/purpur", "Purpur");
    const versions = (data.versions || []).filter(v => !/snapshot|pre|rc|alpha|beta/i.test(v)).slice(-5).reverse();

    const builds = await Promise.all(
      versions.map(async (ver) => {
        try {
          const vd = await fetchJson(`https://api.purpurmc.org/v2/purpur/${ver}`, "Purpur/ver");
          const buildNum = vd.builds?.latest;
          if (!buildNum) return null;
          return {
            version: ver,
            build: String(buildNum),
            jarUrl: `https://api.purpurmc.org/v2/purpur/${ver}/${buildNum}/download`,
            stability: "stable",
          };
        } catch (e) {
          logger.warn(`Purpur build fetch failed for ${ver}: ${e.message}`);
          return null;
        }
      })
    );
    return builds.filter(Boolean);
  } catch (e) {
    logger.error("Purpur provider failed:", e.message);
    return [];
  }
}

async function fetchVanilla() {
  try {
    const manifest = await fetchJson(
      "https://launchermeta.mojang.com/mc/game/version_manifest.json",
      "Vanilla"
    );
    const releases = (manifest.versions || [])
      .filter(v => v.type === "release")
      .slice(0, 5);

    return releases.map(v => ({
      version: v.id,
      build: "release",
      jarUrl: null,            // Vanilla requires two-step: fetch version JSON → get server URL
      jarManifestUrl: v.url,  // jarManager will use this to resolve the real URL
      stability: "stable",
    }));
  } catch (e) {
    logger.error("Vanilla provider failed:", e.message);
    return [];
  }
}

async function fetchFabric() {
  try {
    const [gameVersions, loaderVersions, installerVersions] = await Promise.all([
      fetchJson("https://meta.fabricmc.net/v2/versions/game", "Fabric/game"),
      fetchJson("https://meta.fabricmc.net/v2/versions/loader", "Fabric/loader"),
      fetchJson("https://meta.fabricmc.net/v2/versions/installer", "Fabric/installer"),
    ]);

    const stableGame = gameVersions.filter(v => v.stable).slice(0, 5);
    const latestLoader = loaderVersions.find(v => v.stable)?.version;
    const latestInstaller = installerVersions.find(v => v.stable)?.version;

    if (!latestLoader || !latestInstaller) return [];

    return stableGame.map(g => ({
      version: g.version,
      build: `loader-${latestLoader}`,
      jarUrl: `https://meta.fabricmc.net/v2/versions/loader/${g.version}/${latestLoader}/${latestInstaller}/server/jar`,
      stability: "stable",
    }));
  } catch (e) {
    logger.error("Fabric provider failed:", e.message);
    return [];
  }
}

function fetchSpigot() {
  // No reliable public API — return curated fallback with warning flag
  return SPIGOT_VERSIONS.map(v => ({ ...v, warning: "No official API. Manual download required via BuildTools." }));
}

// ── Main export ───────────────────────────────────────────────────────────────

async function getVersions() {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) {
    logger.info("JAR versions served from cache");
    return _cache;
  }

  logger.info("Fetching JAR versions from upstream APIs...");
  const [paper, purpur, vanilla, fabric] = await Promise.allSettled([
    fetchPaper(),
    fetchPurpur(),
    fetchVanilla(),
    fetchFabric(),
  ]);

  const result = {
    Paper:   paper.status   === "fulfilled" ? paper.value   : [],
    Purpur:  purpur.status  === "fulfilled" ? purpur.value  : [],
    Vanilla: vanilla.status === "fulfilled" ? vanilla.value : [],
    Fabric:  fabric.status  === "fulfilled" ? fabric.value  : [],
    Spigot:  fetchSpigot(),
  };

  _cache  = result;
  _cacheTs = now;
  return result;
}

function clearCache() {
  _cache  = null;
  _cacheTs = 0;
}

module.exports = { getVersions, clearCache };
