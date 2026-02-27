import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp
} from "firebase/firestore";

// ═══════════════════════════════════════════════════════════════════════════════
//  FIREBASE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyCLnLS6427CrBZZJfrL32HURjvAdvZrNSY",
  authDomain: "nexsci-smp.firebaseapp.com",
  projectId: "nexsci-smp",
  storageBucket: "nexsci-smp.firebasestorage.app",
  messagingSenderId: "588762351377",
  appId: "1:588762351377:web:e8f380d6583e970891aeb0",
};
const _fbApp = initializeApp(firebaseConfig);
const _db    = getFirestore(_fbApp);

// ═══════════════════════════════════════════════════════════════════════════════
//  CLOUDINARY — unsigned upload, no secret in code
// ═══════════════════════════════════════════════════════════════════════════════
const CLOUDINARY = {
  cloudName:    "dpeyarolc",
  uploadPreset: "nexsci-smp",
  async upload(file, folder = "nexsci") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", CLOUDINARY.uploadPreset);
    fd.append("folder", folder);
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/auto/upload`,
      { method: "POST", body: fd }
    );
    if (!res.ok) throw new Error("Cloudinary upload failed: " + await res.text());
    const d = await res.json();
    return d.secure_url;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  FIRESTORE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
// All shared data → collection "smp", one document per data key.
// Sessions → localStorage (just stores {username,isAdmin} — not sensitive).
const _smpDoc = (id) => doc(_db, "smp", id);

async function _fbGet(id, fallback = null) {
  try {
    const snap = await getDoc(_smpDoc(id));
    return snap.exists() ? snap.data().v : fallback;
  } catch (e) { console.error("[FB get]", id, e); return fallback; }
}

async function _fbSet(id, value) {
  try {
    await setDoc(_smpDoc(id), { v: value, ts: serverTimestamp() });
    return true;
  } catch (e) { console.error("[FB set]", id, e); return false; }
}

async function _fbDel(id) {
  try { await deleteDoc(_smpDoc(id)); } catch(e) { console.error("[FB del]", e); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DATABASE — identical API to before, now 100% Firestore + Cloudinary
// ═══════════════════════════════════════════════════════════════════════════════
const DB = {
  // ── Core CRUD (kept for any legacy internal calls) ──────────────────────────
  async get(k)    { return _fbGet(k); },
  async set(k, v) { return _fbSet(k, v); },
  async del(k)    { return _fbDel(k); },

  // ── Shared data — stored in Firestore, visible to all users ─────────────────
  async getUsers()         { return (await _fbGet("users"))         || []; },
  async setUsers(v)        { return _fbSet("users", v); },

  async getServer()        { return (await _fbGet("server"))        || SERVER_DEFAULT; },
  async setServer(v)       { return _fbSet("server", v); },

  async getWhitelist()     { return (await _fbGet("wl"))            || ["AdminOP"]; },
  async setWhitelist(v)    { return _fbSet("wl", v); },

  async getWars()          { return (await _fbGet("wars"))          || WAR_DEF; },
  async setWars(v)         { return _fbSet("wars", v); },

  async getRules()         { return (await _fbGet("rules"))         || RULES_DEFAULT; },
  async setRules(v)        { return _fbSet("rules", v); },

  async getSeasons()       { return (await _fbGet("seasons"))       || SEASONS_DEFAULT; },
  async setSeasons(v)      { return _fbSet("seasons", v); },

  async getPlayerStatus()  { return (await _fbGet("pstatus"))       || {}; },
  async setPlayerStatus(v) { return _fbSet("pstatus", v); },

  async getNotifs()        { return (await _fbGet("notifs"))        || []; },
  async pushNotif(n) {
    const ns = await DB.getNotifs();
    return _fbSet("notifs", [{ ...n, id: Date.now(), ts: new Date().toISOString() }, ...ns].slice(0, 40));
  },

  async getAccessReqs()    { return (await _fbGet("accessreqs"))    || []; },
  async setAccessReqs(v)   { return _fbSet("accessreqs", v); },
  async pushAccessReq(r) {
    const rs = await DB.getAccessReqs();
    return _fbSet("accessreqs", [{ ...r, id: Date.now(), ts: new Date().toISOString(), status: "pending" }, ...rs].slice(0, 100));
  },

  // ── Server Power Access — who can start/stop the server ──────────────────────
  async getServerPowerAccess()  { return (await _fbGet("serverpoweraccess")) || []; },
  async setServerPowerAccess(v) { return _fbSet("serverpoweraccess", v); },
  async pushServerPowerReq(r) {
    const rs = await DB.getServerPowerAccess();
    const dup = rs.find(x => x.username === r.username && x.status === "pending");
    if(dup) return false;
    return _fbSet("serverpoweraccess", [{ ...r, id: Date.now(), ts: new Date().toISOString(), status: "pending" }, ...rs].slice(0, 200));
  },

  async getMusicList()     { return (await _fbGet("music"))         || []; },
  async setMusicList(v)    { return _fbSet("music", v); },

  async getLeaderboard()   { return (await _fbGet("leaderboard"))   || []; },
  async setLeaderboard(v)  { return _fbSet("leaderboard", v); },

  async getSurveys()       { return (await _fbGet("surveys"))       || []; },
  async setSurveys(v)      { return _fbSet("surveys", v); },

  // ── PFP — URL stored in Firestore, actual image file in Cloudinary ───────────
  // Legacy: accepts base64 string OR a File object
  async getUserPfp(username) { return _fbGet(`pfp_${username}`); },
  async setUserPfp(username, fileOrBase64) {
    // If it's a File, upload to Cloudinary and store the URL
    if (fileOrBase64 instanceof File) {
      try {
        const url = await CLOUDINARY.upload(fileOrBase64, "nexsci/pfp");
        return _fbSet(`pfp_${username}`, url);
      } catch (e) { console.error("PFP upload failed", e); return false; }
    }
    // Else it's already a base64/URL string — just store it
    return _fbSet(`pfp_${username}`, fileOrBase64);
  },

  // ── Banner — URL stored in Firestore, image in Cloudinary ──────────────────
  async getUserBanner(username) { return _fbGet(`banner_${username}`); },
  async setUserBanner(username, fileOrUrl) {
    if (fileOrUrl instanceof File) {
      try {
        const url = await CLOUDINARY.upload(fileOrUrl, "nexsci/banner");
        return _fbSet(`banner_${username}`, url);
      } catch (e) { console.error("Banner upload failed", e); return false; }
    }
    return _fbSet(`banner_${username}`, fileOrUrl);
  },

  // ── Music — URL stored in Firestore, audio file in Cloudinary ───────────────
  // uploadMusicFile: takes a File, uploads to Cloudinary, returns permanent URL
  async uploadMusicFile(file) {
    return CLOUDINARY.upload(file, "nexsci/music");
  },

  // ── Session — stored in localStorage (not sensitive: just username+isAdmin) ──
  async getSession() {
    try { const s = localStorage.getItem("nexsci_session"); return s ? JSON.parse(s) : null; }
    catch { return null; }
  },
  async setSession(v) {
    try {
      if (v) localStorage.setItem("nexsci_session", JSON.stringify(v));
      else localStorage.removeItem("nexsci_session");
      return true;
    } catch { return false; }
  },

  // ── Password helpers ──────────────────────────────────────────────────────────
  async resetUserPw(username, newPw) {
    const us = await DB.getUsers();
    return DB.setUsers(us.map(u => u.username === username
      ? { ...u, password: newPw, pwResetAt: new Date().toISOString(), resetRequested: false }
      : u));
  },
  async requestPwReset(username) {
    const us = await DB.getUsers();
    return DB.setUsers(us.map(u => u.username === username
      ? { ...u, resetRequested: true, resetRequestedAt: new Date().toISOString() }
      : u));
  },
  // Feature: Changelog
  async getChangelog()    { return (await _fbGet("changelog"))    || []; },
  async setChangelog(v)   { return _fbSet("changelog", v); },
  // Feature: Countdown events
  async getEvents()       { return (await _fbGet("events"))       || []; },
  async setEvents(v)      { return _fbSet("events", v); },
  // Feature: Polls / Community voting
  async getPolls()        { return (await _fbGet("polls"))        || []; },
  async setPolls(v)       { return _fbSet("polls", v); },
  // Feature: Trade board
  async getTrades()       { return (await _fbGet("trades"))       || []; },
  async setTrades(v)      { return _fbSet("trades", v); },
  // Feature: Achievements
  async getAchievements() { return (await _fbGet("achievements")) || []; },
  async setAchievements(v){ return _fbSet("achievements", v); },
  // Feature: Player reputation / thumbs
  async getReputation()   { return (await _fbGet("reputation"))   || {}; },
  async setReputation(v)  { return _fbSet("reputation", v); },
  // Feature: Server announcements (pinned)
  async getAnnouncements(){ return (await _fbGet("announcements"))|| []; },
  async setAnnouncements(v){ return _fbSet("announcements", v); },

  // ── v6.0: Multi-channel Chat ─────────────────────────────────────────────────
  async getMessages(channel){ return (await _fbGet(`chat_${channel}`)) || []; },
  async pushMessage(channel, msg){
    const ms = await DB.getMessages(channel);
    return _fbSet(`chat_${channel}`, [...ms, {...msg, id: Date.now()+Math.random(), ts: new Date().toISOString()}].slice(-200));
  },
  async setMessages(channel, msgs){ return _fbSet(`chat_${channel}`, msgs); },

  // ── v6.0: Season Pass ────────────────────────────────────────────────────────
  async getSeasonPass()    { return (await _fbGet("seasonpass"))    || null; },
  async setSeasonPass(v)   { return _fbSet("seasonpass", v); },
  async getSeasonPassProgress(username){ return (await _fbGet(`spp_${username}`)) || {level:0,xp:0}; },
  async setSeasonPassProgress(username,v){ return _fbSet(`spp_${username}`, v); },
  async getSeasonPassChallenges(){ return (await _fbGet("spchallenges")) || []; },
  async setSeasonPassChallenges(v){ return _fbSet("spchallenges", v); },

  // ── v6.0: Cosmetics ──────────────────────────────────────────────────────────
  async getCosmetics(username){ return (await _fbGet(`cosmetics_${username}`)) || {unlocked:[],equipped:{}}; },
  async setCosmetics(username, v){ return _fbSet(`cosmetics_${username}`, v); },
  async getAllCosmetics(){ return (await _fbGet("cosmeticsdb")) || COSMETICS_DEFAULT; },
  async setAllCosmetics(v){ return _fbSet("cosmeticsdb", v); },

  // ── v6.0: Gallery ────────────────────────────────────────────────────────────
  async getGallery(username){ return (await _fbGet(`gallery_${username}`)) || {slots:[],maxSlots:10}; },
  async setGallery(username, v){ return _fbSet(`gallery_${username}`, v); },
  async getStorageRequests(){ return (await _fbGet("storagereqs")) || []; },
  async setStorageRequests(v){ return _fbSet("storagereqs", v); },

  // ── v6.0: Suggestion Box ─────────────────────────────────────────────────────
  async getSuggestions()  { return (await _fbGet("suggestions"))  || []; },
  async setSuggestions(v) { return _fbSet("suggestions", v); },
  async pushSuggestion(s) {
    const ss = await DB.getSuggestions();
    return _fbSet("suggestions", [{...s, id:Date.now(), ts:new Date().toISOString(), status:"open", upvotes:[], votes:{}},...ss].slice(0,500));
  },

  // ── v6.0: Player of the Week ─────────────────────────────────────────────────
  async getPOTW()   { return (await _fbGet("potw"))   || null; },
  async setPOTW(v)  { return _fbSet("potw", v); },
  async getPOTWHall(){ return (await _fbGet("potwHall")) || []; },
  async setPOTWHall(v){ return _fbSet("potwHall", v); },

  // ── v7.0: Alliance / Kingdom System ─────────────────────────────────────────
  async getAlliances()  { return (await _fbGet("alliances"))  || []; },
  async setAlliances(v){ return _fbSet("alliances", v); },

  // ── v7.0: Server Bulletin ────────────────────────────────────────────────────
  async getBulletins()   { return (await _fbGet("bulletins"))   || []; },
  async setBulletins(v)  { return _fbSet("bulletins", v); },

  // ── v7.0: Ban / Warning Log ──────────────────────────────────────────────────
  async getBanLog()    { return (await _fbGet("banlog"))    || []; },
  async setBanLog(v)   { return _fbSet("banlog", v); },
  async pushBanEntry(e){
    const log = await DB.getBanLog();
    return _fbSet("banlog", [{...e, id:Date.now(), ts:new Date().toISOString()},...log].slice(0,500));
  },

  // ── v7.0: Scheduled Announcements ────────────────────────────────────────────
  async getScheduledAnns()  { return (await _fbGet("schedann"))  || []; },
  async setScheduledAnns(v) { return _fbSet("schedann", v); },

  // ── v7.0: Mod Review Center ──────────────────────────────────────────────────
  async getModReviews()   { return (await _fbGet("modreviews"))  || []; },
  async setModReviews(v)  { return _fbSet("modreviews", v); },

  // ── v7.0: Admin Action Log ───────────────────────────────────────────────────
  async getAdminLog()   { return (await _fbGet("adminlog"))  || []; },
  async pushAdminLog(e) {
    const log = await DB.getAdminLog();
    return _fbSet("adminlog", [{...e, id:Date.now(), ts:new Date().toISOString()},...log].slice(0,200));
  },

  // ── v7.0: Feature Flags ──────────────────────────────────────────────────────
  async getFeatureFlags()   { return (await _fbGet("featureflags")) || FEATURE_FLAGS_DEFAULT; },
  async setFeatureFlags(v)  { return _fbSet("featureflags", v); },

  // ── Phase 3: Console Logs (Firestore-ready, simulation-safe) ─────────────────
  // collection: console_logs → stored flat in smp/consolelogs
  async getConsoleLogs()    { return (await _fbGet("consolelogs"))  || []; },
  async setConsoleLogs(v)   { return _fbSet("consolelogs", v); },
  async pushConsoleLog(entry) {
    const logs = await DB.getConsoleLogs();
    const newEntry = {
      id: Date.now() + Math.random(),
      ts: new Date().toISOString(),
      type: "log",   // "log" | "command" | "system" | "error" | "warn"
      message: "",
      source: "simulated",
      ...entry,
    };
    return _fbSet("consolelogs", [newEntry, ...logs].slice(0, 300));
  },

  // ── Phase 3: Server Config / JAR Control (Firestore-ready) ───────────────────
  // collection: server_config → stored in smp/serverconfig
  async getServerConfig()   { return (await _fbGet("serverconfig")) || SERVER_CONFIG_DEFAULT; },
  async setServerConfig(v)  { return _fbSet("serverconfig", v); },

  // ── Phase 3: Live Sessions (Firestore-ready, simulation-safe) ────────────────
  // collection: live_sessions → stored flat in smp/livesessions
  async getLiveSessions()   { return (await _fbGet("livesessions"))  || []; },
  async setLiveSessions(v)  { return _fbSet("livesessions", v); },
  async upsertLiveSession(entry) {
    const sessions = await DB.getLiveSessions();
    const existing = sessions.findIndex(s => s.username === entry.username);
    const updated = existing >= 0
      ? sessions.map((s,i) => i === existing ? { ...s, ...entry, updatedAt: new Date().toISOString() } : s)
      : [...sessions, { ...entry, joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
    return _fbSet("livesessions", updated.slice(0, 100));
  },

  // ── Phase 3: Combat Events (Firestore-ready, simulation-safe) ────────────────
  // collection: combat_events → stored flat in smp/combatevents
  async getCombatEvents()   { return (await _fbGet("combatevents"))  || []; },
  async setCombatEvents(v)  { return _fbSet("combatevents", v); },
  async pushCombatEvent(entry) {
    const events = await DB.getCombatEvents();
    const newEntry = {
      id: Date.now() + Math.random(),
      ts: new Date().toISOString(),
      type: "kill",   // "kill" | "death" | "assist" | "pvp"
      actor: "",
      target: "",
      weapon: null,
      source: "simulated",
      ...entry,
    };
    return _fbSet("combatevents", [newEntry, ...events].slice(0, 500));
  },

      // ── Bridge Heartbeat ─ Oracle daemon writes smp/bridgestatus every 10s ─────────────────
  async getBridgeStatus()  { return (await _fbGet("bridgestatus")) || null; },
  async setBridgeStatus(v) { return _fbSet("bridgestatus", v); },
};


// ═══════════════════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════════════════
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Share+Tech+Mono&family=Exo+2:wght@300;400;600&display=swap');
:root{--cyan:#00f5ff;--cyan-dim:#00c8d4;--purple:#b44dff;--green:#39ff14;--red:#ff4444;--amber:#fbbf24;--orange:#f97316;--blue:#3b82f6;--glass:rgba(5,20,40,0.72);--glass-b:rgba(0,245,255,0.14);--bg:#010812;--text:#c8e6f5;--dim:#4a7a99;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Exo 2',sans-serif;overflow:hidden;}
.orb{font-family:'Orbitron',monospace;}.mono{font-family:'Share Tech Mono',monospace;}
::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:rgba(0,0,0,.3);}::-webkit-scrollbar-thumb{background:var(--cyan-dim);border-radius:2px;}

@keyframes starDrift{from{transform:translateY(0)}to{transform:translateY(-50%)}}
@keyframes gridPulse{0%,100%{opacity:.04}50%{opacity:.09}}
@keyframes scan{0%{top:-5%}100%{top:105%}}
@keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeDown{from{opacity:0;transform:translateY(-18px)}to{opacity:1;transform:translateY(0)}}
@keyframes glowPulse{0%,100%{text-shadow:0 0 20px var(--cyan),0 0 60px rgba(0,245,255,.3)}50%{text-shadow:0 0 40px var(--cyan),0 0 100px rgba(0,245,255,.6)}}
@keyframes borderGlow{0%,100%{box-shadow:0 0 8px var(--cyan)}50%{box-shadow:0 0 24px var(--cyan),0 0 60px rgba(0,245,255,.2)}}
@keyframes pulseDot{0%,100%{opacity:1;transform:scale(1);box-shadow:0 0 6px currentColor}50%{opacity:.5;transform:scale(1.6);box-shadow:0 0 14px currentColor}}
@keyframes panelIn{from{opacity:0;transform:scale(.92) translateY(18px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes backdropIn{from{opacity:0}to{opacity:1}}
@keyframes hubIn{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
@keyframes particleFloat{0%,100%{transform:translateY(0) rotate(0deg);opacity:.6}50%{transform:translateY(-20px) rotate(180deg);opacity:1}}
@keyframes ringR{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes ringL{from{transform:rotate(0)}to{transform:rotate(-360deg)}}
@keyframes loadBar{from{width:0}to{width:100%}}
@keyframes hexFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes warIn{from{opacity:0;transform:translateX(-20px)}to{opacity:1;transform:translateX(0)}}
@keyframes successPop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
@keyframes toastIn{from{opacity:0;transform:translateX(120%)}to{opacity:1;transform:translateX(0)}}
@keyframes toastOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(120%)}}
@keyframes pingPulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2.5);opacity:0}}
@keyframes bellRing{0%,100%{transform:rotate(0)}20%{transform:rotate(-15deg)}40%{transform:rotate(15deg)}60%{transform:rotate(-10deg)}80%{transform:rotate(10deg)}}
@keyframes notifDrop{from{opacity:0;transform:translateY(-10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes musicBounce{0%,100%{transform:scaleY(0.4)}50%{transform:scaleY(1.6)}}
@keyframes surveySlide{from{opacity:0;transform:translateX(30px)}to{opacity:1;transform:translateX(0)}}

.scanline{position:fixed;left:0;width:100%;height:2px;background:linear-gradient(transparent,rgba(0,245,255,.04),transparent);animation:scan 6s linear infinite;pointer-events:none;z-index:9999;}
.stars-wrap{animation:starDrift 90s linear infinite;}
.glass{background:var(--glass);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--glass-b);border-radius:12px;}

.neon-btn{position:relative;background:transparent;border:1px solid var(--cyan);color:var(--cyan);font-family:'Orbitron',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:11px 26px;cursor:pointer;transition:all .3s;overflow:hidden;border-radius:4px;}
.neon-btn::before{content:'';position:absolute;inset:0;background:var(--cyan);transform:scaleX(0);transform-origin:left;transition:transform .3s;z-index:-1;}
.neon-btn:hover::before{transform:scaleX(1);}
.neon-btn:hover{color:#010812;box-shadow:0 0 28px var(--cyan);}
.neon-btn:disabled{opacity:.38;cursor:not-allowed;}
.neon-btn:disabled:hover::before{transform:scaleX(0);}
.neon-btn:disabled:hover{color:var(--cyan);box-shadow:none;}

.mcard{position:relative;background:rgba(0,15,30,.74);border:1px solid rgba(0,245,255,.13);border-radius:10px;padding:20px 16px;cursor:pointer;transition:all .34s;overflow:hidden;backdrop-filter:blur(10px);}
.mcard::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,245,255,.06) 0%,transparent 60%);opacity:0;transition:opacity .34s;}
.mcard:hover{border-color:var(--cyan);box-shadow:0 0 18px rgba(0,245,255,.2),0 0 50px rgba(0,245,255,.05),inset 0 0 18px rgba(0,245,255,.04);transform:translateY(-4px) scale(1.02);}
.mcard:hover::before{opacity:1;}
.mc-tl{position:absolute;top:8px;right:8px;width:7px;height:7px;border-top:2px solid var(--cyan);border-right:2px solid var(--cyan);opacity:.28;transition:opacity .3s;}
.mc-bl{position:absolute;bottom:8px;left:8px;width:7px;height:7px;border-bottom:2px solid var(--cyan);border-left:2px solid var(--cyan);opacity:.14;transition:opacity .3s;}
.mcard:hover .mc-tl{opacity:1;}.mcard:hover .mc-bl{opacity:.8;}

.overlay{position:fixed;inset:0;background:rgba(0,5,15,.9);backdrop-filter:blur(7px);z-index:100;display:flex;align-items:center;justify-content:center;animation:backdropIn .28s ease;padding:12px;}
.pmodal{width:min(94vw,880px);max-height:90vh;animation:panelIn .38s cubic-bezier(.22,1,.36,1);position:absolute;overflow:hidden;}
.pmodal-wide{width:min(98vw,1080px);}

.si{background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.2);border-radius:6px;color:var(--text);font-family:'Share Tech Mono',monospace;font-size:13px;padding:10px 14px;outline:none;transition:all .3s;width:100%;}
.si:focus{border-color:var(--cyan);box-shadow:0 0 12px rgba(0,245,255,.15);background:rgba(0,245,255,.07);}
.si option{background:#010c1a;}
.si-label{font-family:'Orbitron',monospace;font-size:9px;letter-spacing:2px;color:var(--cyan-dim);text-transform:uppercase;margin-bottom:6px;display:block;}

.close-btn{position:absolute;top:14px;right:14px;width:30px;height:30px;background:rgba(255,50,50,.1);border:1px solid rgba(255,50,50,.3);border-radius:6px;color:#ff5555;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:10;}
.close-btn:hover{background:rgba(255,50,50,.22);box-shadow:0 0 12px rgba(255,50,50,.3);}

.rule-item{border-left:2px solid var(--cyan);padding:10px 16px;margin:8px 0;background:rgba(0,245,255,.03);border-radius:0 6px 6px 0;font-size:13px;line-height:1.6;transition:all .2s;}
.rule-item:hover{background:rgba(0,245,255,.07);}
.diag-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid rgba(0,245,255,.1);border-radius:8px;margin:8px 0;background:rgba(0,10,25,.5);}
.war-entry{border:1px solid rgba(255,80,80,.2);border-radius:8px;padding:14px;margin:10px 0;background:rgba(20,0,0,.4);position:relative;animation:warIn .38s ease both;}
.war-entry::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(to bottom,#ff4444,var(--purple));border-radius:8px 0 0 8px;}
.pcard{background:rgba(0,15,35,.74);border:1px solid rgba(0,245,255,.12);border-radius:10px;padding:16px;transition:all .3s;position:relative;overflow:hidden;}
.pcard:hover{border-color:rgba(0,245,255,.35);transform:translateY(-2px);box-shadow:0 6px 28px rgba(0,245,255,.08);}
.scard{border:1px solid rgba(180,77,255,.2);border-radius:10px;padding:18px;background:rgba(20,5,40,.5);cursor:pointer;transition:all .3s;}
.scard:hover{border-color:var(--purple);box-shadow:0 0 18px rgba(180,77,255,.15);transform:translateY(-2px);}
.wl-row{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(0,245,255,.07);font-family:'Share Tech Mono',monospace;font-size:12px;transition:background .2s;}
.wl-row:hover{background:rgba(0,245,255,.04);}

.sradio{display:flex;gap:7px;flex-wrap:wrap;}
.srlabel{display:flex;align-items:center;gap:6px;background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.14);border-radius:5px;padding:6px 11px;cursor:pointer;font-size:11px;font-family:'Share Tech Mono',monospace;transition:all .2s;color:var(--dim);}
.srlabel:hover,.srlabel.act{border-color:var(--cyan);color:var(--cyan);background:rgba(0,245,255,.08);}
.srlabel input{display:none;}

.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9998;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.toast{background:rgba(5,20,40,.95);border-radius:8px;padding:12px 16px;min-width:260px;max-width:340px;backdrop-filter:blur(20px);pointer-events:auto;animation:toastIn .35s cubic-bezier(.22,1,.36,1) both;}
.toast.out{animation:toastOut .3s ease both;}

.bell-btn{position:relative;background:transparent;border:1px solid rgba(0,245,255,.18);border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;font-size:14px;}
.bell-btn:hover{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,245,255,.2);}
.bell-badge{position:absolute;top:-4px;right:-4px;width:14px;height:14px;background:var(--red);border-radius:50%;font-family:'Orbitron',monospace;font-size:8px;color:#fff;display:flex;align-items:center;justify-content:center;}
.bell-ringing{animation:bellRing .6s ease;}

.ping-ring{position:absolute;width:100%;height:100%;border-radius:50%;border:2px solid var(--green);animation:pingPulse 2s ease-out infinite;opacity:0;}
.notif-panel{position:fixed;top:52px;right:14px;width:min(90vw,340px);background:rgba(3,14,30,.97);border:1px solid rgba(0,245,255,.18);border-radius:10px;z-index:200;animation:notifDrop .28s ease both;backdrop-filter:blur(20px);}
.notif-item{padding:12px 14px;border-bottom:1px solid rgba(0,245,255,.07);transition:background .2s;}
.notif-item:hover{background:rgba(0,245,255,.04);}
.notif-item:last-child{border-bottom:none;}
.stat-btn{background:transparent;border:1px solid;border-radius:5px;padding:6px 12px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:1px;transition:all .2s;}
.mc-avatar{width:40px;height:40px;border-radius:6px;object-fit:cover;image-rendering:pixelated;}

/* MUSIC */
.music-player{position:fixed;background:rgba(3,10,25,.97);border:1px solid rgba(180,77,255,.4);border-radius:14px;z-index:300;backdrop-filter:blur(28px);box-shadow:0 0 50px rgba(180,77,255,.12),0 0 120px rgba(0,0,0,.5);user-select:none;min-width:300px;}
.music-player-header{display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(180,77,255,.15);cursor:grab;}
.music-player-header:active{cursor:grabbing;}
.music-bar{display:inline-block;width:3px;border-radius:2px;background:var(--purple);animation:musicBounce 0.5s ease-in-out infinite;margin:0 1px;transform-origin:bottom;}
.music-progress{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;outline:none;cursor:pointer;background:rgba(180,77,255,.2);}
.music-progress::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--purple);cursor:pointer;box-shadow:0 0 10px var(--purple);}
.music-vol{-webkit-appearance:none;appearance:none;width:70px;height:3px;border-radius:2px;background:rgba(180,77,255,.2);outline:none;cursor:pointer;}
.music-vol::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:var(--cyan-dim);cursor:pointer;}
.music-btn{background:transparent;border:1px solid rgba(180,77,255,.3);border-radius:6px;color:var(--purple);cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;}
.music-btn:hover{border-color:var(--purple);background:rgba(180,77,255,.14);box-shadow:0 0 10px rgba(180,77,255,.3);}
.yt-frame{width:100%;border:none;border-radius:8px;display:block;}

/* TOPBAR BUTTONS */
.topbar-music-btn{background:transparent;border:1px solid rgba(180,77,255,.25);border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;font-size:14px;color:var(--purple);}
.topbar-music-btn:hover{border-color:var(--purple);box-shadow:0 0 10px rgba(180,77,255,.3);}
.topbar-login-btn{background:transparent;border:1px solid rgba(0,245,255,.25);border-radius:6px;padding:5px 11px;cursor:pointer;font-family:'Orbitron',monospace;font-size:8px;letter-spacing:2px;color:var(--cyan);transition:all .2s;white-space:nowrap;}
.topbar-login-btn:hover{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,245,255,.2);background:rgba(0,245,255,.07);}

/* PFP UPLOAD */
.pfp-upload-zone{border:2px dashed rgba(0,245,255,.25);border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:all .3s;background:rgba(0,245,255,.02);}
.pfp-upload-zone:hover{border-color:var(--cyan);background:rgba(0,245,255,.06);}

/* LEADERBOARD */
.lb-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(0,245,255,.06);transition:background .2s;}
.lb-row:hover{background:rgba(0,245,255,.03);}

/* SURVEY STEPS */
.survey-step{animation:surveySlide .35s ease both;}
.step-dot{width:8px;height:8px;border-radius:50%;transition:all .3s;}

@media(max-width:640px){
  .pmodal,.pmodal-wide{width:99vw;max-height:96vh;}
  .hub-grid{grid-template-columns:1fr 1fr!important;}
  .survey-grid{grid-template-columns:1fr!important;}
  .player-grid{grid-template-columns:1fr!important;}
  .admin-tabs{flex-wrap:wrap!important;}
  .srv-grid{flex-direction:column!important;}
  .war-header{flex-direction:column!important;align-items:flex-start!important;}
  .topbar-right{gap:6px!important;}
  .topbar-center{display:none!important;}
  .topbar-desktop-btns{display:none!important;}
  .topbar-hamburger{display:flex!important;}
}

@media(max-width:420px){
  .hub-grid{grid-template-columns:1fr!important;}
  .neon-btn{padding:10px 18px!important;font-size:9px!important;}
}

/* CHANGELOG */
.cl-entry{border-left:3px solid rgba(0,245,255,.3);padding:10px 14px;margin:6px 0;background:rgba(0,245,255,.02);border-radius:0 6px 6px 0;transition:all .2s;}
.cl-entry:hover{background:rgba(0,245,255,.06);border-left-color:var(--cyan);}
/* COUNTDOWN */
@keyframes countPulse{0%,100%{opacity:1}50%{opacity:.6}}
.countdown-unit{background:rgba(0,245,255,.06);border:1px solid rgba(0,245,255,.15);border-radius:8px;padding:10px 14px;text-align:center;min-width:60px;}
/* POLL */
.poll-bar{height:6px;border-radius:3px;transition:width .6s cubic-bezier(.22,1,.36,1);}
/* TRADE */
.trade-card{background:rgba(0,15,35,.74);border:1px solid rgba(57,255,20,.15);border-radius:10px;padding:14px;transition:all .3s;}
.trade-card:hover{border-color:rgba(57,255,20,.4);box-shadow:0 0 18px rgba(57,255,20,.08);transform:translateY(-2px);}
/* ACHIEVEMENTS */
.ach-card{background:rgba(20,10,0,.6);border:1px solid rgba(251,191,36,.18);border-radius:10px;padding:14px;transition:all .3s;position:relative;overflow:hidden;}
.ach-card.unlocked{border-color:rgba(251,191,36,.5);background:rgba(30,20,0,.7);}
.ach-card.locked{opacity:.5;filter:grayscale(.6);}
/* VOTE */
.vote-opt{padding:10px 14px;border-radius:7px;border:1px solid rgba(0,245,255,.15);cursor:pointer;transition:all .25s;background:rgba(0,245,255,.03);}
.vote-opt:hover{border-color:var(--cyan);background:rgba(0,245,255,.08);}
.vote-opt.voted{border-color:var(--cyan);background:rgba(0,245,255,.12);box-shadow:0 0 12px rgba(0,245,255,.15);}
/* PROFILE MODAL */
.profile-banner{width:100%;height:110px;object-fit:cover;display:block;}
.profile-banner-wrap{position:relative;border-radius:12px 12px 0 0;overflow:hidden;background:linear-gradient(135deg,rgba(0,12,30,1) 0%,rgba(20,0,40,1) 50%,rgba(0,10,25,1) 100%);}
.copy-btn{background:transparent;border:1px solid rgba(0,245,255,.2);border-radius:4px;color:var(--dim);cursor:pointer;padding:2px 7px;font-size:10px;transition:all .2s;font-family:'Share Tech Mono',monospace;}
.copy-btn:hover{border-color:var(--cyan);color:var(--cyan);}
@keyframes profileIn{from{opacity:0;transform:translateX(30px) scale(.97)}to{opacity:1;transform:translateX(0) scale(1)}}

/* ═══════════════════════════════════════════════════════
   LIGHT THEME — NexSci SMP v10.0
   ═══════════════════════════════════════════════════════ */
body.light{
  --bg:#e8f2fb;--text:#0c1e2e;--dim:#4d7490;
  --cyan:#0077aa;--cyan-dim:#005f8a;--purple:#7a1dcc;
  --green:#167700;--red:#bb1111;--amber:#8c5f00;
  --orange:#ac4000;--blue:#1a4fbb;
  --glass:rgba(255,255,255,0.80);--glass-b:rgba(0,90,160,0.15);
}
body.light{background:linear-gradient(145deg,#d0e8f8 0%,#eaf2fb 40%,#ede8f8 75%,#d8eaf8 100%);background-attachment:fixed;}
body.light .stars-wrap{opacity:0.05;}
body.light .scanline{background:linear-gradient(transparent,rgba(0,80,160,.015),transparent);}
body.light ::-webkit-scrollbar-track{background:rgba(0,70,140,.06);}
body.light ::-webkit-scrollbar-thumb{background:#7ab0cc;border-radius:2px;}
body.light .glass{background:rgba(255,255,255,.82)!important;border:1px solid rgba(0,90,160,.18)!important;box-shadow:0 4px 28px rgba(0,50,120,.08)!important;backdrop-filter:blur(22px)!important;-webkit-backdrop-filter:blur(22px)!important;}
body.light [style*="rgba(1,8,18,.92)"]{background:rgba(235,247,255,.96)!important;border-bottom:1px solid rgba(0,90,160,.14)!important;box-shadow:0 2px 14px rgba(0,50,120,.08)!important;}
body.light .mcard{background:rgba(255,255,255,.78)!important;border:1px solid rgba(0,90,160,.14)!important;box-shadow:0 2px 10px rgba(0,50,120,.06)!important;}
body.light .mcard:hover{border-color:var(--cyan)!important;box-shadow:0 0 18px rgba(0,90,160,.18),0 6px 28px rgba(0,50,120,.1)!important;}
body.light .pcard{background:rgba(255,255,255,.82)!important;border:1px solid rgba(0,90,160,.13)!important;}
body.light .pcard:hover{border-color:rgba(0,90,160,.4)!important;box-shadow:0 6px 24px rgba(0,50,120,.1)!important;}
body.light .si{background:rgba(255,255,255,.94)!important;border:1px solid rgba(0,90,160,.2)!important;color:var(--text)!important;}
body.light .si:focus{border-color:var(--cyan)!important;box-shadow:0 0 10px rgba(0,90,160,.14)!important;background:#fff!important;}
body.light .si option{background:#fff!important;color:#0c1e2e!important;}
body.light .si-label{color:var(--cyan-dim)!important;}
body.light .neon-btn{border-color:var(--cyan)!important;color:var(--cyan)!important;}
body.light .neon-btn::before{background:var(--cyan)!important;}
body.light .neon-btn:hover{color:#fff!important;box-shadow:0 0 22px rgba(0,90,160,.35)!important;}
body.light .close-btn{background:rgba(160,20,20,.07)!important;border-color:rgba(160,20,20,.25)!important;}
body.light .topbar-login-btn{border-color:rgba(0,90,160,.26)!important;color:var(--cyan)!important;}
body.light .topbar-login-btn:hover{border-color:var(--cyan)!important;background:rgba(0,90,160,.09)!important;}
body.light .topbar-music-btn{border-color:rgba(100,20,180,.28)!important;color:var(--purple)!important;}
body.light .bell-btn{border-color:rgba(0,90,160,.2)!important;}
body.light .notif-panel{background:rgba(255,255,255,.98)!important;border-color:rgba(0,90,160,.2)!important;box-shadow:0 8px 32px rgba(0,50,120,.12)!important;}
body.light .notif-item{border-bottom-color:rgba(0,90,160,.07)!important;}
body.light .notif-item:hover{background:rgba(0,90,160,.04)!important;}
body.light .toast{background:rgba(255,255,255,.97)!important;box-shadow:0 4px 20px rgba(0,50,120,.12)!important;}
body.light .ticker-wrap{background:rgba(235,247,255,.9)!important;border-bottom-color:rgba(0,90,160,.1)!important;}
body.light .ticker-item{color:rgba(0,70,130,.65)!important;}
body.light .ticker-dot{background:rgba(0,90,160,.4)!important;}
body.light .rule-item{background:rgba(0,90,160,.04)!important;border-left-color:var(--cyan)!important;}
body.light .rule-item:hover{background:rgba(0,90,160,.09)!important;}
body.light .diag-row{background:rgba(255,255,255,.72)!important;border-color:rgba(0,90,160,.13)!important;}
body.light .scard{background:rgba(255,255,255,.74)!important;border-color:rgba(100,20,180,.18)!important;}
body.light .scard:hover{border-color:var(--purple)!important;}
body.light .lb-row{border-bottom-color:rgba(0,90,160,.07)!important;}
body.light .lb-row:hover{background:rgba(0,90,160,.04)!important;}
body.light .war-entry{background:rgba(255,245,245,.75)!important;border-color:rgba(150,20,20,.2)!important;}
body.light .trade-card{background:rgba(255,255,255,.78)!important;border-color:rgba(15,110,0,.16)!important;}
body.light .trade-card:hover{border-color:rgba(15,110,0,.4)!important;}
body.light .ach-card{background:rgba(255,252,238,.84)!important;border-color:rgba(130,85,0,.18)!important;}
body.light .ach-card.unlocked{border-color:rgba(130,85,0,.45)!important;background:rgba(255,248,215,.92)!important;}
body.light .ach-card.locked{opacity:.55!important;filter:grayscale(.45)!important;}
body.light .cl-entry{background:rgba(0,90,160,.03)!important;border-left-color:rgba(0,90,160,.32)!important;}
body.light .cl-entry:hover{background:rgba(0,90,160,.07)!important;border-left-color:var(--cyan)!important;}
body.light .countdown-unit{background:rgba(0,90,160,.06)!important;border-color:rgba(0,90,160,.18)!important;}
body.light .wl-row{border-bottom-color:rgba(0,90,160,.07)!important;}
body.light .wl-row:hover{background:rgba(0,90,160,.04)!important;}
body.light .setting-row{border-bottom-color:rgba(0,90,160,.07)!important;}
body.light .setting-row:hover{background:rgba(0,90,160,.04)!important;}
body.light .toggle-slider{background:rgba(0,90,160,.1)!important;border-color:rgba(0,90,160,.22)!important;}
body.light .toggle-slider::before{background:rgba(0,90,160,.38)!important;}
body.light .toggle input:checked+.toggle-slider{background:rgba(0,90,160,.2)!important;border-color:var(--cyan)!important;}
body.light .toggle input:checked+.toggle-slider::before{background:var(--cyan)!important;box-shadow:0 0 8px rgba(0,90,160,.38)!important;}
body.light .music-player{background:rgba(255,255,255,.97)!important;border-color:rgba(100,20,180,.3)!important;}
body.light .music-btn{border-color:rgba(100,20,180,.28)!important;color:var(--purple)!important;}
body.light .vote-opt{background:rgba(0,90,160,.04)!important;border-color:rgba(0,90,160,.14)!important;}
body.light .vote-opt:hover{border-color:var(--cyan)!important;background:rgba(0,90,160,.09)!important;}
body.light .vote-opt.voted{border-color:var(--cyan)!important;background:rgba(0,90,160,.14)!important;}
body.light .profile-banner-wrap{background:linear-gradient(135deg,#c8dff0 0%,#ddd0f0 60%,#c8dff0 100%)!important;}
body.light .copy-btn{border-color:rgba(0,90,160,.22)!important;color:var(--dim)!important;}
body.light .pfp-upload-zone{border-color:rgba(0,90,160,.22)!important;background:rgba(0,90,160,.03)!important;}

/* TICKER */
@keyframes tickerMove{from{transform:translateX(100vw)}to{transform:translateX(-100%)}}
.ticker-wrap{position:fixed;top:44px;left:0;right:0;height:20px;overflow:hidden;z-index:49;background:rgba(0,5,15,.65);border-bottom:1px solid rgba(0,245,255,.07);display:flex;align-items:center;pointer-events:none;}
.ticker-track{display:flex;white-space:nowrap;animation:tickerMove 50s linear infinite;}
.ticker-item{padding:0 28px;font-family:'Share Tech Mono',monospace;font-size:9px;color:rgba(0,245,255,.5);letter-spacing:1.5px;display:flex;align-items:center;gap:8px;}
.ticker-dot{width:3px;height:3px;border-radius:50%;background:rgba(0,245,255,.4);flex-shrink:0;}

/* BOOT SCREEN */
@keyframes bootBar{from{width:0}to{width:100%}}
@keyframes bootCursor{0%,100%{opacity:1}50%{opacity:0}}
@keyframes bootSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.boot-line{font-family:'Share Tech Mono',monospace;font-size:11px;color:rgba(0,245,255,.75);line-height:2;animation:bootSlideUp .25s ease both;}
.boot-cursor{display:inline-block;width:7px;height:12px;background:rgba(0,245,255,.7);animation:bootCursor .8s step-end infinite;vertical-align:middle;margin-left:2px;}

/* ANIMATED EMOJI */
@keyframes emojiFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-5px) scale(1.12)}}
@keyframes emojiSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
@keyframes emojiBounce{0%,100%{transform:scaleY(1)}45%{transform:scaleY(1.3)}}
@keyframes emojiPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
.card-emoji-float{display:inline-block;animation:emojiFloat 2.4s ease-in-out infinite;}
.card-emoji-spin{display:inline-block;animation:emojiSpin 5s linear infinite;}
.card-emoji-bounce{display:inline-block;animation:emojiBounce 1s ease-in-out infinite;}
.card-emoji-pulse{display:inline-block;animation:emojiPulse 2s ease-in-out infinite;}

/* SETTINGS */
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid rgba(0,245,255,.06);transition:background .2s;}
.setting-row:hover{background:rgba(0,245,255,.03);}
.setting-row:last-child{border-bottom:none;}
.toggle{position:relative;width:38px;height:20px;cursor:pointer;flex-shrink:0;}
.toggle input{opacity:0;width:0;height:0;position:absolute;}
.toggle-slider{position:absolute;inset:0;border-radius:10px;background:rgba(0,245,255,.12);border:1px solid rgba(0,245,255,.2);transition:all .3s;}
.toggle-slider::before{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:rgba(0,245,255,.4);top:2px;left:2px;transition:all .3s;}
.toggle input:checked+.toggle-slider{background:rgba(0,245,255,.2);border-color:var(--cyan);}
.toggle input:checked+.toggle-slider::before{transform:translateX(18px);background:var(--cyan);box-shadow:0 0 8px var(--cyan);}

/* EXTRA SMOOTH ANIMATIONS */
@keyframes fadeInScale{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes slideInBottom{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
.panel-anim{animation:fadeInScale .42s cubic-bezier(.22,1,.36,1) both;}

/* ═══ v6.0 NEW STYLES ═══ */
/* CHAT */
@keyframes msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.chat-msg{animation:msgIn .2s ease both;padding:7px 10px;border-radius:8px;margin-bottom:4px;transition:background .2s;}
.chat-msg:hover{background:rgba(0,245,255,.04);}
.chat-input-wrap{display:flex;gap:8px;align-items:flex-end;padding:10px;border-top:1px solid rgba(0,245,255,.1);background:rgba(0,5,15,.5);}
.chat-channel-btn{background:transparent;border:1px solid rgba(0,245,255,.18);border-radius:6px;padding:5px 12px;font-family:'Orbitron',monospace;font-size:7px;letter-spacing:1.5px;cursor:pointer;transition:all .2s;color:var(--dim);}
.chat-channel-btn.active{border-color:var(--cyan);color:var(--cyan);background:rgba(0,245,255,.08);}
.chat-channel-btn:hover{border-color:var(--cyan);color:var(--cyan);}
.emoji-picker{display:flex;gap:4px;flex-wrap:wrap;padding:6px;background:rgba(0,10,25,.95);border:1px solid rgba(0,245,255,.2);border-radius:8px;position:absolute;bottom:100%;left:0;z-index:50;animation:fadeInScale .2s ease both;}
.reaction-btn{background:rgba(0,245,255,.05);border:1px solid rgba(0,245,255,.1);border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:4px;}
.reaction-btn:hover,.reaction-btn.reacted{border-color:var(--cyan);background:rgba(0,245,255,.14);}
.voice-bar{background:rgba(0,245,255,.07);border:1px solid rgba(0,245,255,.2);border-radius:8px;padding:6px 10px;display:flex;align-items:center;gap:8px;}

/* SEASON PASS */
@keyframes levelUp{0%{transform:scale(1)}50%{transform:scale(1.25)}100%{transform:scale(1)}}
.sp-level-card{min-width:80px;height:96px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex-shrink:0;border:1px solid;cursor:default;transition:all .2s;position:relative;}
.sp-level-card.unlocked{border-color:rgba(0,245,255,.5);background:rgba(0,245,255,.08);}
.sp-level-card.locked{border-color:rgba(0,245,255,.1);background:rgba(0,5,15,.6);opacity:.5;}
.sp-level-card.premium{border-color:rgba(251,191,36,.5);background:rgba(251,191,36,.08);}
.sp-level-card.current{animation:borderGlow 2s ease-in-out infinite;border-color:var(--cyan);}
.sp-scroll{display:flex;gap:8px;overflow-x:auto;padding:8px 2px 12px;scrollbar-width:thin;}
.sp-scroll::-webkit-scrollbar{height:4px;}
.xp-bar{height:8px;border-radius:4px;background:rgba(0,245,255,.1);overflow:hidden;}
.xp-fill{height:100%;border-radius:4px;background:linear-gradient(to right,var(--cyan),var(--purple));transition:width .6s cubic-bezier(.22,1,.36,1);}

/* COSMETICS */
.cosm-card{border:1px solid rgba(0,245,255,.15);border-radius:10px;padding:12px;cursor:pointer;transition:all .2s;text-align:center;position:relative;}
.cosm-card:hover{border-color:var(--cyan);transform:translateY(-2px);box-shadow:0 0 14px rgba(0,245,255,.15);}
.cosm-card.equipped{border-color:var(--green);background:rgba(57,255,20,.06);}
.cosm-card.locked{opacity:.45;cursor:not-allowed;}
.cosm-card.locked:hover{transform:none;border-color:rgba(0,245,255,.15);}

/* GALLERY */
.gallery-slot{border:2px dashed rgba(0,245,255,.2);border-radius:10px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .3s;overflow:hidden;position:relative;}
.gallery-slot:hover{border-color:var(--cyan);background:rgba(0,245,255,.05);}
.gallery-slot.filled{border-style:solid;border-color:rgba(0,245,255,.3);}
.gallery-slot img{width:100%;height:100%;object-fit:cover;}

/* SUGGESTION BOX */
.sug-card{border:1px solid rgba(0,245,255,.12);border-radius:10px;padding:14px;transition:all .2s;position:relative;}
.sug-card:hover{border-color:rgba(0,245,255,.28);background:rgba(0,245,255,.02);}
.sug-status{font-family:'Orbitron',monospace;font-size:7px;letter-spacing:2px;padding:2px 8px;border-radius:3px;}

/* POTW */
@keyframes crownBounce{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-8px) rotate(5deg)}}
.potw-crown{animation:crownBounce 2s ease-in-out infinite;display:inline-block;}
.potw-card{background:linear-gradient(135deg,rgba(251,191,36,.08),rgba(180,77,255,.05));border:1px solid rgba(251,191,36,.3);border-radius:14px;padding:20px;position:relative;overflow:hidden;}
.potw-card::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 30% 50%,rgba(251,191,36,.06),transparent 60%);pointer-events:none;}

/* Light mode adjustments for new components */
body.light .chat-msg:hover{background:rgba(0,90,160,.04)!important;}
body.light .chat-channel-btn{border-color:rgba(0,90,160,.18)!important;color:var(--dim)!important;}
body.light .chat-channel-btn.active,.chat-channel-btn:hover{border-color:var(--cyan)!important;color:var(--cyan)!important;}
body.light .sug-card{border-color:rgba(0,90,160,.13)!important;}
body.light .gallery-slot{border-color:rgba(0,90,160,.22)!important;}
body.light .cosm-card{border-color:rgba(0,90,160,.15)!important;}

/* ═══ v7.0 NEW STYLES ═══ */
/* DIAGNOSTICS DASHBOARD */
.diag-metric{background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.18);border-radius:8px;padding:12px 14px;text-align:center;}
.ping-graph{display:flex;align-items:flex-end;gap:2px;height:40px;padding:4px;}
.ping-bar-g{flex:1;border-radius:2px 2px 0 0;min-width:6px;transition:height .3s;}
.flag-row{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid rgba(0,245,255,.06);}
.flag-row:last-child{border-bottom:none;}
.admin-log-item{padding:7px 10px;border-bottom:1px solid rgba(249,115,22,.06);font-family:'Share Tech Mono',monospace;font-size:9px;}
.admin-log-item:last-child{border-bottom:none;}

/* ALLIANCE */
@keyframes allianceIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.alliance-card{border:1px solid rgba(0,245,255,.15);border-radius:10px;padding:14px;transition:all .3s;position:relative;overflow:hidden;}
.alliance-card:hover{border-color:var(--cyan);transform:translateY(-2px);box-shadow:0 0 18px rgba(0,245,255,.1);}
.alliance-tag{font-family:'Orbitron',monospace;font-size:7px;letter-spacing:2px;padding:2px 8px;border-radius:3px;border:1px solid;display:inline-block;}
.alliance-member-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;transition:background .2s;}
.alliance-member-row:hover{background:rgba(0,245,255,.04);}

/* BULLETIN */
.bulletin-card{border:1px solid rgba(0,245,255,.12);border-radius:10px;padding:14px;margin-bottom:10px;transition:all .2s;position:relative;}
.bulletin-card:hover{border-color:rgba(0,245,255,.3);}
.bulletin-cat{font-family:'Orbitron',monospace;font-size:7px;letter-spacing:2px;padding:2px 8px;border-radius:3px;}

/* BAN LOG */
.ban-entry{border-radius:8px;padding:12px 14px;margin-bottom:8px;border:1px solid;}
.ban-type-warn{border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.04);}
.ban-type-tempban{border-color:rgba(249,115,22,.3);background:rgba(249,115,22,.04);}
.ban-type-permban{border-color:rgba(255,68,68,.35);background:rgba(255,68,68,.05);}
.appeal-form{background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.15);border-radius:8px;padding:12px;}

/* MOD REVIEW */
.mod-card{border:1px solid rgba(180,77,255,.18);border-radius:10px;padding:14px;margin-bottom:10px;transition:all .2s;}
.mod-card:hover{border-color:rgba(180,77,255,.4);}
.mod-status-approved{color:var(--green);border-color:rgba(57,255,20,.4);}
.mod-status-rejected{color:var(--red);border-color:rgba(255,68,68,.4);}
.mod-status-testing{color:var(--amber);border-color:rgba(251,191,36,.4);}
.mod-status-pending{color:var(--dim);border-color:rgba(0,245,255,.2);}
.mod-comment{background:rgba(0,245,255,.03);border-left:2px solid rgba(0,245,255,.2);padding:6px 10px;margin-top:5px;border-radius:0 4px 4px 0;}

/* SCHEDULED ANN */
.sched-ann-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(0,245,255,.07);}
.sched-ann-row:last-child{border-bottom:none;}

body.light .diag-metric{background:rgba(0,90,160,.05)!important;border-color:rgba(0,90,160,.18)!important;}
body.light .alliance-card{border-color:rgba(0,90,160,.15)!important;}
body.light .bulletin-card{border-color:rgba(0,90,160,.12)!important;}
body.light .mod-card{border-color:rgba(100,20,180,.15)!important;}
body.light .ban-entry{background:rgba(255,255,255,.7)!important;}

/* ═══ Phase 3 — CONSOLE PANEL ═══ */
@keyframes consoleCursor{0%,100%{opacity:1}50%{opacity:0}}
@keyframes logLine{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:translateX(0)}}
.console-wrap{background:#000d1a;border:1px solid rgba(0,245,255,.18);border-radius:8px;overflow:hidden;}
.console-log{padding:3px 12px;font-family:'Share Tech Mono',monospace;font-size:10px;line-height:1.7;border-bottom:1px solid rgba(0,245,255,.03);animation:logLine .15s ease both;}
.console-log:last-child{border-bottom:none;}
.console-cursor{display:inline-block;width:8px;height:12px;background:rgba(0,245,255,.7);animation:consoleCursor .8s step-end infinite;vertical-align:middle;margin-left:2px;}
.console-input-wrap{display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(0,245,255,.03);border-top:1px solid rgba(0,245,255,.12);}
.console-prefix{font-family:'Share Tech Mono',monospace;font-size:11px;color:rgba(57,255,20,.8);white-space:nowrap;}
.console-input{background:transparent;border:none;outline:none;font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text);flex:1;caret-color:var(--cyan);}

/* ═══ Phase 3 — JAR CONTROL PANEL ═══ */
@keyframes jarPulse{0%,100%{box-shadow:0 0 0 0 rgba(57,255,20,.4)}70%{box-shadow:0 0 0 8px rgba(57,255,20,.0)}}
.jar-card{border:1px solid rgba(0,245,255,.15);border-radius:10px;padding:14px 16px;cursor:pointer;transition:all .25s;position:relative;}
.jar-card:hover{border-color:var(--cyan);background:rgba(0,245,255,.04);transform:translateY(-1px);}
.jar-card.selected{border-color:var(--cyan);background:rgba(0,245,255,.07);box-shadow:0 0 16px rgba(0,245,255,.12);}
.srv-ctrl-btn{position:relative;border-radius:8px;font-family:'Orbitron',monospace;font-size:9px;letter-spacing:2px;cursor:pointer;transition:all .3s;border:none;overflow:hidden;}
.srv-ctrl-btn.running{animation:jarPulse 2s ease-in-out infinite;}

/* ═══ Phase 3 — LIVE SESSION PANEL ═══ */
@keyframes sessionIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.session-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(0,245,255,.06);transition:background .2s;animation:sessionIn .25s ease both;}
.session-row:hover{background:rgba(0,245,255,.03);}
.session-row:last-child{border-bottom:none;}
.online-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;position:relative;}
.online-dot.online{background:var(--green);box-shadow:0 0 6px var(--green);}
.online-dot.online::after{content:'';position:absolute;inset:-3px;border-radius:50%;border:1px solid var(--green);animation:pingPulse 2s ease-out infinite;opacity:0;}
.online-dot.offline{background:#444;}
.online-dot.afk{background:var(--amber);}

/* ═══ Phase 3 — COMBAT FEED PANEL ═══ */
@keyframes combatIn{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
.combat-entry{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:7px;margin-bottom:6px;animation:combatIn .2s ease both;border:1px solid;}
.combat-kill{background:rgba(57,255,20,.04);border-color:rgba(57,255,20,.18);}
.combat-death{background:rgba(255,68,68,.04);border-color:rgba(255,68,68,.18);}
.combat-pvp{background:rgba(180,77,255,.04);border-color:rgba(180,77,255,.18);}
.combat-assist{background:rgba(251,191,36,.04);border-color:rgba(251,191,36,.18);}

body.light .console-wrap{background:rgba(230,245,255,.9)!important;border-color:rgba(0,90,160,.2)!important;}
body.light .console-log{border-bottom-color:rgba(0,90,160,.05)!important;}
body.light .console-input-wrap{background:rgba(0,90,160,.04)!important;border-top-color:rgba(0,90,160,.12)!important;}
body.light .jar-card{border-color:rgba(0,90,160,.14)!important;}
body.light .jar-card.selected{border-color:var(--cyan)!important;background:rgba(0,90,160,.06)!important;}
body.light .session-row:hover{background:rgba(0,90,160,.03)!important;}
`;

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS CONTEXT — user-local, stored in localStorage
// ═══════════════════════════════════════════════════════════════════════════════
const SETTINGS_KEY="nexsci_settings";
const SETTINGS_DEFAULT={
  theme:"dark",            // "dark"|"light"
  sounds:true,             // UI click sounds on/off
  tickerVisible:true,      // notif ticker strip
  animatedEmoji:true,      // animated card icons
  reducedMotion:false,     // strip heavy animations
  compactCards:false,      // smaller player cards
  clockFormat:"24h",       // "12h"|"24h"
  accentColor:"cyan",      // "cyan"|"purple"|"green"|"amber"
};
const SettingsCtx=createContext({settings:SETTINGS_DEFAULT,setSetting:()=>{}});
function useSettings(){return useContext(SettingsCtx);}
function SettingsProvider({children}){
  const[settings,setSettings]=useState(()=>{
    try{const s=localStorage.getItem(SETTINGS_KEY);return s?{...SETTINGS_DEFAULT,...JSON.parse(s)}:SETTINGS_DEFAULT;}
    catch{return SETTINGS_DEFAULT;}
  });
  const setSetting=useCallback((k,v)=>{
    setSettings(prev=>{
      const next={...prev,[k]:v};
      try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(next));}catch{}
      return next;
    });
  },[]);
  // Apply theme to body
  useEffect(()=>{
    document.body.classList.toggle("light",settings.theme==="light");
  },[settings.theme]);
  return <SettingsCtx.Provider value={{settings,setSetting}}>{children}</SettingsCtx.Provider>;
}

// ─── SOUND ENGINE ─────────────────────────────────────────────────────────────
const SFX={
  click:()=>playTone(880,0.06,0.05,"square"),
  notif:()=>playTone(660,0.1,0.15,"sine"),
  open:()=>playTone(440,0.05,0.08,"sine"),
  close:()=>playTone(330,0.05,0.07,"sine"),
  success:()=>playChord([523,659,784],0.07,0.2),
  error:()=>playTone(200,0.08,0.12,"sawtooth"),
};
function playTone(freq,vol,dur,type="sine"){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator();const g=ctx.createGain();
    o.connect(g);g.connect(ctx.destination);
    o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(vol,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
    o.start();o.stop(ctx.currentTime+dur);
    setTimeout(()=>ctx.close(),dur*1000+100);
  }catch{}
}
function playChord(freqs,vol,dur){freqs.forEach((f,i)=>setTimeout(()=>playTone(f,vol,dur,"sine"),i*60));}
// Global hook — checks settings before playing
function useSound(){
  const{settings}=useSettings();
  return useCallback((name)=>{if(settings.sounds&&SFX[name])SFX[name]();},[settings.sounds]);
}

// ─── STARTUP SOUND — fires on user gesture (browser requires it) ───────────────
function _playStartupSound(){
  try{
    const raw=localStorage.getItem("nexsci_settings");
    const cfg=raw?JSON.parse(raw):{};
    if(cfg.sounds===false)return;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return;
    const ctx=new AC();
    const notes=[
      {f:130,t:0,   d:0.5,v:0.03},{f:196,t:0.08,d:0.5,v:0.04},
      {f:261,t:0.18,d:0.5,v:0.04},{f:392,t:0.5, d:0.5,v:0.05},
      {f:523,t:0.6, d:0.55,v:0.06},{f:659,t:0.68,d:0.5,v:0.05},
      {f:784,t:0.76,d:0.5,v:0.05},{f:1046,t:1.0,d:0.9,v:0.04},
      {f:1318,t:1.1,d:0.8,v:0.03},
    ];
    notes.forEach(({f,t,d,v})=>{
      const o=ctx.createOscillator();const g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.type="sine";o.frequency.value=f;
      g.gain.setValueAtTime(0,ctx.currentTime+t);
      g.gain.linearRampToValueAtTime(v,ctx.currentTime+t+0.05);
      g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+t+d);
      o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+d+0.05);
    });
    setTimeout(()=>{try{ctx.close();}catch{}},3000);
  }catch(e){}
}

// ─── BOOT SCREEN ──────────────────────────────────────────────────────────────
const BOOT_LINES=[
  "[NEXSCI OS v10.0] Initializing neural interface...",
  "[NETWORK] Connecting to Firestore cluster... OK",
  "[AUTH] Loading session state...",
  "[MODULES] server · players · wars · seasons · trades · polls · achievements",
  "[FIREBASE] Syncing player data... OK",
  "[AUDIO] Sound engine v2 loaded",
  "[RENDER] Canvas compositor ready",
  "[SECURITY] Token validated ✓",
  "System ready. Welcome to NexSci SMP v10.0.",
];
function BootScreen({onDone}){
  const[lines,setLines]=useState([]);
  const[progress,setProgress]=useState(0);
  const[done,setDone]=useState(false);
  useEffect(()=>{
    let i=0;
    const interval=setInterval(()=>{
      if(i<BOOT_LINES.length){
        setLines(l=>[...l,BOOT_LINES[i]]);
        setProgress(Math.round(((i+1)/BOOT_LINES.length)*100));
        i++;
      }else{
        clearInterval(interval);
        setTimeout(()=>{setDone(true);setTimeout(onDone,500);},400);
      }
    },220);
    return()=>clearInterval(interval);
  },[onDone]);
  return(
    <div style={{
      position:"fixed",inset:0,zIndex:9999,background:"#000d1a",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      opacity:done?0:1,transition:"opacity .5s ease",
    }}>
      {/* scan lines overlay */}
      <div style={{position:"absolute",inset:0,backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,245,255,.015) 2px,rgba(0,245,255,.015) 4px)",pointerEvents:"none"}}/>
      {/* corner brackets — proper camelCase React styles */}
      {[
        {top:16,left:16,borderTop:"2px solid",borderLeft:"2px solid"},
        {top:16,right:16,borderTop:"2px solid",borderRight:"2px solid"},
        {bottom:16,left:16,borderBottom:"2px solid",borderLeft:"2px solid"},
        {bottom:16,right:16,borderBottom:"2px solid",borderRight:"2px solid"},
      ].map((s,i)=>(
        <div key={i} style={{position:"absolute",width:24,height:24,borderColor:"rgba(0,245,255,.4)",...s}}/>
      ))}
      <div style={{width:"min(90vw,560px)"}}>
        {/* LOGO */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontFamily:"Orbitron",fontWeight:900,fontSize:"clamp(22px,4vw,38px)",color:"#fff",letterSpacing:6,marginBottom:6}}>
            NEXSCI <span style={{color:"#00f5ff",textShadow:"0 0 20px #00f5ff"}}>SMP</span>
          </div>
          <div style={{fontFamily:"Share Tech Mono",fontSize:10,color:"rgba(0,245,255,.4)",letterSpacing:4}}>NEURAL COMMAND INTERFACE · v10.0</div>
        </div>
        {/* TERMINAL */}
        <div style={{background:"rgba(0,245,255,.03)",border:"1px solid rgba(0,245,255,.15)",borderRadius:8,padding:"16px 20px",minHeight:200,marginBottom:20}}>
          <div style={{fontFamily:"Share Tech Mono",fontSize:9,color:"rgba(0,245,255,.35)",letterSpacing:2,marginBottom:10,borderBottom:"1px solid rgba(0,245,255,.08)",paddingBottom:8}}>NEXSCI_OS // BOOT TERMINAL</div>
          {lines.map((l,i)=>(
            <div key={i} className="boot-line" style={{animationDelay:`${i*0.02}s`}}>
              <span style={{color:"rgba(0,245,255,.35)",marginRight:8}}>{">"}</span>{l}
            </div>
          ))}
          {!done&&<div style={{marginTop:4}}><span style={{fontFamily:"Share Tech Mono",fontSize:11,color:"rgba(0,245,255,.6)"}}>{">"}</span><span className="boot-cursor"/></div>}
        </div>
        {/* PROGRESS BAR */}
        <div style={{background:"rgba(0,245,255,.07)",borderRadius:2,height:3,overflow:"hidden"}}>
          <div style={{height:"100%",background:"linear-gradient(to right,#00f5ff,#b44dff)",width:`${progress}%`,transition:"width .2s ease",boxShadow:"0 0 8px #00f5ff"}}/>
        </div>
        <div style={{fontFamily:"Share Tech Mono",fontSize:9,color:"rgba(0,245,255,.35)",textAlign:"right",marginTop:4,letterSpacing:1}}>{progress}%</div>
      </div>
    </div>
  );
}

// ─── NOTIFICATION TICKER ──────────────────────────────────────────────────────
function NotifTicker(){
  const{settings}=useSettings();
  const[notifs,setNotifs]=useState([]);
  useEffect(()=>{
    DB.getNotifs().then(ns=>setNotifs(ns.slice(0,10)));
    const t=setInterval(()=>DB.getNotifs().then(ns=>setNotifs(ns.slice(0,10))),15000);
    return()=>clearInterval(t);
  },[]);
  if(!settings.tickerVisible||notifs.length===0)return null;
  const NC={server:"#39ff14",war:"#ff4444",survey:"#3b82f6",admin:"#f97316",system:"#00f5ff",access:"#b44dff",leaderboard:"#fbbf24"};
  const items=[...notifs,...notifs]; // duplicate for seamless loop
  return(
    <div className="ticker-wrap">
      <div className="ticker-track">
        {items.map((n,i)=>(
          <span key={i} className="ticker-item">
            <span className="ticker-dot" style={{background:NC[n.type]||"rgba(0,245,255,.4)"}}/>
            <span style={{color:NC[n.type]||"rgba(0,245,255,.5)"}}>{n.title}</span>
            <span style={{color:"rgba(0,245,255,.35)"}}>—</span>
            <span>{n.body}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── SETTINGS PANEL ───────────────────────────────────────────────────────────
function SettingsPanel({onClose}){
  const{settings,setSetting}=useSettings();
  const play=useSound();
  const Toggle=({k})=>(
    <label className="toggle">
      <input type="checkbox" checked={!!settings[k]} onChange={e=>{setSetting(k,e.target.checked);play("click");}}/>
      <span className="toggle-slider"/>
    </label>
  );
  const ACCENT_COLORS={cyan:"#00f5ff",purple:"#b44dff",green:"#39ff14",amber:"#fbbf24"};
  return(
    <Panel title="SETTINGS" subtitle="USER PREFERENCES · LOCAL ONLY" color="var(--purple)" onClose={onClose}>
      <div style={{maxWidth:500}}>
        {/* APPEARANCE */}
        <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:10}}>APPEARANCE</div>
        <div style={{background:"rgba(180,77,255,.04)",border:"1px solid rgba(180,77,255,.12)",borderRadius:8,marginBottom:16,overflow:"hidden"}}>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>Theme</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Light or dark interface</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {["dark","light"].map(t=>(
                <button key={t} onClick={()=>{setSetting("theme",t);play("click");}} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"4px 10px",borderRadius:4,cursor:"pointer",background:settings.theme===t?"rgba(180,77,255,.2)":"transparent",border:`1px solid ${settings.theme===t?"var(--purple)":"rgba(180,77,255,.2)"}`,color:settings.theme===t?"var(--purple)":"var(--dim)",transition:"all .2s"}}>
                  {t==="dark"?"🌑 DARK":"☀️ LIGHT"}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>Animated Card Icons</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Emoji animations on hub cards</div>
            </div>
            <Toggle k="animatedEmoji"/>
          </div>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>Reduced Motion</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Disable heavy animations</div>
            </div>
            <Toggle k="reducedMotion"/>
          </div>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>Compact Player Cards</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Smaller cards, more visible</div>
            </div>
            <Toggle k="compactCards"/>
          </div>
        </div>
        {/* INTERFACE */}
        <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:10}}>INTERFACE</div>
        <div style={{background:"rgba(0,245,255,.03)",border:"1px solid rgba(0,245,255,.1)",borderRadius:8,marginBottom:16,overflow:"hidden"}}>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>Notification Ticker</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Scrolling bar under topbar</div>
            </div>
            <Toggle k="tickerVisible"/>
          </div>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>Clock Format</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>12-hour or 24-hour clock</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {["24h","12h"].map(f=>(
                <button key={f} onClick={()=>{setSetting("clockFormat",f);play("click");}} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"4px 10px",borderRadius:4,cursor:"pointer",background:settings.clockFormat===f?"rgba(0,245,255,.15)":"transparent",border:`1px solid ${settings.clockFormat===f?"var(--cyan)":"rgba(0,245,255,.15)"}`,color:settings.clockFormat===f?"var(--cyan)":"var(--dim)",transition:"all .2s"}}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* AUDIO */}
        <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:2,marginBottom:10}}>AUDIO</div>
        <div style={{background:"rgba(57,255,20,.03)",border:"1px solid rgba(57,255,20,.1)",borderRadius:8,marginBottom:16,overflow:"hidden"}}>
          <div className="setting-row">
            <div>
              <div className="mono" style={{fontSize:11,color:"var(--text)"}}>UI Sounds</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Click sounds, notifications, alerts</div>
            </div>
            <Toggle k="sounds"/>
          </div>
        </div>
        <div className="mono" style={{fontSize:8,color:"rgba(0,245,255,.25)",textAlign:"center",marginTop:8,letterSpacing:1}}>⚙ Settings are stored locally on your device only</div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const ADMIN_CREDS = { username:"AdminOP", password:"Nether#2024" };

const SERVER_DEFAULT = {
  ip:"play.yourserver.net", port:"25565", version:"1.21.1",
  status:"offline", motd:"NexSci SMP Neural Command Server",
  lastChanged:null, changedBy:null, bridgeUrl:"",
  playerCount:0, maxPlayers:20, discordLink:"", dynmapLink:"",
  schedule:"Weekdays 6PM–11PM · Weekends All Day (UTC+5:30)",
};

const SC={ online:"#39ff14", afk:"#fbbf24", busy:"#b44dff", offline:"#555" };
const SL={ online:"ONLINE", afk:"AFK", busy:"BUSY", offline:"OFFLINE" };
const STATUS_OPTIONS = ["online","afk","busy","offline"];
const STATUS_EMOJI   = { online:"🟢", afk:"🟡", busy:"🟣", offline:"⚫" };

const WAR_DEF=[
  {id:1,title:"Battle of Spawn Plains",teams:["Alpha Squad","Night Raiders"],outcome:"Alpha Squad Victory",date:"S1·W3",notes:"First major conflict.",winner:0,season:1},
  {id:2,title:"The Nether War",teams:["Night Raiders","Lone Wolves"],outcome:"Ceasefire — Draw",date:"S1·W6",notes:"Ended on server crash.",winner:-1,season:1},
];
const RULES_DEFAULT=[
  {cat:"GAMEPLAY",icon:"⚙️",items:["No duplication glitches or exploits.","Respect builds and claimed land.","No killing in safe zones."]},
  {cat:"PVP PROTOCOL",icon:"⚔️",items:["PvP must be declared 24h in advance.","No end-crystal abuse outside war zones."]},
  {cat:"GRIEFING",icon:"🔥",items:["Zero tolerance for unconsented griefing.","Lava griefing = permanent ban."]},
  {cat:"ECONOMY",icon:"💎",items:["Diamond is base currency.","No market manipulation."]},
];
const SEASONS_DEFAULT=[
  {num:1,available:true,tagline:"The Beginning",achievements:["First mega-base built","Iron economy established"],events:["Spawn Wars","Peace Treaty Accord"],builds:["Crystal Palace","Nether Highway"]},
  {num:2,available:false},{num:3,available:false},
];
const DIAG_DEFAULT=[
  {icon:"📡",label:"Connection Issues",s:"ok",tip:"Ensure stable WiFi. Use the server IP from Server Status panel."},
  {icon:"🎮",label:"Version Mismatch",s:"warn",tip:"Server runs 1.21.1. Downgrade via launcher profile settings."},
  {icon:"🧩",label:"Mod Conflicts",s:"ok",tip:"Optifine: disable Smooth World if experiencing chunk issues."},
  {icon:"⚙️",label:"FPS / Lag",s:"ok",tip:"Set render distance ≤12. Disable shaders during events."},
  {icon:"💥",label:"Client Crashes",s:"error",tip:"Known crash with carpet mod v1.4.12. Update to v1.4.14."},
  {icon:"🔊",label:"Voice Chat",s:"ok",tip:"Simple Voice Chat mod required. See #voice-setup in Discord."},
  {icon:"🌐",label:"Server Not Showing",s:"ok",tip:"Click Direct Connect and type the IP manually."},
  {icon:"📦",label:"Missing Chunks",s:"warn",tip:"Disconnect and reconnect. If persistent, report in Discord."},
  {icon:"🔑",label:"Whitelist Rejected",s:"ok",tip:"You need a registered account to be whitelisted."},
  {icon:"💾",label:"World Lag / TPS Drop",s:"warn",tip:"Avoid entity farms > 200 mobs."},
  {icon:"🛡",label:"Anti-Cheat False Flags",s:"ok",tip:"Disable movement mods. Report in #anti-cheat-appeals."},
  {icon:"🖥",label:"Outdated Launcher",s:"ok",tip:"Update Minecraft Launcher to the latest version."},
  {icon:"🔄",label:"Resource Pack Errors",s:"ok",tip:"Decline the server resource pack and rejoin if loading fails."},
  {icon:"📍",label:"Spawn Protection",s:"ok",tip:"You cannot build within 32 blocks of spawn."},
  {icon:"🧠",label:"RAM / Memory Issues",s:"warn",tip:"Allocate at least 4GB of RAM in launcher settings."},
  {icon:"🌋",label:"Nether Portal Issues",s:"ok",tip:"Delete and rebuild the portal 1 block away if unlinking."},
  {icon:"🎒",label:"Inventory Rollback",s:"ok",tip:"Log out cleanly before server auto-stops to prevent rollback."},
  {icon:"⚡",label:"Lightning / Weather Lag",s:"ok",tip:"Weather is admin-controlled. Report excessive lag in Discord."},
  {icon:"🗺",label:"Map Not Loading",s:"ok",tip:"Dynmap requires the server to be online. Reload the page."},
  {icon:"📶",label:"High Ping / Timeout",s:"warn",tip:"Reduce chunk view distance. Avoid large redstone in peak hours."},
  {icon:"🔇",label:"Voice Chat Cutout",s:"ok",tip:"Reconnect your voice chat mod. Check mod version compatibility."},
  {icon:"🧱",label:"Build Not Loading",s:"ok",tip:"Move away and return. Chunk may not have rendered yet."},
  {icon:"🏹",label:"PvP Damage Issues",s:"ok",tip:"PvP is zone-restricted. Confirm you are in a PvP zone."},
  {icon:"💬",label:"Chat Not Sending",s:"ok",tip:"You may be muted or chat cooldown is active. Wait 5 seconds."},
  {icon:"🔒",label:"Cannot Open Chests",s:"ok",tip:"Chest may be locked by another player using /lock."},
  {icon:"🪣",label:"Items Disappearing",s:"ok",tip:"Items despawn after 5 min on ground. Use hoppers near farms."},
];

// ── v6.0: Cosmetics Database Default (15 per category) ───────────────────────
const COSMETICS_DEFAULT = {
  borders:[
    {id:"b1", name:"Cyan Grid",     icon:"🔷",rarity:"common",   css:"2px solid rgba(0,245,255,.7)"},
    {id:"b2", name:"Purple Haze",   icon:"🟣",rarity:"rare",     css:"2px solid rgba(180,77,255,.8)"},
    {id:"b3", name:"Amber Fire",    icon:"🟠",rarity:"epic",     css:"2px solid rgba(251,191,36,.8)"},
    {id:"b4", name:"Rainbow",       icon:"🌈",rarity:"legendary",css:"2px solid #f00"},
    {id:"b5", name:"Ghost",         icon:"👻",rarity:"uncommon", css:"1px dashed rgba(0,245,255,.4)"},
    {id:"b6", name:"Neon Green",    icon:"💚",rarity:"common",   css:"2px solid rgba(57,255,20,.7)"},
    {id:"b7", name:"Blood Red",     icon:"❤️",rarity:"uncommon", css:"2px solid rgba(255,68,68,.8)"},
    {id:"b8", name:"Ocean Deep",    icon:"🌊",rarity:"rare",     css:"2px solid rgba(59,130,246,.8)"},
    {id:"b9", name:"Void Dark",     icon:"🌑",rarity:"epic",     css:"2px solid rgba(60,0,120,.9)"},
    {id:"b10",name:"Star Dust",     icon:"⭐",rarity:"legendary",css:"2px solid rgba(255,215,0,.9)"},
    {id:"b11",name:"Matrix",        icon:"🖥",rarity:"rare",     css:"1px solid rgba(0,255,65,.6)"},
    {id:"b12",name:"Frost",         icon:"❄️",rarity:"uncommon", css:"2px solid rgba(136,238,255,.7)"},
    {id:"b13",name:"Solar Flare",   icon:"☀️",rarity:"epic",     css:"2px solid rgba(255,160,0,.9)"},
    {id:"b14",name:"Shadow",        icon:"🌒",rarity:"rare",     css:"2px dashed rgba(180,0,255,.5)"},
    {id:"b15",name:"Nexus Core",    icon:"🔮",rarity:"legendary",css:"2px solid rgba(0,245,255,1)"},
  ],
  nameEffects:[
    {id:"n1", name:"Glow Cyan",     icon:"✨",rarity:"common",   css:"text-shadow:0 0 8px #00f5ff"},
    {id:"n2", name:"Glow Purple",   icon:"💜",rarity:"rare",     css:"text-shadow:0 0 8px #b44dff"},
    {id:"n3", name:"Gold Shine",    icon:"⭐",rarity:"epic",     css:"color:#fbbf24;text-shadow:0 0 10px #fbbf24"},
    {id:"n4", name:"Rainbow Text",  icon:"🌈",rarity:"legendary",css:"color:#f00"},
    {id:"n5", name:"Ice Blue",      icon:"❄️",rarity:"uncommon", css:"color:#88eeff;text-shadow:0 0 4px #00c8d4"},
    {id:"n6", name:"Neon Green",    icon:"💚",rarity:"common",   css:"color:#39ff14;text-shadow:0 0 6px #39ff14"},
    {id:"n7", name:"Crimson",       icon:"🔴",rarity:"uncommon", css:"color:#ff4444;text-shadow:0 0 6px #ff4444"},
    {id:"n8", name:"Void Pulse",    icon:"🌀",rarity:"rare",     css:"color:#c084fc;text-shadow:0 0 12px #7c3aed"},
    {id:"n9", name:"Solar",         icon:"☀️",rarity:"epic",     css:"color:#ffa500;text-shadow:0 0 10px #ff8c00"},
    {id:"n10",name:"Matrix",        icon:"🖥",rarity:"rare",     css:"color:#00ff41;text-shadow:0 0 6px #00c030"},
    {id:"n11",name:"Plasma",        icon:"⚡",rarity:"epic",     css:"color:#e0e0ff;text-shadow:0 0 14px #9090ff,0 0 28px #6060ff"},
    {id:"n12",name:"Blood Moon",    icon:"🌕",rarity:"uncommon", css:"color:#ff6b6b;text-shadow:0 0 8px #cc0000"},
    {id:"n13",name:"Frost King",    icon:"👑",rarity:"legendary",css:"color:#b4f0ff;text-shadow:0 0 18px #00c8ff,0 0 36px #008fff"},
    {id:"n14",name:"Ember",         icon:"🔥",rarity:"rare",     css:"color:#ffaa44;text-shadow:0 0 8px #ff6600"},
    {id:"n15",name:"Nexus",         icon:"🔮",rarity:"legendary",css:"color:#00f5ff;text-shadow:0 0 20px #00f5ff,0 0 40px #0088ff"},
  ],
  titles:[
    {id:"t1", name:"BUILDER",       icon:"🏗",rarity:"common",   color:"#00f5ff"},
    {id:"t2", name:"WARRIOR",       icon:"⚔️",rarity:"uncommon", color:"#ff4444"},
    {id:"t3", name:"LEGEND",        icon:"👑",rarity:"epic",     color:"#fbbf24"},
    {id:"t4", name:"ADMIN",         icon:"🛠",rarity:"legendary",color:"#f97316"},
    {id:"t5", name:"EXPLORER",      icon:"🧭",rarity:"rare",     color:"#39ff14"},
    {id:"t6", name:"TRADER",        icon:"💎",rarity:"common",   color:"#39ff14"},
    {id:"t7", name:"ASSASSIN",      icon:"🗡",rarity:"rare",     color:"#ff4444"},
    {id:"t8", name:"SAGE",          icon:"📖",rarity:"uncommon", color:"#b44dff"},
    {id:"t9", name:"NOMAD",         icon:"🌍",rarity:"common",   color:"#00c8d4"},
    {id:"t10",name:"OVERLORD",      icon:"🏰",rarity:"legendary",color:"#f97316"},
    {id:"t11",name:"PHANTOM",       icon:"👻",rarity:"epic",     color:"#c084fc"},
    {id:"t12",name:"NETHER LORD",   icon:"🔥",rarity:"legendary",color:"#ff6600"},
    {id:"t13",name:"REDSTONER",     icon:"⚙️",rarity:"uncommon", color:"#ff4444"},
    {id:"t14",name:"ARCHITECT",     icon:"🏛",rarity:"rare",     color:"#fbbf24"},
    {id:"t15",name:"NEXUS CORE",    icon:"🔮",rarity:"legendary",color:"#00f5ff"},
  ],
  killStyles:[
    {id:"k1", name:"Classic",       icon:"💀",rarity:"common",   desc:"Simple skull on kill"},
    {id:"k2", name:"Electric",      icon:"⚡",rarity:"uncommon", desc:"Lightning flash"},
    {id:"k3", name:"Inferno",       icon:"🔥",rarity:"rare",     desc:"Fire trail"},
    {id:"k4", name:"Void",          icon:"🌀",rarity:"epic",     desc:"Dark spiral"},
    {id:"k5", name:"Cosmic",        icon:"🌌",rarity:"legendary",desc:"Galaxy explosion"},
    {id:"k6", name:"Glacial",       icon:"❄️",rarity:"uncommon", desc:"Freeze shatter"},
    {id:"k7", name:"Thunder God",   icon:"⛈️",rarity:"rare",     desc:"Storm strike"},
    {id:"k8", name:"Nether Gate",   icon:"🌑",rarity:"epic",     desc:"Portal implosion"},
    {id:"k9", name:"Phantom Slash", icon:"🗡",rarity:"rare",     desc:"Ghost blade mark"},
    {id:"k10",name:"Nova Burst",    icon:"💥",rarity:"legendary",desc:"Supernova detonation"},
    {id:"k11",name:"Venom",         icon:"🐍",rarity:"uncommon", desc:"Poison splatter"},
    {id:"k12",name:"Reaper",        icon:"☠️",rarity:"epic",     desc:"Death scythe sweep"},
    {id:"k13",name:"Sand Storm",    icon:"🌪",rarity:"rare",     desc:"Desert cyclone"},
    {id:"k14",name:"Dragon Fire",   icon:"🐉",rarity:"legendary",desc:"Dragon breath eruption"},
    {id:"k15",name:"Glitch",        icon:"👾",rarity:"epic",     desc:"Digital corruption"},
  ],
};

// ── Phase 3: Server Config Default (JAR control, Oracle-ready) ───────────────
const SERVER_CONFIG_DEFAULT = {
  jarType:    "paper",   // "paper" | "spigot" | "vanilla" | "fabric" | "forge" | "purpur"
  jarVersion: "1.21.1",
  customFlags: "-Xms2G -Xmx4G",  // JVM flags — Oracle may need tuning
  port:       "25565",
  rconPort:   "25575",           // RCON — future Oracle bridge hook
  rconEnabled: false,
  oracleMode:  false,            // future: true = route through Oracle daemon
  lastStarted: null,
  lastStopped: null,
  serverState: "stopped",        // "stopped" | "starting" | "running" | "stopping"
};

// ── Phase 3: Mock session data (used as placeholder until Oracle feeds it) ────
const MOCK_SESSIONS = [
  { username:"Senku",    status:"online",  joinedAt:new Date(Date.now()-12*60000).toISOString(), source:"mock" },
  { username:"AdminOP",  status:"online",  joinedAt:new Date(Date.now()-45*60000).toISOString(), source:"mock" },
  { username:"NightWolf",status:"offline", joinedAt:new Date(Date.now()-3*3600000).toISOString(), source:"mock" },
];

// ── Phase 3: Mock combat events (placeholder until Oracle plugin feeds it) ────
const MOCK_COMBAT = [
  { id:1, type:"kill",  actor:"Senku",    target:"Creeper",   weapon:"Diamond Sword", ts:new Date(Date.now()-2*60000).toISOString(),  source:"mock" },
  { id:2, type:"death", actor:"NightWolf",target:"Zombie",    weapon:null,             ts:new Date(Date.now()-8*60000).toISOString(),  source:"mock" },
  { id:3, type:"pvp",   actor:"AdminOP",  target:"Senku",     weapon:"Bow",            ts:new Date(Date.now()-22*60000).toISOString(), source:"mock" },
  { id:4, type:"kill",  actor:"Senku",    target:"Skeleton",  weapon:"Trident",        ts:new Date(Date.now()-35*60000).toISOString(), source:"mock" },
  { id:5, type:"death", actor:"NightWolf",target:"Lava",      weapon:null,             ts:new Date(Date.now()-60*60000).toISOString(), source:"mock" },
];

// ── v7.0: Feature Flags Default ──────────────────────────────────────────────
const FEATURE_FLAGS_DEFAULT = {
  chat:true, seasonPass:true, cosmetics:true, gallery:true,
  suggestions:true, potw:true, alliances:true, bulletin:true,
  banLog:true, modReview:true, trades:true, polls:true,
  leaderboard:true, achievements:true, events:true,
};

// ── v7.0: Global ping history store (in-memory, per session) ─────────────────
const _pingHistory = [];
function recordPing(ok){
  _pingHistory.push({ts:Date.now(),ok});
  if(_pingHistory.length>30)_pingHistory.shift();
}
// FB op counter (in-memory)
const _fbOps = {reads:0,writes:0};
function _fbGetTracked(id,fb=null){_fbOps.reads++;return _fbGet(id,fb);}
function _fbSetTracked(id,v){_fbOps.writes++;return _fbSet(id,v);}
// Active users tracker (session-scoped)
const _sessionStart = Date.now();
// ── Phase 3: Oracle-compatible ping — dual API fallback, configurable timeout ──
// Primary: mcsrvstat.us  |  Fallback: api.mcstatus.io  |  Oracle may block ports
async function pingMinecraft(ip, port = "25565", timeoutMs = 8000) {
  // Oracle environments may have strict egress rules — we try two public APIs
  const PRIMARY = `https://api.mcsrvstat.us/3/${ip}:${port}`;
  const FALLBACK = `https://api.mcstatus.io/v2/status/java/${ip}:${port}`;

  const tryFetch = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error("non-ok");
    return res.json();
  };

  const parsePrimary = (d) => ({
    reachable: true,
    online:     d.online === true,
    players:    d.players?.online ?? 0,
    maxPlayers: d.players?.max    ?? 20,
    motd:       (d.motd?.clean?.[0] || "").trim(),
    version:    d.version || "",
    _api: "mcsrvstat",
  });

  const parseFallback = (d) => ({
    reachable: true,
    online:     d.online === true,
    players:    d.players?.online ?? 0,
    maxPlayers: d.players?.max    ?? 20,
    motd:       (d.motd?.raw?.[0]   || "").trim(),
    version:    d.version?.name_clean || d.version?.name || "",
    _api: "mcstatus",
  });

  try {
    const d = await tryFetch(PRIMARY);
    return parsePrimary(d);
  } catch {
    try {
      const d = await tryFetch(FALLBACK);
      return parseFallback(d);
    } catch {
      return { reachable: false, online: false, players: 0, maxPlayers: 20, motd: "", version: "", _api: "none" };
    }
  }
}

function requestBrowserNotifPerm(){if("Notification"in window&&Notification.permission==="default")Notification.requestPermission();}
function fireBrowserNotif(title,body){try{if("Notification"in window&&Notification.permission==="granted")new Notification(title,{body});}catch{}}

// ═══════════════════════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════════════════════
const ToastCtx=createContext(null);
function ToastProvider({children}){
  const[toasts,setToasts]=useState([]);
  const push=useCallback((msg,color="#00f5ff",icon="ℹ")=>{
    const id=Date.now()+Math.random();
    setToasts(t=>[...t,{id,msg,color,icon,out:false}]);
    setTimeout(()=>setToasts(t=>t.map(x=>x.id===id?{...x,out:true}:x)),3200);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),3700);
  },[]);
  return(
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t=>(
          <div key={t.id} className={`toast${t.out?" out":""}`} style={{border:`1px solid ${t.color}44`,borderLeft:`3px solid ${t.color}`}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:16}}>{t.icon}</span>
              <span className="mono" style={{fontSize:12,color:"var(--text)",lineHeight:1.5}}>{t.msg}</span>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast=()=>useContext(ToastCtx);

// ═══════════════════════════════════════════════════════════════════════════════
//  BRIDGE STATUS HOOK
//  Polls smp/bridgestatus in Firestore every 8s.
//  The Oracle Node.js daemon writes this document every 10s while running.
//  If last heartbeat >30s old → bridge considered disconnected.
//
//  bridgestatus doc shape (written by daemon):
//  { alive:true, ts:"<ISO>", version:"1.0.0",
//    serverState:"running"|"stopped"|"starting"|"stopping",
//    playerCount:3, maxPlayers:20, tps:19.8,
//    ip:"x.x.x.x", port:"25565", jarType:"paper", jarVersion:"1.21.1" }
// ═══════════════════════════════════════════════════════════════════════════════
function useBridgeStatus() {
  const [bridge, setBridge] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const check = async () => {
      const doc = await DB.getBridgeStatus();
      if (!doc || !doc.ts) { setBridge(false); setLoading(false); return; }
      setBridge(Date.now() - new Date(doc.ts).getTime() < 30000 ? doc : false);
      setLoading(false);
    };
    check();
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
  }, []);
  return { bridge, isLive: !!bridge, loading };
}

function BridgeBadge({ bridge, isLive, loading, inline=false }) {
  const base = { display:"flex", alignItems:"center", gap:8 };
  if (loading) return (
    <span className="mono" style={{ fontSize:8, color:"var(--dim)", padding:"3px 8px", border:"1px solid rgba(0,245,255,.1)", borderRadius:3 }}>
      CHECKING BRIDGE...
    </span>
  );
  if (!isLive) return (
    <div style={{ ...base, padding:inline?"4px 10px":"10px 14px",
      background:"rgba(255,68,68,.06)", border:"1px solid rgba(255,68,68,.22)",
      borderRadius:inline?4:7, ...(inline?{}:{marginBottom:14}) }}>
      <div style={{ width:7, height:7, borderRadius:"50%", background:"var(--red)", flexShrink:0 }} />
      <div>
        <span className="orb" style={{ fontSize:8, color:"var(--red)", letterSpacing:2 }}>BRIDGE OFFLINE</span>
        {!inline && <div className="mono" style={{ fontSize:9, color:"var(--dim)", marginTop:3 }}>
          Oracle daemon is not running. Start the NexSci bridge on your Oracle VPS. Admin → Server → Edit to set your Bridge URL.
        </div>}
      </div>
    </div>
  );
  return (
    <div style={{ ...base, padding:inline?"4px 10px":"10px 14px",
      background:"rgba(57,255,20,.05)", border:"1px solid rgba(57,255,20,.2)",
      borderRadius:inline?4:7, ...(inline?{}:{marginBottom:14}) }}>
      <div style={{ position:"relative", width:7, height:7, flexShrink:0 }}>
        <div style={{ position:"absolute", inset:0, borderRadius:"50%", background:"var(--green)" }}/>
        <div className="ping-ring" style={{ borderColor:"var(--green)" }}/>
      </div>
      <div>
        <span className="orb" style={{ fontSize:8, color:"var(--green)", letterSpacing:2 }}>
          BRIDGE LIVE{bridge.version ? ` · v${bridge.version}` : ""}
        </span>
        {!inline && bridge.ts && <div className="mono" style={{ fontSize:8, color:"rgba(57,255,20,.5)", marginTop:2 }}>
          Last heartbeat {Math.round((Date.now()-new Date(bridge.ts).getTime())/1000)}s ago{bridge.tps ? ` · ${bridge.tps} TPS` : ""}
        </div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AVATAR — reads custom pfp from DB, falls back to mc-heads
// ═══════════════════════════════════════════════════════════════════════════════
function MCAvatar({username,size=40,style:sx={},pfpOverride=null}){
  const[customPfp,setCustomPfp]=useState(pfpOverride);
  const[mcErr,setMcErr]=useState(false);

  useEffect(()=>{
    if(pfpOverride){setCustomPfp(pfpOverride);return;}
    if(!username)return;
    DB.getUserPfp(username).then(p=>{if(p)setCustomPfp(p);});
  },[username,pfpOverride]);

  const fallback=(
    <div style={{width:size,height:size,borderRadius:6,background:"linear-gradient(135deg,rgba(0,245,255,.15),rgba(180,77,255,.1))",border:"1px solid rgba(0,245,255,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.45,fontWeight:700,color:"rgba(0,245,255,.8)",...sx}}>
      {username?username[0].toUpperCase():"?"}
    </div>
  );

  if(customPfp){
    return(
      <img src={customPfp} alt={username} width={size} height={size}
        style={{width:size,height:size,borderRadius:6,objectFit:"cover",border:"1px solid rgba(0,245,255,.2)",...sx}}
        onError={()=>setCustomPfp(null)}/>
    );
  }
  if(!username)return fallback;
  if(mcErr)return fallback;
  return(
    <img className="mc-avatar" src={`https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`}
      alt={username} width={size} height={size}
      style={{width:size,height:size,borderRadius:6,imageRendering:"pixelated",border:"1px solid rgba(0,245,255,.2)",...sx}}
      onError={()=>setMcErr(true)}/>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NOTIF BELL
// ═══════════════════════════════════════════════════════════════════════════════
function NotifBell(){
  const[open,setOpen]=useState(false);
  const[notifs,setNotifs]=useState([]);
  const[unread,setUnread]=useState(0);
  const[ringing,setRinging]=useState(false);
  const prevCount=useRef(0);
  const play=useSound();
  useEffect(()=>{
    const load=async()=>{
      const ns=await DB.getNotifs();
      const newUnread=ns.filter(n=>!n.read).length;
      if(ns.length>prevCount.current&&prevCount.current>0){setRinging(true);setTimeout(()=>setRinging(false),700);play("notif");}
      prevCount.current=ns.length;
      setNotifs(ns);
      setUnread(newUnread);
    };
    load();const t=setInterval(load,8000);return()=>clearInterval(t);
  },[]);
  const markRead=useCallback(async()=>{
    const ns=notifs.map(n=>({...n,read:true}));
    setNotifs(ns);setUnread(0);
    await _fbSet("notifs",ns);
  },[notifs]);
  const NC={server:"#39ff14",war:"#ff4444",survey:"#3b82f6",admin:"#f97316",system:"#00f5ff",access:"#b44dff",leaderboard:"#fbbf24"};
  return(
    <div style={{position:"relative"}}>
      <button className={`bell-btn${ringing?" bell-ringing":""}`} onClick={()=>{const opening=!open;setOpen(opening);play("click");if(opening&&unread>0)markRead();}}>
        🔔{unread>0&&<div className="bell-badge">{unread>9?"9+":unread}</div>}
      </button>
      {open&&(
        <div className="notif-panel">
          <div style={{padding:"12px 14px",borderBottom:"1px solid rgba(0,245,255,.1)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span className="orb" style={{fontSize:9,color:"var(--cyan)",letterSpacing:2}}>NOTIFICATIONS</span>
            <button onClick={()=>setOpen(false)} style={{background:"none",border:"none",color:"var(--dim)",cursor:"pointer",fontSize:14}}>✕</button>
          </div>
          <div style={{maxHeight:320,overflowY:"auto"}}>
            {notifs.length===0
              ?<div className="mono" style={{textAlign:"center",padding:"28px 0",fontSize:11,color:"var(--dim)"}}>No notifications yet</div>
              :notifs.map(n=>(
                <div className="notif-item" key={n.id} style={{opacity:n.read?0.6:1}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <div style={{width:3,alignSelf:"stretch",background:NC[n.type]||"var(--cyan)",borderRadius:2,flexShrink:0}}/>
                    <div>
                      <div className="orb" style={{fontSize:9,color:NC[n.type]||"var(--cyan)",letterSpacing:1,marginBottom:2}}>{n.title}</div>
                      <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.5}}>{n.body}</div>
                      <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:3}}>{n.ts?new Date(n.ts).toLocaleString():""}</div>
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STARFIELD
// ═══════════════════════════════════════════════════════════════════════════════
function Starfield(){
  const stars=useRef(Array.from({length:200},()=>({x:Math.random()*100,y:Math.random()*200,s:Math.random()*2.2+.3,o:Math.random()*.8+.1}))).current;
  const pts=useRef(Array.from({length:12},(_,i)=>({x:Math.random()*100,y:Math.random()*100,sz:Math.random()*2.5+1,c:i%3===0?"#00f5ff":i%3===1?"#b44dff":"#3b82f6",d:Math.random()*6,dur:4+Math.random()*5}))).current;
  return(
    <div style={{position:"fixed",inset:0,overflow:"hidden",zIndex:0,pointerEvents:"none"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`linear-gradient(rgba(0,245,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,245,255,.04) 1px,transparent 1px)`,backgroundSize:"60px 60px",animation:"gridPulse 5s ease-in-out infinite"}}/>
      <div className="stars-wrap" style={{position:"absolute",width:"100%",height:"200%"}}>
        {stars.map((s,i)=><div key={i} style={{position:"absolute",left:`${s.x}%`,top:`${s.y}%`,width:s.s,height:s.s,borderRadius:"50%",background:"#fff",opacity:s.o}}/>)}
      </div>
      <div style={{position:"absolute",top:"-20%",left:"-10%",width:"50vw",height:"50vw",borderRadius:"50%",background:"radial-gradient(circle,rgba(0,245,255,.04) 0%,transparent 70%)"}}/>
      <div style={{position:"absolute",bottom:"-10%",right:"-5%",width:"40vw",height:"40vw",borderRadius:"50%",background:"radial-gradient(circle,rgba(180,77,255,.05) 0%,transparent 70%)"}}/>
      {pts.map((p,i)=><div key={i} style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,width:p.sz,height:p.sz,borderRadius:"50%",background:p.c,boxShadow:`0 0 8px ${p.c}`,animation:`particleFloat ${p.dur}s ease-in-out ${p.d}s infinite`}}/>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MUSIC PLAYER — YouTube + direct URL, draggable
// ═══════════════════════════════════════════════════════════════════════════════
function getYtId(url){
  try{
    const u=new URL(url);
    if(u.hostname.includes("youtu.be"))return u.pathname.slice(1);
    return u.searchParams.get("v")||null;
  }catch{return null;}
}

function MusicPlayer({onClose}){
  const[tracks,setTracks]=useState([]);
  const[idx,setIdx]=useState(0);
  const[isPlaying,setIsPlaying]=useState(false);
  const[currentTime,setCurrentTime]=useState(0);
  const[duration,setDuration]=useState(0);
  const[volume,setVolume]=useState(0.7);
  const[pos,setPos]=useState({x:Math.max(0,window.innerWidth-360),y:70});
  const[dragging,setDragging]=useState(false);
  const[showList,setShowList]=useState(false);
  const dragOffset=useRef({x:0,y:0});
  const audioRef=useRef(null);

  useEffect(()=>{DB.getMusicList().then(t=>{setTracks(t);});},[]);

  const current=tracks[idx];
  const ytId=current?getYtId(current.url):null;
  const isYt=!!ytId;

  // Direct audio controls
  useEffect(()=>{
    if(!audioRef.current||!current?.url||isYt)return;
    audioRef.current.src=current.url;
    audioRef.current.volume=volume;
    if(isPlaying)audioRef.current.play().catch(()=>{});
  },[idx,current?.url,isYt]);

  useEffect(()=>{if(audioRef.current&&!isYt)audioRef.current.volume=volume;},[volume,isYt]);

  const togglePlay=()=>{
    if(isYt){setIsPlaying(p=>!p);return;}
    if(!audioRef.current||!current?.url)return;
    if(isPlaying){audioRef.current.pause();setIsPlaying(false);}
    else{audioRef.current.play().catch(()=>{});setIsPlaying(true);}
  };
  const seek=v=>{if(audioRef.current&&!isYt)audioRef.current.currentTime=parseFloat(v);};
  const prev=()=>setIdx(i=>(i-1+tracks.length)%tracks.length);
  const next=()=>setIdx(i=>(i+1)%tracks.length);

  const startDrag=e=>{setDragging(true);dragOffset.current={x:e.clientX-pos.x,y:e.clientY-pos.y};};
  useEffect(()=>{
    if(!dragging)return;
    const move=e=>setPos({x:Math.max(0,Math.min(window.innerWidth-310,e.clientX-dragOffset.current.x)),y:Math.max(0,Math.min(window.innerHeight-200,e.clientY-dragOffset.current.y))});
    const up=()=>setDragging(false);
    window.addEventListener("mousemove",move);window.addEventListener("mouseup",up);
    return()=>{window.removeEventListener("mousemove",move);window.removeEventListener("mouseup",up);};
  },[dragging]);

  const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;

  const ytSrc=ytId?`https://www.youtube-nocookie.com/embed/${ytId}?controls=1&modestbranding=1&rel=0`:"";

  return(
    <div className="music-player" style={{left:pos.x,top:pos.y,width:320}}>
      {!isYt&&<audio ref={audioRef} onTimeUpdate={e=>setCurrentTime(e.target.currentTime)} onDurationChange={e=>setDuration(e.target.duration||0)} onEnded={next} onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)}/>}

      {/* HEADER */}
      <div className="music-player-header" onMouseDown={startDrag}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"flex-end",gap:2,height:16}}>
            {[0.5,1,0.7,1.3,0.6].map((h,i)=>(
              <div key={i} className="music-bar" style={{height:`${h*16}px`,animationDelay:`${i*0.11}s`,opacity:isPlaying?1:0.2}}/>
            ))}
          </div>
          <span className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2}}>NEXSCI MUSIC</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button onClick={()=>setShowList(s=>!s)} style={{background:"none",border:"1px solid rgba(180,77,255,.3)",borderRadius:4,color:"var(--purple)",cursor:"pointer",padding:"2px 7px",fontSize:10}}>☰</button>
          <button onClick={onClose} style={{background:"rgba(255,50,50,.1)",border:"1px solid rgba(255,50,50,.3)",borderRadius:4,color:"#ff5555",cursor:"pointer",padding:"2px 7px",fontSize:11}}>✕</button>
        </div>
      </div>

      {/* BODY */}
      <div style={{padding:"12px 16px"}}>
        {tracks.length===0?(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:28,marginBottom:8}}>🎵</div>
            <div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.7}}>No tracks yet.<br/>Admin adds music via Admin Panel → Music.</div>
          </div>
        ):(
          <>
            {/* NOW PLAYING */}
            <div style={{marginBottom:10,padding:"8px 12px",background:"rgba(180,77,255,.07)",border:"1px solid rgba(180,77,255,.2)",borderRadius:8}}>
              <div className="orb" style={{fontSize:7,color:"rgba(180,77,255,.5)",letterSpacing:2,marginBottom:3}}>NOW PLAYING {isYt&&"· YOUTUBE"}</div>
              <div className="mono" style={{fontSize:11,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{current?.title||"—"}</div>
              <div className="mono" style={{fontSize:9,color:"var(--purple)",marginTop:1}}>{current?.artist||"—"}</div>
            </div>

            {/* YOUTUBE EMBED */}
            {isYt?(
              <div style={{marginBottom:10,borderRadius:8,overflow:"hidden",border:"1px solid rgba(180,77,255,.2)"}}>
                <iframe className="yt-frame" src={ytSrc} height="158" allow="encrypted-media" allowFullScreen title="yt"/>
              </div>
            ):(
              <>
                {/* DIRECT AUDIO PROGRESS */}
                <div style={{marginBottom:8}}>
                  <input type="range" className="music-progress" min={0} max={duration||1} value={currentTime} onChange={e=>seek(e.target.value)}
                    style={{background:`linear-gradient(to right,rgba(180,77,255,.8) ${(currentTime/(duration||1))*100}%,rgba(180,77,255,.2) 0%)`}}/>
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}>
                    <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>{fmt(currentTime)}</span>
                    <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>{fmt(duration)}</span>
                  </div>
                </div>
              </>
            )}

            {/* CONTROLS */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:10}}>
              <button className="music-btn" onClick={prev} style={{width:32,height:32,fontSize:13}}>⏮</button>
              {!isYt&&(
                <button className="music-btn" onClick={togglePlay} style={{width:42,height:42,fontSize:18,borderColor:"rgba(180,77,255,.5)",background:"rgba(180,77,255,.1)"}}>
                  {isPlaying?"⏸":"▶"}
                </button>
              )}
              <button className="music-btn" onClick={next} style={{width:32,height:32,fontSize:13}}>⏭</button>
              {!isYt&&(
                <div style={{display:"flex",alignItems:"center",gap:5,marginLeft:6}}>
                  <span style={{fontSize:10}}>🔈</span>
                  <input type="range" className="music-vol" min={0} max={1} step={0.01} value={volume} onChange={e=>setVolume(parseFloat(e.target.value))}/>
                </div>
              )}
            </div>

            {/* TRACK LIST */}
            {showList&&(
              <div style={{maxHeight:130,overflowY:"auto",borderTop:"1px solid rgba(180,77,255,.15)",paddingTop:8}}>
                <div className="orb" style={{fontSize:7,color:"var(--dim)",letterSpacing:2,marginBottom:5}}>PLAYLIST · {tracks.length}</div>
                {tracks.map((t,i)=>(
                  <div key={t.id||i} onClick={()=>{setIdx(i);setIsPlaying(true);if(audioRef.current&&!getYtId(t.url)){audioRef.current.src=t.url;audioRef.current.play().catch(()=>{});}}}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"5px 7px",borderRadius:5,cursor:"pointer",background:idx===i?"rgba(180,77,255,.12)":"transparent",border:idx===i?"1px solid rgba(180,77,255,.25)":"1px solid transparent",marginBottom:2,transition:"all .2s"}}>
                    <span style={{fontSize:9,color:idx===i?"var(--purple)":"var(--dim)",minWidth:14}}>{idx===i&&isPlaying?"▶":i+1}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="mono" style={{fontSize:10,color:idx===i?"var(--text)":"var(--dim)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <div className="mono" style={{fontSize:8,color:"rgba(180,77,255,.5)"}}>{t.artist||"—"}</div>
                        {getYtId(t.url)&&<span style={{fontSize:7,color:"#ff4444",fontFamily:"Orbitron",letterSpacing:1}}>YT</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TOPBAR
// ═══════════════════════════════════════════════════════════════════════════════
function TopBar({user,serverStatus,onLogout,onSetStatus,onOpenLogin,onOpenAccount,musicOpen,setMusicOpen}){
  const[time,setTime]=useState(new Date());
  const[menuOpen,setMenuOpen]=useState(false);
  const menuRef=useRef(null);
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  // Close menu on outside tap
  useEffect(()=>{
    if(!menuOpen)return;
    const handler=e=>{if(menuRef.current&&!menuRef.current.contains(e.target))setMenuOpen(false);};
    document.addEventListener("mousedown",handler);document.addEventListener("touchstart",handler);
    return()=>{document.removeEventListener("mousedown",handler);document.removeEventListener("touchstart",handler);};
  },[menuOpen]);
  return(
    <div ref={menuRef} style={{position:"fixed",top:0,left:0,right:0,zIndex:200}}>
      {/* ── MAIN BAR ── */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 16px",background:"rgba(1,8,18,.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(0,245,255,.1)",gap:8}}>
        {/* LEFT: logo + status */}
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <span className="orb" style={{fontSize:9,color:"var(--cyan)",letterSpacing:3}}>NEXSCI SMP</span>
          <span className="topbar-center" style={{color:"rgba(0,245,255,.2)"}}>│</span>
          <span className="topbar-center mono" style={{fontSize:9,color:"var(--dim)"}}>NEURAL COMMAND v10.0</span>
          <span className="topbar-center" style={{color:"rgba(0,245,255,.2)"}}>│</span>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{position:"relative",width:8,height:8}}>
              <div style={{position:"absolute",inset:0,borderRadius:"50%",background:serverStatus==="online"?"var(--green)":"var(--red)",zIndex:1}}/>
              {serverStatus==="online"&&<div className="ping-ring"/>}
            </div>
            <span className="mono" style={{fontSize:9,color:serverStatus==="online"?"var(--green)":"var(--red)",letterSpacing:1}}>{serverStatus==="online"?"ONLINE":"OFFLINE"}</span>
          </div>
        </div>
        {/* RIGHT: all controls flush to right */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:"auto"}}>
          <div className="topbar-desktop-btns" style={{display:"flex",alignItems:"center",gap:8}}>
            {user?(
              <button onClick={onOpenAccount} className="topbar-login-btn" style={{display:"flex",alignItems:"center",gap:5}}>
                <MCAvatar username={user.username} size={18} style={{borderRadius:4,border:"none"}}/>
                <span style={{color:user.isAdmin?"var(--orange)":"var(--cyan)"}}>{user.username}{user.isAdmin?" ★":""}</span>
              </button>
            ):(
              <button onClick={onOpenLogin} className="topbar-login-btn">⟩ LOGIN / SIGN IN</button>
            )}
            <button className="topbar-music-btn" onClick={()=>setMusicOpen(o=>!o)} title="Music Player" style={{borderColor:musicOpen?"var(--purple)":"rgba(180,77,255,.25)"}}>🎵</button>
            {user&&(
              <>
                <button onClick={onSetStatus} style={{background:"transparent",border:"1px solid rgba(0,245,255,.2)",borderRadius:5,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,transition:"all .2s"}}
                  onMouseOver={e=>e.currentTarget.style.borderColor="var(--cyan)"} onMouseOut={e=>e.currentTarget.style.borderColor="rgba(0,245,255,.2)"}>
                  <span style={{fontSize:11}}>📊</span>
                  <span className="mono" style={{fontSize:9,color:"var(--cyan)",letterSpacing:1}}>STATUS</span>
                </button>
                <button onClick={onLogout} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:2,padding:"4px 9px",background:"transparent",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:3,cursor:"pointer"}}>OUT</button>
              </>
            )}
            <NotifBell/>
            <span className="mono topbar-center" style={{fontSize:10,color:"rgba(0,245,255,.3)"}}>{time.toLocaleTimeString([],{hour12:false})}</span>
          </div>
          {/* HAMBURGER — mobile only */}
          <button className="topbar-hamburger" onClick={()=>setMenuOpen(o=>!o)}
            style={{background:"transparent",border:"1px solid rgba(0,245,255,.25)",borderRadius:6,width:34,height:34,cursor:"pointer",display:"none",alignItems:"center",justifyContent:"center",fontSize:16,color:"var(--cyan)",flexShrink:0}}>
            {menuOpen?"✕":"☰"}
          </button>
        </div>
      </div>
      {/* ── MOBILE DROPDOWN MENU ── */}
      {menuOpen&&(
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"rgba(1,8,22,.97)",backdropFilter:"blur(16px)",borderBottom:"1px solid rgba(0,245,255,.15)",padding:"12px 16px",display:"flex",flexDirection:"column",gap:10,animation:"fadeDown .2s ease",zIndex:199}}>
          {/* Account row */}
          <div style={{display:"flex",alignItems:"center",gap:10,paddingBottom:10,borderBottom:"1px solid rgba(0,245,255,.08)"}}>
            {user?(
              <button onClick={()=>{onOpenAccount();setMenuOpen(false);}} className="topbar-login-btn" style={{display:"flex",alignItems:"center",gap:8,width:"100%",justifyContent:"flex-start",padding:"8px 12px"}}>
                <MCAvatar username={user.username} size={24} style={{borderRadius:5,border:"none"}}/>
                <div style={{textAlign:"left"}}>
                  <div style={{color:user.isAdmin?"var(--orange)":"var(--cyan)",fontSize:10}}>{user.username}{user.isAdmin?" ★":""}</div>
                  <div style={{color:"var(--dim)",fontSize:8,marginTop:1}}>Tap to manage account</div>
                </div>
              </button>
            ):(
              <button onClick={()=>{onOpenLogin();setMenuOpen(false);}} className="topbar-login-btn" style={{width:"100%",padding:"8px 12px",fontSize:10}}>⟩ LOGIN / SIGN IN</button>
            )}
          </div>
          {/* Action buttons */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>{setMusicOpen(o=>!o);setMenuOpen(false);}} className="topbar-music-btn" style={{borderColor:musicOpen?"var(--purple)":"rgba(180,77,255,.25)",width:"auto",padding:"0 14px",gap:6,display:"flex",alignItems:"center"}}>
              <span>🎵</span><span style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1}}>MUSIC</span>
            </button>
            {user&&(
              <>
                <button onClick={()=>{onSetStatus();setMenuOpen(false);}} style={{background:"transparent",border:"1px solid rgba(0,245,255,.2)",borderRadius:6,padding:"6px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:11}}>📊</span>
                  <span className="mono" style={{fontSize:9,color:"var(--cyan)",letterSpacing:1}}>STATUS</span>
                </button>
                <button onClick={()=>{onLogout();setMenuOpen(false);}} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:2,padding:"6px 14px",background:"transparent",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:6,cursor:"pointer"}}>SIGN OUT</button>
              </>
            )}
          </div>
          {/* Clock + server status */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:8,borderTop:"1px solid rgba(0,245,255,.08)"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:serverStatus==="online"?"var(--green)":"var(--red)"}}/>
              <span className="mono" style={{fontSize:9,color:serverStatus==="online"?"var(--green)":"var(--red)"}}>{serverStatus==="online"?"SERVER ONLINE":"SERVER OFFLINE"}</span>
            </div>
            <span className="mono" style={{fontSize:10,color:"rgba(0,245,255,.4)"}}>{time.toLocaleTimeString([],{hour12:false})}</span>
          </div>
          <NotifBell/>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════
function useDraggable(initialPos){
  const[pos,setPos]=useState(initialPos);
  const[dragging,setDragging]=useState(false);
  const dragOffset=useRef({x:0,y:0});
  const startDrag=useCallback(e=>{
    if(e.button!==0)return;
    setDragging(true);
    dragOffset.current={x:e.clientX-pos.x,y:e.clientY-pos.y};
  },[pos]);
  useEffect(()=>{
    if(!dragging)return;
    const move=e=>setPos({
      x:Math.max(0,Math.min(window.innerWidth-100,e.clientX-dragOffset.current.x)),
      y:Math.max(0,Math.min(window.innerHeight-60,e.clientY-dragOffset.current.y))
    });
    const up=()=>setDragging(false);
    window.addEventListener("mousemove",move);
    window.addEventListener("mouseup",up);
    return()=>{window.removeEventListener("mousemove",move);window.removeEventListener("mouseup",up);};
  },[dragging]);
  return{pos,dragging,startDrag};
}

function Panel({title,subtitle,color="#00f5ff",children,onClose,wide}){
  useEffect(()=>{const h=e=>e.key==="Escape"&&onClose();window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[onClose]);
  const initX=wide?Math.max(0,(window.innerWidth-1080)/2):Math.max(0,(window.innerWidth-880)/2);
  const initY=Math.max(0,(window.innerHeight-600)/2);
  const{pos,dragging,startDrag}=useDraggable({x:initX,y:initY});
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,5,15,.75)",backdropFilter:"blur(6px)",zIndex:100,animation:"backdropIn .28s ease"}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`glass pmodal${wide?" pmodal-wide":""}`}
        style={{
          padding:0,position:"absolute",left:pos.x,top:pos.y,
          boxShadow:`0 0 0 1px ${color}22, 0 24px 80px rgba(0,0,0,.7), 0 0 40px ${color}08`,
          border:`1px solid ${color}22`,
          userSelect:dragging?"none":"auto",
          cursor:dragging?"grabbing":"auto",
          maxHeight:"90vh",display:"flex",flexDirection:"column",
        }}>
        {/* DRAG HEADER */}
        <div onMouseDown={startDrag} style={{
          padding:"14px 18px 12px",
          borderBottom:`1px solid ${color}18`,
          cursor:dragging?"grabbing":"grab",
          background:`linear-gradient(135deg, rgba(0,8,20,.9) 0%, rgba(0,12,28,.8) 100%)`,
          borderRadius:"12px 12px 0 0",
          flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"space-between",
          gap:10,
        }}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:subtitle?3:0}}>
              <div style={{width:3,height:18,background:color,boxShadow:`0 0 10px ${color}`,borderRadius:2,flexShrink:0}}/>
              <span className="orb" style={{fontSize:11,color,letterSpacing:3}}>{title}</span>
              <div style={{display:"flex",gap:3,marginLeft:"auto",opacity:.25}}>
                {[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:"50%",background:color}}/>)}
              </div>
            </div>
            {subtitle&&<div className="mono" style={{fontSize:9,color:"var(--dim)",letterSpacing:2,marginLeft:13,opacity:.7}}>{subtitle}</div>}
          </div>
          <button className="close-btn" onClick={onClose} style={{position:"static",flexShrink:0}}>✕</button>
        </div>
        {/* CONTENT */}
        <div style={{padding:"18px 24px 24px",overflowY:"auto",flex:1}}>
          <div style={{height:1,background:`linear-gradient(to right,${color},${color}44,transparent)`,marginBottom:18}}/>
          {children}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INTRO
// ═══════════════════════════════════════════════════════════════════════════════
function IntroScreen({onEnter}){
  const[step,setStep]=useState(0);
  useEffect(()=>{const ts=[setTimeout(()=>setStep(1),300),setTimeout(()=>setStep(2),900),setTimeout(()=>setStep(3),1600)];return()=>ts.forEach(clearTimeout);},[]);
  return(
    <div style={{position:"fixed",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
      <div style={{position:"absolute",width:480,height:480,pointerEvents:"none"}}>
        {[{i:0,c:"0,245,255",a:"ringR",d:20},{i:30,c:"180,77,255",a:"ringL",d:15,dash:true},{i:80,c:"0,245,255",a:"ringR",d:30}].map((r,k)=>(
          <div key={k} style={{position:"absolute",inset:r.i,borderRadius:"50%",border:`1px ${r.dash?"dashed":"solid"} rgba(${r.c},.08)`,animation:`${r.a} ${r.d}s linear infinite`}}/>
        ))}
      </div>
      {step>=1&&<h1 style={{fontFamily:"Orbitron",fontWeight:900,fontSize:"clamp(24px,5.5vw,64px)",textAlign:"center",lineHeight:1.1,animation:"fadeUp 1s ease both",marginBottom:8}}>
        <span style={{color:"#fff"}}>NEXSCI SMP</span><br/>
        <span style={{background:"linear-gradient(90deg,#00f5ff,#b44dff)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"glowPulse 3s ease-in-out infinite"}}>NEURAL COMMAND</span><br/>
        <span style={{color:"#fff"}}>INTERFACE</span>
      </h1>}
      {step>=2&&<p className="mono" style={{fontSize:"clamp(9px,1.5vw,12px)",color:"var(--dim)",letterSpacing:2,textAlign:"center",maxWidth:500,lineHeight:1.9,marginBottom:40,animation:"fadeUp .8s .2s ease both",animationFillMode:"both"}}>
        CHAT · SEASON PASS · COSMETICS · GALLERY · SUGGESTIONS · PLAYER OF THE WEEK · MUSIC
      </p>}
      {step>=3&&<div style={{animation:"fadeUp .8s ease both",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
        <button className="neon-btn" onClick={()=>{_playStartupSound();onEnter();}} style={{fontSize:11,letterSpacing:4,padding:"14px 48px",animation:"borderGlow 3s ease-in-out infinite"}}>⟩ ENTER SYSTEM ⟨</button>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND HUB — no Survey card
// ═══════════════════════════════════════════════════════════════════════════════
const MODS=[
  {id:"server",      icon:"🖥",  anim:"pulse",   label:"SERVER STATUS",    sub:"Live ping + Bridge control",        color:"#39ff14"},
  {id:"players",     icon:"👤",  anim:"float",   label:"PLAYER SYSTEMS",   sub:"Live status + profiles",     color:"#00f5ff"},
  {id:"leaderboard", icon:"🏆",  anim:"bounce",  label:"LEADERBOARD",      sub:"Player stats + ranks",       color:"#fbbf24"},
  {id:"wars",        icon:"⚔️",  anim:"spin",    label:"WAR LOGS",         sub:"Conflict history",           color:"#ff4444"},
  {id:"seasons",     icon:"🗓",  anim:"float",   label:"SEASON ARCHIVES",  sub:"SMP history",                color:"#b44dff"},
  {id:"rules",       icon:"📜",  anim:"float",   label:"PROTOCOL RULES",   sub:"Server regulations",         color:"#fbbf24"},
  {id:"diag",        icon:"🧪",  anim:"bounce",  label:"DIAGNOSTICS",      sub:"Metrics · Flags · Log",      color:"#3b82f6"},
  {id:"changelog",   icon:"📋",  anim:"pulse",   label:"CHANGELOG",        sub:"Updates & patches",          color:"#00f5ff"},
  {id:"events",      icon:"🎉",  anim:"bounce",  label:"EVENTS",           sub:"Countdowns & schedule",      color:"#b44dff"},
  {id:"polls",       icon:"🗳",  anim:"float",   label:"COMMUNITY POLLS",  sub:"Vote on server matters",     color:"#3b82f6"},
  {id:"trades",      icon:"💎",  anim:"spin",    label:"TRADE BOARD",      sub:"Buy · Sell · Trade",         color:"#39ff14"},
  {id:"achievements",icon:"🏅",  anim:"pulse",   label:"ACHIEVEMENTS",     sub:"Earn your legend",           color:"#fbbf24"},
  {id:"chat",        icon:"💬",  anim:"bounce",  label:"CHAT",             sub:"Global · DM · Alliance",     color:"#00f5ff"},
  {id:"seasonpass",  icon:"🎫",  anim:"pulse",   label:"SEASON PASS",      sub:"Challenges · Rewards",       color:"#b44dff"},
  {id:"cosmetics",   icon:"🎭",  anim:"float",   label:"WARDROBE",         sub:"60 cosmetics · Admin grant", color:"#b44dff"},
  {id:"gallery",     icon:"🖼",  anim:"float",   label:"GALLERY",          sub:"Screenshots & builds",       color:"#3b82f6"},
  {id:"suggestions", icon:"💡",  anim:"pulse",   label:"SUGGESTIONS",      sub:"Ideas & community vote",     color:"#39ff14"},
  {id:"potw",        icon:"👑",  anim:"bounce",  label:"PLAYER OF WEEK",   sub:"Weekly honour",              color:"#fbbf24"},
  {id:"alliances",   icon:"⚔️",  anim:"spin",    label:"ALLIANCES",        sub:"Kingdoms · Factions · HoF",  color:"#00f5ff"},
  {id:"bulletin",    icon:"📌",  anim:"pulse",   label:"SERVER BULLETIN",  sub:"News · Alerts · Events",     color:"#3b82f6"},
  {id:"banlog",      icon:"⚠️",  anim:"float",   label:"BAN & WARN LOG",   sub:"Moderation · Appeals",       color:"#ff4444"},
  {id:"modreview",   icon:"🔧",  anim:"bounce",  label:"MOD REVIEW",       sub:"Approved · Illegal reports", color:"#b44dff"},
  {id:"settings",    icon:"⚙️",  anim:"spin",    label:"SETTINGS",         sub:"Preferences & theme",        color:"#b44dff"},
  {id:"admin",       icon:"🛠",  anim:"bounce",  label:"ADMIN CONTROLS",   sub:"Restricted access",          color:"#f97316",adminOnly:true},
  // ── Phase 3 ──────────────────────────────────────────────────────────────────
  {id:"console",     icon:"💻",  anim:"pulse",   label:"SERVER CONSOLE",   sub:"Console · Real commands",   color:"#39ff14"},
  {id:"jarcontrol",  icon:"🔩",  anim:"spin",    label:"JAR CONTROL",      sub:"Version · Start · Stop",     color:"#f97316"},
  {id:"livesessions",icon:"📡",  anim:"pulse",   label:"LIVE SESSIONS",    sub:"Live player tracking", color:"#00f5ff"},
  {id:"combatfeed",  icon:"⚔️",  anim:"bounce",  label:"COMBAT FEED",      sub:"Kills · Deaths · PvP log",   color:"#ff4444"},
];
// ─── POTW MINI BANNER (shown on hub when active) ─────────────────────────────
function HubPOTW({onOpen}){
  const[potw,setPotw]=useState(null);
  useEffect(()=>{
    DB.getPOTW().then(p=>{
      if(p&&p.expiresAt&&new Date(p.expiresAt)>new Date())setPotw(p);
    });
  },[]);
  if(!potw)return null;
  return(
    <div style={{width:"100%",maxWidth:920,marginBottom:10,cursor:"pointer",animation:"fadeDown .5s ease both"}} onClick={()=>onOpen("potw")}>
      <div style={{padding:"8px 14px",background:"rgba(251,191,36,.07)",border:"1px solid rgba(251,191,36,.25)",borderRadius:8,display:"flex",alignItems:"center",gap:10}}>
        <span className="potw-crown" style={{fontSize:16,animation:"crownBounce 2s ease-in-out infinite",display:"inline-block"}}>👑</span>
        <span className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2}}>PLAYER OF THE WEEK:</span>
        <span className="mono" style={{fontSize:11,color:"#fff"}}>{potw.username}</span>
        <span className="mono" style={{fontSize:9,color:"var(--dim)",marginLeft:"auto"}}>VIEW →</span>
      </div>
    </div>
  );
}

// ─── ANNOUNCEMENT BANNER (shown on hub) ──────────────────────────────────────
function HubAnnouncements(){
  const[ann,setAnn]=useState([]);
  const[idx,setIdx]=useState(0);
  useEffect(()=>{DB.getAnnouncements().then(a=>setAnn(a.filter(x=>x.active)));},[]);
  useEffect(()=>{if(ann.length<2)return;const t=setInterval(()=>setIdx(i=>(i+1)%ann.length),5000);return()=>clearInterval(t);},[ann.length]);
  if(!ann.length)return null;
  const a=ann[idx];
  const C={info:"var(--cyan)",warning:"var(--amber)",danger:"var(--red)",event:"var(--purple)"};
  const col=C[a.type]||"var(--cyan)";
  return(
    <div style={{width:"100%",maxWidth:920,marginBottom:16,animation:"fadeDown .5s ease both"}}>
      <div style={{padding:"10px 16px",background:`${col}0d`,border:`1px solid ${col}33`,borderRadius:8,display:"flex",alignItems:"center",gap:12,position:"relative"}}>
        <span style={{fontSize:18,flexShrink:0}}>{a.icon||"📢"}</span>
        <div style={{flex:1,minWidth:0}}>
          <div className="orb" style={{fontSize:8,color:col,letterSpacing:2,marginBottom:2}}>{a.title}</div>
          <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.5}}>{a.body}</div>
        </div>
        {ann.length>1&&<div style={{display:"flex",gap:4,flexShrink:0}}>
          {ann.map((_,i)=><div key={i} onClick={()=>setIdx(i)} style={{width:6,height:6,borderRadius:"50%",background:i===idx?col:"rgba(255,255,255,.15)",cursor:"pointer",transition:"background .3s"}}/>)}
        </div>}
      </div>
    </div>
  );
}

function CommandHub({onOpen,user}){
  const{settings}=useSettings();
  const mods=MODS.filter(m=>!m.adminOnly||(user&&user.isAdmin));
  return(
    <div style={{position:"fixed",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",padding:"74px 16px 16px",overflowY:"auto"}}>
      <HubAnnouncements/>
      <HubPOTW onOpen={onOpen}/>
      <div style={{textAlign:"center",marginBottom:24,animation:"hubIn .8s ease both"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:5}}>
          <div style={{width:32,height:1,background:"linear-gradient(to right,transparent,#00f5ff)"}}/>
          <span className="mono" style={{fontSize:8,color:"rgba(0,245,255,.5)",letterSpacing:3}}>COMMAND HUB · v10.0</span>
          <div style={{width:32,height:1,background:"linear-gradient(to left,transparent,#00f5ff)"}}/>
        </div>
        <h2 className="orb" style={{fontSize:"clamp(13px,2.4vw,22px)",color:"#fff",letterSpacing:4,marginBottom:3}}>NEURAL CONTROL MATRIX</h2>
        <p className="mono" style={{fontSize:9,color:"var(--dim)",letterSpacing:2}}>{user?`AUTHENTICATED · ${user.username.toUpperCase()}`:"SIGN IN VIA TOP LEFT TO ACCESS FULL SYSTEM"}</p>
      </div>
      <div style={{width:"min(460px,80vw)",marginBottom:24}}>
        <div style={{height:2,background:"rgba(255,255,255,.05)",borderRadius:2}}>
          <div style={{height:"100%",background:"linear-gradient(to right,var(--cyan),var(--purple))",borderRadius:2,animation:"loadBar 2s ease-in-out infinite alternate"}}/>
        </div>
      </div>
      <div style={{width:"100%",maxWidth:920}}>
        <div className="hub-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:12}}>
          {mods.map((m,i)=>(
            <div key={m.id} className="mcard" onClick={()=>onOpen(m.id)} style={{animation:`hubIn .6s ${.08+i*.06}s ease both`,animationFillMode:"both"}}>
              <div className="mc-tl"/><div className="mc-bl"/>
              <div style={{fontSize:24,marginBottom:9}}><span className={settings.animatedEmoji?`card-emoji-${m.anim}`:""}>{m.icon}</span></div>
              <div className="orb" style={{fontSize:8,color:m.color,letterSpacing:2,marginBottom:4}}>{m.label}</div>
              <div className="mono" style={{fontSize:10,color:"var(--dim)"}}>{m.sub}</div>
              <div style={{marginTop:12,height:1,background:`linear-gradient(to right,${m.color}44,transparent)`}}/>
              <div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><span className="mono" style={{fontSize:7,color:`${m.color}88`,letterSpacing:2}}>INITIALIZE →</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SURVEY — multi-step, embedded in signup
// ═══════════════════════════════════════════════════════════════════════════════
function RadioGrp({label,opts,value,onChange}){
  return(
    <div style={{marginBottom:14}}>
      <label className="si-label">{label}</label>
      <div className="sradio">{opts.map(o=><label key={o} className={`srlabel${value===o?" act":""}`} onClick={()=>onChange(o)}><input type="radio"/>{o}</label>)}</div>
    </div>
  );
}

const SURVEY_STEPS=[
  {title:"PLAY INFO",fields:["play","pvp","hours"]},
  {title:"TECHNICAL",fields:["version","client","mods","specs"]},
  {title:"SOCIAL",fields:["voice","time","tz","lag","notes"]},
];

function SurveyFlow({username,onComplete}){
  const[step,setStep]=useState(0);
  const[form,setForm]=useState({});
  const sf=(k,v)=>setForm(f=>({...f,[k]:v}));

  const canNext=()=>{
    if(step===0)return form.play&&form.pvp&&form.hours;
    if(step===1)return form.version&&form.client;
    return true;
  };

  return(
    <div>
      {/* STEP DOTS */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:20}}>
        {SURVEY_STEPS.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
            <div className="step-dot" style={{background:i<=step?"var(--blue)":"rgba(0,245,255,.15)",boxShadow:i===step?"0 0 8px var(--blue)":"none",width:i===step?10:8,height:i===step?10:8}}/>
            {i<SURVEY_STEPS.length-1&&<div style={{width:24,height:1,background:i<step?"var(--blue)":"rgba(0,245,255,.1)"}}/>}
          </div>
        ))}
      </div>
      <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:3,marginBottom:16,textAlign:"center"}}>STEP {step+1}/{SURVEY_STEPS.length} · {SURVEY_STEPS[step].title}</div>

      <div className="survey-step" key={step}>
        {step===0&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}} className="survey-grid">
            <RadioGrp label="Will you play?" opts={["Yes","No","Maybe"]} value={form.play} onChange={v=>sf("play",v)}/>
            <RadioGrp label="PvP Interest" opts={["Love it","Neutral","Avoid it"]} value={form.pvp} onChange={v=>sf("pvp",v)}/>
            <RadioGrp label="Daily Playtime" opts={["<1hr","1-3hr","3-6hr","6hr+"]} value={form.hours} onChange={v=>sf("hours",v)}/>
          </div>
        )}
        {step===1&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}} className="survey-grid">
            <div style={{marginBottom:14}}><label className="si-label">Minecraft Version</label><select className="si" value={form.version||""} onChange={e=>sf("version",e.target.value)}><option value="">— Select —</option>{["1.21.1","1.21","1.20.6","1.20.4","1.20.1","1.19.4","Bedrock","Other"].map(v=><option key={v}>{v}</option>)}</select></div>
            <RadioGrp label="Client Type" opts={["Java Paid","Bedrock","Free Client"]} value={form.client} onChange={v=>sf("client",v)}/>
            <RadioGrp label="Mods OK?" opts={["Yes","No","Vanilla Only"]} value={form.mods} onChange={v=>sf("mods",v)}/>
            <div style={{marginBottom:14}}><label className="si-label">Device / Specs</label><input className="si" placeholder="e.g. PC, 8GB RAM" value={form.specs||""} onChange={e=>sf("specs",e.target.value)}/></div>
          </div>
        )}
        {step===2&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}} className="survey-grid">
            <RadioGrp label="Voice Chat?" opts={["Yes","No","Sometimes"]} value={form.voice} onChange={v=>sf("voice",v)}/>
            <div style={{marginBottom:14}}><label className="si-label">Preferred Time</label><select className="si" value={form.time||""} onChange={e=>sf("time",e.target.value)}><option value="">— Select —</option>{["Morning","Afternoon","Evening","Late Night"].map(v=><option key={v}>{v}</option>)}</select></div>
            <div style={{marginBottom:14}}><label className="si-label">Time Zone</label><input className="si" placeholder="e.g. UTC+5:30" value={form.tz||""} onChange={e=>sf("tz",e.target.value)}/></div>
            <RadioGrp label="Lag Tolerance" opts={["Low","Medium","High"]} value={form.lag} onChange={v=>sf("lag",v)}/>
            <div style={{gridColumn:"1/-1",marginBottom:14}}><label className="si-label">Additional Notes</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={form.notes||""} onChange={e=>sf("notes",e.target.value)}/></div>
          </div>
        )}
      </div>

      <div style={{display:"flex",gap:10,marginTop:4}}>
        {step>0&&<button className="neon-btn" onClick={()=>setStep(s=>s-1)} style={{borderColor:"var(--dim)",color:"var(--dim)",fontSize:9,padding:"9px 16px"}}>← BACK</button>}
        {step<SURVEY_STEPS.length-1
          ?<button className="neon-btn" onClick={()=>canNext()&&setStep(s=>s+1)} disabled={!canNext()} style={{flex:1,borderColor:"var(--blue)",color:"var(--blue)",fontSize:9}}>NEXT STEP →</button>
          :<button className="neon-btn" onClick={()=>onComplete(form)} style={{flex:1,borderColor:"var(--green)",color:"var(--green)",fontSize:9}}>⟩ SUBMIT & JOIN ⟨</button>
        }
      </div>
      {!canNext()&&<div className="mono" style={{fontSize:9,color:"rgba(255,165,0,.6)",marginTop:8,textAlign:"center"}}>⚠ Please answer all required fields to continue.</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGIN PANEL — signup includes survey
// ═══════════════════════════════════════════════════════════════════════════════
function LoginPanel({onClose,onLogin}){
  const toast=useToast();
  const[tab,setTab]=useState("login");
  const[af,setAf]=useState({username:"",password:"",email:"",confirm:""});
  const[signupStep,setSignupStep]=useState("form"); // form | survey | done
  const[pendingUser,setPendingUser]=useState(null);
  const[resetTab,setResetTab]=useState(false);
  const[err,setErr]=useState("");
  const[loading,setLoading]=useState(false);

  const doLogin=async()=>{
    setErr("");setLoading(true);
    if(!af.username||!af.password){setErr("All fields required.");setLoading(false);return;}
    if(af.username===ADMIN_CREDS.username&&af.password===ADMIN_CREDS.password){
      const u={username:ADMIN_CREDS.username,isAdmin:true};
      await DB.setSession(u);onLogin(u);toast(`Welcome, ${ADMIN_CREDS.username}!`,"var(--orange)","⭐");setLoading(false);onClose();return;
    }
    const users=await DB.getUsers();
    const found=users.find(u=>u.username.toLowerCase()===af.username.toLowerCase()&&u.password===af.password);
    if(!found){setErr("Invalid username or password.");setLoading(false);return;}
    if(found.resetRequested){setErr("Password reset requested. Ask AdminOP for new credentials.");setLoading(false);return;}
    const u={username:found.username,isAdmin:false};
    await DB.setSession(u);onLogin(u);toast(`Welcome back, ${found.username}!`,"var(--cyan)","👋");setLoading(false);onClose();
  };

  const doSignupForm=async()=>{
    setErr("");setLoading(true);
    const{username,password,email,confirm}=af;
    if(!username||!password||!email){setErr("All fields required.");setLoading(false);return;}
    if(password!==confirm){setErr("Passwords do not match.");setLoading(false);return;}
    if(password.length<6){setErr("Password must be ≥6 characters.");setLoading(false);return;}
    if(username===ADMIN_CREDS.username){setErr("Username not available.");setLoading(false);return;}
    const users=await DB.getUsers();
    if(users.some(u=>u.username.toLowerCase()===username.toLowerCase())){setErr("Username already taken.");setLoading(false);return;}
    // Store pending user, move to survey step
    setPendingUser({username,password,email});
    setSignupStep("survey");setLoading(false);
  };

  const doSurveyComplete=async(surveyData)=>{
    if(!pendingUser)return;
    setLoading(true);
    const users=await DB.getUsers();
    const joinDate=new Date().toISOString();
    const newUser={...pendingUser,createdAt:joinDate,joinDate,surveyDone:true,bio:"",fav1:"",fav2:"",fav3:""};
    await DB.setUsers([...users,newUser]);
    // Whitelist
    const wl=await DB.getWhitelist();
    if(!wl.includes(pendingUser.username))await DB.setWhitelist([...wl,pendingUser.username]);
    // Save survey
    const surveys=await DB.getSurveys();
    await DB.setSurveys([...(surveys||[]),{username:pendingUser.username,responses:surveyData,submittedAt:new Date().toISOString()}]);
    // Player status entry
    const ps=await DB.getPlayerStatus();
    if(!ps[pendingUser.username])await DB.setPlayerStatus({...ps,[pendingUser.username]:{status:"offline",activity:"New player",updatedAt:new Date().toISOString()}});
    await DB.pushNotif({type:"admin",title:"NEW PLAYER JOINED",body:`${pendingUser.username} registered and completed the survey. They have been whitelisted.`});
    const u={username:pendingUser.username,isAdmin:false};
    await DB.setSession(u);onLogin(u);
    toast(`Welcome to NexSci SMP, ${pendingUser.username}!`,"var(--green)","🎉");
    setLoading(false);setSignupStep("done");onClose();
  };

  const doResetReq=async()=>{
    setErr("");setLoading(true);
    if(!af.username){setErr("Enter your username.");setLoading(false);return;}
    const users=await DB.getUsers();
    const found=users.find(u=>u.username.toLowerCase()===af.username.toLowerCase());
    if(!found){setErr("Username not found.");setLoading(false);return;}
    await DB.requestPwReset(af.username);
    await DB.pushNotif({type:"admin",title:"PASSWORD RESET REQUEST",body:`${af.username} requested a password reset.`});
    toast("Reset request sent!","var(--amber)","🔑");setResetTab(false);setLoading(false);
  };

  return(
    <Panel title="NEXSCI SMP PORTAL" subtitle={signupStep==="survey"?"STEP 2 · SURVEY — REQUIRED FOR ALL NEW PLAYERS":"AUTHENTICATION SYSTEM"} color="var(--cyan)" onClose={onClose} wide={signupStep==="survey"}>
      <div style={{maxWidth:signupStep==="survey"?700:420,margin:"0 auto"}}>

        {/* SURVEY STEP */}
        {tab==="signup"&&signupStep==="survey"&&(
          <div>
            <div style={{padding:"9px 13px",background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.2)",borderRadius:6,marginBottom:16}}>
              <div className="mono" style={{fontSize:10,color:"var(--blue)",lineHeight:1.7}}>
                📋 Welcome, <strong>{pendingUser?.username}</strong>! Complete this survey to finish registration and get whitelisted on the server. This only takes 1 minute.
              </div>
            </div>
            <SurveyFlow username={pendingUser?.username} onComplete={doSurveyComplete}/>
          </div>
        )}

        {/* NORMAL AUTH */}
        {signupStep==="form"&&(
          <>
            <div style={{display:"flex",borderBottom:"1px solid rgba(0,245,255,.1)",marginBottom:20}}>
              {["login","signup","reset"].map(t=>(
                <button key={t}
                  style={{fontSize:9,letterSpacing:2,padding:"9px 14px",background:"transparent",border:"none",borderBottom:`2px solid ${(!resetTab&&tab===t)||(resetTab&&t==="reset")?"var(--cyan)":"transparent"}`,color:(!resetTab&&tab===t)||(resetTab&&t==="reset")?"var(--cyan)":"var(--dim)",cursor:"pointer",fontFamily:"Orbitron",transition:"all .3s"}}
                  onClick={()=>{if(t==="reset")setResetTab(true);else{setResetTab(false);setTab(t);}setErr("");}}>
                  {t==="login"?"SIGN IN":t==="signup"?"CREATE ACCOUNT":"FORGOT PW"}
                </button>
              ))}
            </div>
            {err&&<div className="mono" style={{fontSize:11,color:"var(--red)",marginBottom:12,padding:"8px 12px",background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.2)",borderRadius:6}}>⚠ {err}</div>}

            {resetTab?(
              <div style={{display:"grid",gap:12}}>
                <div><label className="si-label">YOUR USERNAME</label><input className="si" placeholder="Enter your username" value={af.username} onChange={e=>setAf(f=>({...f,username:e.target.value}))}/></div>
                <button className="neon-btn" onClick={doResetReq} disabled={loading} style={{width:"100%",borderColor:"var(--amber)",color:"var(--amber)"}}>{loading?"SENDING...":"⟩ REQUEST PASSWORD RESET ⟨"}</button>
              </div>
            ):(
              <div style={{display:"grid",gap:11}}>
                <div><label className="si-label">USERNAME</label><input className="si" placeholder="Your IGN or username" value={af.username} onChange={e=>setAf(f=>({...f,username:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&tab==="login"&&doLogin()}/></div>
                {tab==="signup"&&<div><label className="si-label">EMAIL</label><input className="si" type="email" placeholder="you@example.com" value={af.email} onChange={e=>setAf(f=>({...f,email:e.target.value}))}/></div>}
                <div><label className="si-label">PASSWORD</label><input className="si" type="password" placeholder="••••••••" value={af.password} onChange={e=>setAf(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&tab==="login"&&doLogin()}/></div>
                {tab==="signup"&&<div><label className="si-label">CONFIRM PASSWORD</label><input className="si" type="password" placeholder="••••••••" value={af.confirm} onChange={e=>setAf(f=>({...f,confirm:e.target.value}))}/></div>}
                {tab==="signup"&&(
                  <div style={{padding:"8px 12px",background:"rgba(59,130,246,.05)",border:"1px dashed rgba(59,130,246,.2)",borderRadius:6}}>
                    <div className="mono" style={{fontSize:9,color:"rgba(59,130,246,.7)",lineHeight:1.7}}>📋 After creating your account you will fill a short survey — required for whitelist access.</div>
                  </div>
                )}
                <button className="neon-btn" onClick={tab==="login"?doLogin:doSignupForm} disabled={loading} style={{width:"100%",borderColor:"var(--blue)",color:"var(--blue)"}}>
                  {loading?"PROCESSING...":(tab==="login"?"⟩ AUTHENTICATE ⟨":"⟩ NEXT — FILL SURVEY ⟨")}
                </button>
              </div>
            )}
            <div style={{marginTop:14,padding:9,background:"rgba(0,245,255,.03)",border:"1px dashed rgba(0,245,255,.1)",borderRadius:6}}>
              <div className="mono" style={{fontSize:8,color:"var(--dim)",lineHeight:1.8}}>
                ℹ Sessions are permanent — you won't need to log in again on return.<br/>
                Admin: <span style={{color:"var(--orange)"}}>AdminOP</span>
              </div>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT PANEL — with PFP upload
// ═══════════════════════════════════════════════════════════════════════════════
function AccountPanel({user,onClose,onLogin,onLogout}){
  const toast=useToast();
  const[tab,setTab]=useState("profile");
  const[newName,setNewName]=useState(user.username);
  const[newStatus,setNewStatus]=useState("");
  const[oldPw,setOldPw]=useState("");
  const[newPw,setNewPw]=useState("");
  const[cfPw,setCfPw]=useState("");
  const[pfpPreview,setPfpPreview]=useState(null);
  const[pfpFile,setPfpFile]=useState(null);
  const[saving,setSaving]=useState(false);
  const[err,setErr]=useState("");
  const fileRef=useRef(null);

  const[bio,setBio]=useState("");
  const[favThings,setFavThings]=useState({fav1:"",fav2:"",fav3:""});
  const[discord,setDiscord]=useState("");
  const[bannerPreview,setBannerPreview]=useState(null);
  const[bannerFile,setBannerFile]=useState(null);
  const bannerRef=useRef(null);

  useEffect(()=>{
    if(!user.isAdmin){
      DB.getUsers().then(us=>{
        const f=us.find(u2=>u2.username===user.username);
        if(f){
          setNewStatus(f.displayStatus||"");
          setBio(f.bio||"");
          setFavThings({fav1:f.fav1||"",fav2:f.fav2||"",fav3:f.fav3||""});
          setDiscord(f.discord||"");
        }
      });
      DB.getUserPfp(user.username).then(p=>{if(p)setPfpPreview(p);});
      DB.getUserBanner(user.username).then(b=>{if(b)setBannerPreview(b);});
    }
  },[user.username,user.isAdmin]);

  const handlePfpFile=e=>{
    const file=e.target.files[0];
    if(!file)return;
    if(file.size>5*1024*1024){toast("Image too large — max 5MB please.","var(--red)","\u26a0");return;}
    setPfpFile(file);
    const reader=new FileReader();
    reader.onload=ev=>setPfpPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const saveProfile=async()=>{
    setSaving(true);setErr("");
    const users=await DB.getUsers();
    const newUsername=newName.trim()||user.username;
    if(newUsername!==user.username&&users.some(u=>u.username.toLowerCase()===newUsername.toLowerCase()&&u.username!==user.username)){
      setErr("Username already taken.");setSaving(false);return;
    }
    const updated=users.map(u=>u.username===user.username?{...u,username:newUsername,displayStatus:newStatus,bio:bio.trim(),fav1:favThings.fav1.trim(),fav2:favThings.fav2.trim(),fav3:favThings.fav3.trim(),discord:discord.trim().replace(/^@/,""),joinDate:u.joinDate||new Date().toISOString()}:u);
    await DB.setUsers(updated);
    if(pfpFile){
      toast("Uploading profile picture...","var(--cyan)","⬆");
      const ok=await DB.setUserPfp(user.username,pfpFile);
      if(!ok)toast("PFP upload failed.","var(--red)","⚠");
      else toast("Profile picture saved!","var(--green)","🖼");
    }
    if(bannerFile){
      toast("Uploading banner...","var(--purple)","⬆");
      const ok=await DB.setUserBanner(user.username,bannerFile);
      if(!ok)toast("Banner upload failed.","var(--red)","⚠");
      else toast("Banner saved!","var(--green)","🖼");
    }
    const newSession={...user,username:newUsername};
    await DB.setSession(newSession);onLogin(newSession);
    toast("Profile updated!","var(--green)","✅");setSaving(false);
  };

  const changePassword=async()=>{
    setSaving(true);setErr("");
    if(!oldPw||!newPw||!cfPw){setErr("All fields required.");setSaving(false);return;}
    if(newPw!==cfPw){setErr("Passwords don't match.");setSaving(false);return;}
    if(newPw.length<6){setErr("Min 6 characters.");setSaving(false);return;}
    const users=await DB.getUsers();
    const found=users.find(u=>u.username===user.username&&u.password===oldPw);
    if(!found){setErr("Incorrect current password.");setSaving(false);return;}
    await DB.resetUserPw(user.username,newPw);
    toast("Password changed!","var(--green)","🔑");setSaving(false);setOldPw("");setNewPw("");setCfPw("");
  };

  const[banRecords,setBanRecords]=useState([]);
  const[banLoaded,setBanLoaded]=useState(false);

  const loadBanRecords=()=>{
    if(banLoaded)return;
    DB.getBanLog().then(log=>{setBanRecords(log.filter(b=>b.username===user.username));setBanLoaded(true);});
  };

  return(
    <Panel title="ACCOUNT MANAGE" subtitle={`${user.username.toUpperCase()} · ${user.isAdmin?"ADMIN":"PLAYER"}`} color="var(--cyan)" onClose={onClose}>
      <div style={{display:"flex",gap:7,marginBottom:16,borderBottom:"1px solid rgba(0,245,255,.1)",paddingBottom:10,flexWrap:"wrap"}}>
        {["profile","password","modrecord"].map(t=>(
          <button key={t} onClick={()=>{setTab(t);setErr("");if(t==="modrecord")loadBanRecords();}} style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:2,padding:"6px 12px",borderRadius:5,cursor:"pointer",background:tab===t?"rgba(0,245,255,.12)":"transparent",border:`1px solid ${tab===t?"var(--cyan)":"rgba(0,245,255,.15)"}`,color:tab===t?"var(--cyan)":"var(--dim)",transition:"all .2s"}}>
            {t==="modrecord"?"MY RECORD":t.toUpperCase()}
          </button>
        ))}
      </div>
      {err&&<div className="mono" style={{fontSize:11,color:"var(--red)",marginBottom:12,padding:"8px 12px",background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.2)",borderRadius:6}}>⚠ {err}</div>}

      {tab==="profile"&&(
        <div style={{display:"grid",gap:14,maxWidth:440}}>
          {/* PFP UPLOAD */}
          <div>
            <label className="si-label">PROFILE PICTURE</label>
            <div style={{display:"flex",gap:14,alignItems:"center",marginBottom:8}}>
              <div style={{position:"relative",flexShrink:0}}>
                {pfpPreview
                  ?<img src={pfpPreview} alt="pfp" style={{width:64,height:64,borderRadius:8,objectFit:"cover",border:"2px solid rgba(0,245,255,.3)"}}/>
                  :<MCAvatar username={user.username} size={64} style={{border:"2px solid rgba(0,245,255,.3)"}}/>
                }
              </div>
              <div style={{flex:1}}>
                <div className="pfp-upload-zone" onClick={()=>fileRef.current?.click()}>
                  <div style={{fontSize:20,marginBottom:4}}>📁</div>
                  <div className="mono" style={{fontSize:10,color:"var(--dim)"}}>Click to upload image</div>
                  <div className="mono" style={{fontSize:8,color:"rgba(0,245,255,.3)",marginTop:3}}>PNG, JPG, GIF · max 2MB</div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handlePfpFile}/>
              </div>
            </div>
            {pfpFile&&<div className="mono" style={{fontSize:9,color:"var(--green)"}}>✅ New image ready — uploading to Cloudinary on save</div>}
          </div>
          <div><label className="si-label">DISPLAY NAME</label><input className="si" value={newName} onChange={e=>setNewName(e.target.value)} disabled={user.isAdmin}/></div>
          <div><label className="si-label">STATUS MESSAGE</label><input className="si" value={newStatus} onChange={e=>setNewStatus(e.target.value)} placeholder="e.g. Building my megabase..." maxLength={80} disabled={user.isAdmin}/></div>
          {!user.isAdmin&&<>
            {/* BANNER UPLOAD */}
            <div>
              <label className="si-label">PROFILE BANNER</label>
              <div style={{position:"relative",borderRadius:8,overflow:"hidden",marginBottom:6,cursor:"pointer",height:70,background:bannerPreview?"none":"linear-gradient(135deg,rgba(0,12,30,1) 0%,rgba(0,245,255,.1) 50%,rgba(20,0,40,.8) 100%)",border:"1px dashed rgba(0,245,255,.2)"}} onClick={()=>bannerRef.current?.click()}>
                {bannerPreview&&<img src={bannerPreview} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="banner"/>}
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.3)"}}>
                  <div className="mono" style={{fontSize:9,color:"var(--cyan)",letterSpacing:1}}>🖼 {bannerPreview?"CHANGE BANNER":"UPLOAD BANNER"}</div>
                </div>
                <input ref={bannerRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;setBannerFile(f);const r=new FileReader();r.onload=ev=>setBannerPreview(ev.target.result);r.readAsDataURL(f);}}/>
              </div>
              {bannerFile&&<div className="mono" style={{fontSize:8,color:"var(--green)"}}>✅ Banner ready — uploads on save</div>}
            </div>
            <div><label className="si-label">BIO / ABOUT ME</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={bio} onChange={e=>setBio(e.target.value)} placeholder="Tell your SMP crew a bit about yourself..." maxLength={200}/><div className="mono" style={{fontSize:8,color:"var(--dim)",textAlign:"right",marginTop:2}}>{bio.length}/200</div></div>
            <div><label className="si-label">DISCORD TAG (optional)</label><input className="si" value={discord} onChange={e=>setDiscord(e.target.value)} placeholder="e.g. yourname or yourname#1234" maxLength={40}/></div>
            <div>
              <label className="si-label">FAVOURITE THINGS (3 max)</label>
              <div style={{display:"grid",gap:6}}>
                {[["fav1","e.g. Mega bases"],["fav2","e.g. PvP tournaments"],["fav3","e.g. Trading diamonds"]].map(([k,ph])=>(
                  <input key={k} className="si" value={favThings[k]} onChange={e=>setFavThings(f=>({...f,[k]:e.target.value}))} placeholder={ph} maxLength={50}/>
                ))}
              </div>
            </div>
          </>}
          {user.isAdmin&&<div className="mono" style={{fontSize:9,color:"var(--dim)"}}>Admin account — name and status cannot be changed here.</div>}
          <button className="neon-btn" onClick={saveProfile} disabled={saving||user.isAdmin} style={{width:"100%"}}>{saving?"SAVING...":"⟩ SAVE PROFILE ⟨"}</button>
          <button onClick={()=>{onLogout();onClose();}} style={{background:"rgba(255,68,68,.07)",border:"1px solid rgba(255,68,68,.25)",color:"#ff5555",borderRadius:5,padding:"9px",cursor:"pointer",fontFamily:"Orbitron",fontSize:8,letterSpacing:2}}>⟩ LOG OUT ⟨</button>
        </div>
      )}

      {tab==="password"&&(
        <div style={{display:"grid",gap:12,maxWidth:380}}>
          <div><label className="si-label">CURRENT PASSWORD</label><input className="si" type="password" value={oldPw} onChange={e=>setOldPw(e.target.value)} placeholder="••••••••"/></div>
          <div><label className="si-label">NEW PASSWORD</label><input className="si" type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="••••••••"/></div>
          <div><label className="si-label">CONFIRM NEW PASSWORD</label><input className="si" type="password" value={cfPw} onChange={e=>setCfPw(e.target.value)} placeholder="••••••••"/></div>
          <button className="neon-btn" onClick={changePassword} disabled={saving} style={{width:"100%"}}>{saving?"UPDATING...":"⟩ CHANGE PASSWORD ⟨"}</button>
        </div>
      )}

      {tab==="modrecord"&&(
        <div>
          <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:12}}>⚠️ MY MODERATION RECORD</div>
          {!banLoaded?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"20px"}}>LOADING...</div>:(
            banRecords.length===0?(
              <div style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}>
                <div style={{fontSize:28,marginBottom:8}}>✅</div>
                <div className="mono" style={{fontSize:10}}>Your record is clean. Keep it up!</div>
              </div>
            ):(
              <div style={{display:"grid",gap:8}}>
                <div className="mono" style={{fontSize:9,color:"var(--dim)",marginBottom:4,lineHeight:1.7}}>You have {banRecords.length} moderation record{banRecords.length>1?"s":""}. Active penalties affect your gameplay. You may submit an appeal for each.</div>
                {banRecords.map(b=>{
                  const T=BAN_TYPES[b.type]||BAN_TYPES.warn;
                  const myAppeal=(b.appeals||[]).find(a=>a.username===user.username);
                  return(
                    <div key={b.id} className={`ban-entry ban-type-${b.type}`} style={{opacity:b.status==="revoked"?0.55:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                        <span style={{fontSize:14}}>{T.icon}</span>
                        <span className="orb" style={{fontSize:9,color:T.color,letterSpacing:1}}>{T.label}</span>
                        <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>· {new Date(b.ts).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"})}</span>
                        {b.duration&&<span className="mono" style={{fontSize:8,color:"var(--amber)"}}>· {b.duration}</span>}
                        {b.status==="revoked"&&<span className="mono" style={{fontSize:8,color:"var(--green)",marginLeft:"auto"}}>✅ REVOKED</span>}
                      </div>
                      <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.6,marginBottom:6}}><span style={{color:"var(--dim)"}}>Reason: </span>{b.reason}</div>
                      {/* Appeal status */}
                      {myAppeal?(
                        <div style={{background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.15)",borderRadius:6,padding:"8px 10px"}}>
                          <div className="mono" style={{fontSize:8,color:"var(--cyan)"}}>📝 Your appeal: {myAppeal.status?.toUpperCase()||"PENDING REVIEW"}</div>
                          <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:2}}>{myAppeal.text}</div>
                        </div>
                      ):b.status==="active"&&(
                        <button onClick={()=>{
                          const text=prompt("Enter your appeal message:");
                          if(text?.trim()){
                            const updated=banRecords.map(x=>x.id===b.id?{...x,appeals:[...(x.appeals||[]),{username:user.username,text:text.trim(),ts:new Date().toISOString(),status:"pending"}]}:x);
                            setBanRecords(updated);
                            DB.getBanLog().then(async fullLog=>{
                              const merged=fullLog.map(fl=>updated.find(u=>u.id===fl.id)||fl);
                              await DB.setBanLog(merged);
                              await DB.pushNotif({type:"admin",title:"BAN APPEAL",body:`${user.username} appealed: ${text.slice(0,60)}`});
                            });
                          }
                        }} style={{background:"rgba(0,245,255,.06)",border:"1px solid rgba(0,245,255,.2)",borderRadius:4,color:"var(--cyan)",cursor:"pointer",padding:"5px 12px",fontFamily:"Orbitron",fontSize:7,letterSpacing:1}}>📝 SUBMIT APPEAL</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MY STATUS PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function MyStatusPanel({user,onClose}){
  const toast=useToast();
  const[statuses,setStatuses]=useState({});
  const[sel,setSel]=useState("online");
  const[activity,setActivity]=useState("");
  const[saving,setSaving]=useState(false);
  useEffect(()=>{DB.getPlayerStatus().then(s=>{setStatuses(s);const m=s[user.username];if(m){setSel(m.status);setActivity(m.activity||"");}});},[user.username]);
  const save=async()=>{
    setSaving(true);
    const updated={...statuses,[user.username]:{status:sel,activity:activity.trim()||"Online",updatedAt:new Date().toISOString()}};
    await DB.setPlayerStatus(updated);
    toast("Status updated!","var(--green)","✅");setSaving(false);onClose();
  };
  return(
    <Panel title="SET MY STATUS" subtitle={`UPDATING · ${user.username.toUpperCase()}`} color="var(--cyan)" onClose={onClose}>
      <div style={{maxWidth:400,margin:"0 auto"}}>
        <div style={{marginBottom:20}}>
          <label className="si-label">STATUS</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {STATUS_OPTIONS.map(s=>(
              <button key={s} className="stat-btn" onClick={()=>setSel(s)} style={{borderColor:sel===s?SC[s]:"rgba(255,255,255,.1)",color:sel===s?SC[s]:"var(--dim)",background:sel===s?`${SC[s]}18`:"transparent",padding:"10px",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{STATUS_EMOJI[s]}</div>
                <div className="orb" style={{fontSize:8,letterSpacing:2}}>{s.toUpperCase()}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <label className="si-label">CURRENT ACTIVITY</label>
          <input className="si" placeholder="e.g. Mining diamonds..." value={activity} onChange={e=>setActivity(e.target.value)} maxLength={60}/>
          <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:4,textAlign:"right"}}>{activity.length}/60</div>
        </div>
        <button className="neon-btn" onClick={save} disabled={saving} style={{width:"100%"}}>{saving?"UPDATING...":"⟩ SET STATUS ⟨"}</button>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER PANEL — Live ping + Oracle Bridge control
// ═══════════════════════════════════════════════════════════════════════════════
function ServerPanel({onClose,user}){
  const toast=useToast();
  const {bridge,isLive,loading:bridgeLoading}=useBridgeStatus();
  const[srv,setSrv]=useState(null);
  const[pingData,setPingData]=useState(null);
  const[pinging,setPinging]=useState(false);
  const[edit,setEdit]=useState({});
  const[editMode,setEditMode]=useState(false);
  const[saving,setSaving]=useState(false);
  const[loading,setLoading]=useState(true);
  const lastPingStatus=useRef(null);
  // Server power access
  const[powerAccess,setPowerAccess]=useState([]);
  const[reqMsg,setReqMsg]=useState("");
  const[reqSending,setReqSending]=useState(false);
  const[showReqForm,setShowReqForm]=useState(false);

  useEffect(()=>{
    DB.getServer().then(s=>{setSrv(s);setEdit(s);setLoading(false);});
    const t=setInterval(()=>DB.getServer().then(setSrv),6000);return()=>clearInterval(t);
  },[]);

  useEffect(()=>{
    DB.getServerPowerAccess().then(setPowerAccess);
    const t=setInterval(()=>DB.getServerPowerAccess().then(setPowerAccess),12000);
    return()=>clearInterval(t);
  },[]);

  // When bridge is live it reports real player count + state — reflect that
  useEffect(()=>{
    if(!bridge||!srv)return;
    if(bridge.playerCount!==undefined&&bridge.serverState){
      const updated={...srv,
        status:bridge.serverState==="running"?"online":"offline",
        playerCount:bridge.playerCount,
        lastChanged:bridge.ts,changedBy:"BRIDGE"
      };
      setSrv(updated);
    }
  },[bridge]);

  const doPing=useCallback(async s=>{
    if(!s?.ip||s.ip==="play.yourserver.net"){setPingData({reachable:false,note:"Set server IP in Edit"});return;}
    setPinging(true);
    const data=await pingMinecraft(s.ip,s.port||"25565");
    setPingData(data);
    if(data.reachable&&data.online!==(s.status==="online")){
      const ns2=data.online?"online":"offline";
      if(lastPingStatus.current!==ns2){
        lastPingStatus.current=ns2;
        const up={...s,status:ns2,playerCount:data.players,lastChanged:new Date().toISOString(),changedBy:"AUTO-PING"};
        await DB.setServer(up);setSrv(up);
        if(ns2==="online"){fireBrowserNotif("🟢 NexSci SMP Online!","Server is up!");await DB.pushNotif({type:"server",title:"SERVER ONLINE",body:"NexSci SMP is online! Come play."});}
        toast(`Server auto-updated to ${ns2.toUpperCase()}`,ns2==="online"?"var(--green)":"var(--red)",ns2==="online"?"🟢":"🔴");
      }
    }
    setPinging(false);
  },[toast]);

  useEffect(()=>{if(srv&&!pingData)doPing(srv);},[srv]);

  // Bridge-powered start/stop — works for admin + granted players
  const bridgeAction=async(action,actingUser)=>{
    const actor=actingUser||user;
    const url=srv?.bridgeUrl;
    if(!url){toast("No Bridge URL set. Contact admin.","var(--red)","⚠");return;}
    if(!isLive){toast("Oracle bridge offline — cannot send command.","var(--amber)","⚠");return;}
    try{
      setSaving(true);
      const res=await fetch(`${url}/server/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(8000)});
      if(!res.ok)throw new Error(await res.text());
      toast(`Bridge: ${action.toUpperCase()} command sent.`,"var(--green)","✅");
      await DB.pushConsoleLog({type:"system",message:`[Bridge] ${actor.username} sent /${action} via panel.`,source:"bridge",sentBy:actor.username});
      await DB.pushNotif({type:"server",title:`SERVER ${action.toUpperCase()}`,body:`${actor.username} sent ${action} command.`});
    }catch(e){
      toast("Bridge error: "+e.message,"var(--red)","⚠");
    }finally{setSaving(false);}
  };

  // Determine if current user has power control access
  const myPowerEntry=powerAccess.find(r=>r.username===user?.username);
  const hasGrantedAccess=user?.isAdmin||(myPowerEntry?.status==="approved");
  const myPendingReq=myPowerEntry?.status==="pending";

  // Manual status toggle — works for admin and granted players
  const toggleStatus=async()=>{
    if(!hasGrantedAccess)return;
    if(isLive){bridgeAction(srv?.status==="online"?"stop":"start");return;}
    // Fallback: just update Firestore status (no Oracle bridge)
    const ns={...srv,status:srv.status==="online"?"offline":"online",lastChanged:new Date().toISOString(),changedBy:user.username};
    setSaving(true);await DB.setServer(ns);setSrv(ns);
    if(ns.status==="online"){fireBrowserNotif("🟢 Server Online!",`${user.username} started the server!`);await DB.pushNotif({type:"server",title:"SERVER STARTED",body:`${user.username} started the server.`});}
    toast(`Server marked ${ns.status.toUpperCase()}`,ns.status==="online"?"var(--green)":"var(--red)",ns.status==="online"?"▶":"⬛");
    setSaving(false);
  };

  // Request server power access
  const submitPowerReq=async()=>{
    if(!user||!reqMsg.trim())return;
    setReqSending(true);
    const ok=await DB.pushServerPowerReq({username:user.username,message:reqMsg.trim()});
    if(ok===false){toast("You already have a pending request.","var(--amber)","⚠");}
    else{
      await DB.pushNotif({type:"admin",title:"SERVER POWER REQUEST",body:`${user.username} requested server control access.`});
      toast("Request sent! Admin will review it.","var(--green)","✅");
      setReqMsg("");setShowReqForm(false);
      DB.getServerPowerAccess().then(setPowerAccess);
    }
    setReqSending(false);
  };

  const saveEdit=async()=>{
    setSaving(true);
    const updated={...edit,lastChanged:new Date().toISOString(),changedBy:user.username};
    await DB.setServer(updated);setSrv(updated);
    setEditMode(false);setSaving(false);toast("Server info updated.","var(--green)","✅");
  };

  if(loading)return <Panel title="SERVER STATUS" subtitle="FETCHING..." color="var(--green)" onClose={onClose}><div style={{textAlign:"center",padding:"50px 0"}}><div className="mono" style={{color:"var(--dim)"}}>CONNECTING...</div></div></Panel>;
  const isOnline=isLive?(bridge.serverState==="running"):(srv?.status==="online");

  return(
    <Panel title="SERVER STATUS" subtitle="LIVE PING · ORACLE BRIDGE CONTROL" color="var(--green)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>

        {/* BRIDGE STATUS BAR */}
        <BridgeBadge bridge={bridge} isLive={isLive} loading={bridgeLoading}/>

        {/* PING BANNER */}
        <div style={{background:"rgba(57,255,20,.05)",border:"1px solid rgba(57,255,20,.2)",borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{position:"relative",width:10,height:10}}>
              <div style={{position:"absolute",inset:0,borderRadius:"50%",background:pingData?.online?"var(--green)":pingData?.reachable===false?"var(--red)":"var(--amber)"}}/>
              {pingData?.online&&<div className="ping-ring" style={{borderColor:"var(--green)"}}/>}
            </div>
            <div>
              <div className="orb" style={{fontSize:9,color:"var(--green)",letterSpacing:2}}>
                {isLive?"BRIDGE LIVE PING":"EXTERNAL PING"}
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--dim)",marginTop:2}}>
                {isLive
                  ?`${bridge.playerCount||0}/${bridge.maxPlayers||20} online · TPS: ${bridge.tps||"—"} · ${bridge.serverState||"unknown"}`
                  :pinging?"Pinging...":pingData?.reachable===false?`Unreachable${pingData.note?` — ${pingData.note}`:""}`:pingData?.online?`Online · ${pingData.players}/${pingData.maxPlayers} players`:"Server offline"
                }
              </div>
              {pingData?.version&&<div className="mono" style={{fontSize:9,color:"rgba(57,255,20,.5)"}}>v{pingData.version}</div>}
            </div>
          </div>
          {!isLive&&<button className="neon-btn" onClick={()=>doPing(srv)} disabled={pinging} style={{fontSize:8,padding:"7px 16px",borderColor:"var(--green)",color:"var(--green)"}}>
            {pinging?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>:"⟳ PING"}
          </button>}
        </div>

        {/* STATUS ORB + INFO */}
        <div className="srv-grid" style={{display:"flex",gap:16,marginBottom:18,flexWrap:"wrap"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,flexShrink:0}}>
            <div style={{width:120,height:120,borderRadius:"50%",border:`3px solid ${isOnline?"var(--green)":"var(--red)"}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`radial-gradient(circle,${isOnline?"rgba(57,255,20,.12)":"rgba(255,68,68,.08)"} 0%,transparent 70%)`}}>
              <div style={{fontSize:28}}>{isOnline?"🟢":"🔴"}</div>
              <div className="orb" style={{fontSize:8,color:isOnline?"var(--green)":"var(--red)",letterSpacing:2,marginTop:4}}>{isOnline?"ONLINE":"OFFLINE"}</div>
            </div>
            {hasGrantedAccess?(
              <div style={{display:"flex",flexDirection:"column",gap:6,width:120}}>
                <button className="neon-btn" onClick={toggleStatus} disabled={saving} style={{fontSize:8,padding:"8px 16px",borderColor:isOnline?"var(--red)":"var(--green)",color:isOnline?"var(--red)":"var(--green)"}}>
                  {saving?"...":(isOnline?"⬛ STOP":"▶ START")}
                </button>
                {isLive&&isOnline&&<button className="neon-btn" onClick={()=>bridgeAction("restart")} disabled={saving} style={{fontSize:8,padding:"8px 16px",borderColor:"var(--cyan)",color:"var(--cyan)"}}>
                  🔄 RESTART
                </button>}
                {!isLive&&<div className="mono" style={{fontSize:7,color:"var(--dim)",textAlign:"center"}}>Bridge offline — status toggle only</div>}
                {!user?.isAdmin&&<div className="mono" style={{fontSize:7,color:"rgba(57,255,20,.4)",textAlign:"center"}}>✅ GRANTED ACCESS</div>}
              </div>
            ):myPendingReq?(
              <div style={{textAlign:"center",width:120}}>
                <div className="mono" style={{fontSize:8,color:"var(--amber)",lineHeight:1.6}}>⏳ REQUEST<br/>PENDING</div>
                <div className="mono" style={{fontSize:7,color:"var(--dim)",marginTop:4}}>Awaiting admin review</div>
              </div>
            ):(
              <div style={{textAlign:"center",width:120}}>
                {!showReqForm?(
                  <button className="neon-btn" onClick={()=>setShowReqForm(true)} style={{fontSize:7,padding:"7px 10px",borderColor:"var(--purple)",color:"var(--purple)",width:"100%"}}>
                    🔑 REQUEST<br/>ACCESS
                  </button>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:5}}>
                    <div className="mono" style={{fontSize:7,color:"var(--purple)",marginBottom:2}}>WHY DO YOU NEED ACCESS?</div>
                    <textarea value={reqMsg} onChange={e=>setReqMsg(e.target.value)} maxLength={120} placeholder="Brief reason..." style={{background:"rgba(180,77,255,.07)",border:"1px solid rgba(180,77,255,.3)",borderRadius:4,color:"var(--text)",fontFamily:"Share Tech Mono",fontSize:9,padding:"5px 7px",resize:"none",height:52,width:"100%",boxSizing:"border-box"}}/>
                    <button className="neon-btn" onClick={submitPowerReq} disabled={reqSending||!reqMsg.trim()} style={{fontSize:7,padding:"6px",borderColor:"var(--purple)",color:"var(--purple)"}}>{reqSending?"SENDING...":"SEND"}</button>
                    <button className="neon-btn" onClick={()=>setShowReqForm(false)} style={{fontSize:7,padding:"5px",borderColor:"var(--red)",color:"var(--red)"}}>CANCEL</button>
                  </div>
                )}
                <div className="mono" style={{fontSize:7,color:"var(--dim)",marginTop:4,lineHeight:1.5}}>Ask admin for<br/>start/stop access</div>
              </div>
            )}
          </div>

          <div style={{flex:1,minWidth:180}}>
            {editMode&&user?.isAdmin?(
              <div style={{display:"grid",gap:9}}>
                {[["ip","SERVER IP"],["port","PORT"],["version","VERSION"],["motd","MOTD"],["maxPlayers","MAX PLAYERS"],["discordLink","DISCORD LINK"],["dynmapLink","DYNMAP LINK"],["schedule","PLAY SCHEDULE"],["bridgeUrl","BRIDGE URL (Oracle daemon endpoint)"]].map(([k,l])=>(
                  <div key={k}><label className="si-label">{l}</label><input className="si" value={edit[k]||""} onChange={e=>setEdit(v=>({...v,[k]:e.target.value}))} placeholder={k==="bridgeUrl"?"e.g. https://your-oracle-vps.com:4000":""}/></div>
                ))}
                <div style={{display:"flex",gap:8}}>
                  <button className="neon-btn" onClick={saveEdit} disabled={saving} style={{fontSize:8,padding:"8px 14px",borderColor:"var(--green)",color:"var(--green)"}}>{saving?"...":"SAVE"}</button>
                  <button className="neon-btn" onClick={()=>setEditMode(false)} style={{fontSize:8,padding:"8px 14px",borderColor:"var(--red)",color:"var(--red)"}}>CANCEL</button>
                </div>
              </div>
            ):(
              <div>
                <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:2,marginBottom:10}}>SERVER INFORMATION</div>
                <div style={{display:"grid",gap:7}}>
                  {[
                    ["📍 IP",srv?.ip],
                    ["🔌 PORT",srv?.port],
                    ["🎮 VERSION",isLive?bridge.jarVersion:pingData?.version||srv?.version],
                    ["💬 MOTD",pingData?.motd||srv?.motd],
                    ["👥 PLAYERS",isLive?`${bridge.playerCount||0}/${bridge.maxPlayers||20} (bridge)`:pingData?.online?`${pingData.players}/${pingData.maxPlayers} (ping)`:`0/${srv?.maxPlayers||20}`],
                    ["⏰ SCHEDULE",srv?.schedule],
                    ["🔗 BRIDGE",srv?.bridgeUrl||"Not configured"],
                    ["⏱ CHANGED",srv?.lastChanged?new Date(srv.lastChanged).toLocaleString():"—"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",gap:8,alignItems:"baseline"}}>
                      <span className="mono" style={{fontSize:8,color:"rgba(57,255,20,.5)",minWidth:88}}>{l}</span>
                      <span className="mono" style={{fontSize:11,color:"var(--text)"}}>{v||"—"}</span>
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                  {user?.isAdmin&&<button className="neon-btn" onClick={()=>setEditMode(true)} style={{fontSize:8,padding:"7px 14px",borderColor:"var(--amber)",color:"var(--amber)"}}>✎ EDIT</button>}
                  {srv?.discordLink
                    ?<a href={srv.discordLink} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><button className="neon-btn" style={{fontSize:8,padding:"7px 14px",borderColor:"#5865F2",color:"#5865F2"}}>💬 DISCORD</button></a>
                    :<button className="neon-btn" disabled style={{fontSize:8,padding:"7px 14px",borderColor:"#5865F2",color:"#5865F2",opacity:.3}}>💬 DISCORD</button>
                  }
                  {srv?.dynmapLink
                    ?<a href={srv.dynmapLink} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><button className="neon-btn" style={{fontSize:8,padding:"7px 14px",borderColor:"var(--blue)",color:"var(--blue)"}}>🗺 LIVE MAP</button></a>
                    :<button className="neon-btn" disabled style={{fontSize:8,padding:"7px 14px",borderColor:"var(--blue)",color:"var(--blue)",opacity:.3}}>🗺 LIVE MAP</button>
                  }
                </div>
              </div>
            )}
          </div>
        </div>

        {/* JOIN STEPS */}
        <div style={{background:"rgba(57,255,20,.04)",border:"1px solid rgba(57,255,20,.14)",borderRadius:8,padding:"12px 16px",marginBottom:12}}>
          <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:3,marginBottom:8}}>▶ HOW TO JOIN</div>
          {[
            `1. Open Minecraft Java Edition → Multiplayer`,
            `2. Add Server — IP: ${srv?.ip||"..."} (Port: ${srv?.port||"25565"})`,
            `3. Version: ${srv?.version||"1.21.1"}`,
            `4. ${isOnline?"Server is ONLINE — click Join Server!":"Server is currently OFFLINE — check Discord for updates."}`,
          ].map((s,i)=>(
            <div key={i} className="mono" style={{fontSize:11,color:i===3?(isOnline?"var(--green)":"var(--red)"):"var(--dim)",lineHeight:1.7}}>{s}</div>
          ))}
        </div>

        {/* BRIDGE SETUP (admin only, shown when bridge not configured) */}
        {user?.isAdmin&&!srv?.bridgeUrl&&(
          <div style={{background:"rgba(0,245,255,.04)",border:"1px dashed rgba(0,245,255,.2)",borderRadius:8,padding:"14px 16px"}}>
            <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:6}}>🔌 CONNECT ORACLE BRIDGE</div>
            <div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.8}}>
              Deploy the NexSci daemon on your Oracle VPS, then set its URL above via ✎ EDIT. Once connected, start/stop/restart will be fully live from this panel.
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYERS — all registered users shown here
// ═══════════════════════════════════════════════════════════════════════════════
// ─── PLAYER PROFILE MODAL (draggable, banner, opens right, resets on close) ──
// ── Helper: parse "color:#f00;text-shadow:0 0 8px #f00" → React style object ──
function parseCssStr(cssStr){
  if(!cssStr||typeof cssStr!=="string")return{};
  const out={};
  cssStr.split(";").forEach(part=>{
    const idx=part.indexOf(":");
    if(idx<0)return;
    const prop=part.slice(0,idx).trim();
    const val=part.slice(idx+1).trim();
    if(!prop||!val)return;
    const camel=prop.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    out[camel]=val;
  });
  return out;
}

function PlayerProfileModal({player,status,rep,survey,achs,onClose}){
  const sp={username:"",bio:"",fav1:"",fav2:"",fav3:"",discord:"",joinDate:null,isAdmin:false,role:"Player",...(player||{})};
  const st={status:"offline",activity:"Status not set",updatedAt:null,...(status||{})};
  const safeAchs=Array.isArray(achs)?achs:[];
  const favs=[sp.fav1,sp.fav2,sp.fav3].filter(f=>typeof f==="string"&&f.trim().length>0);
  const surveyFields=(survey!=null&&survey.responses!=null)?[["PvP",survey.responses.pvp],["Daily Time",survey.responses.hours],["Voice Chat",survey.responses.voice],["Time Zone",survey.responses.tz],["Version",survey.responses.version]].filter(([,v])=>v!=null&&String(v).trim().length>0):[];
  const statusColor=SC[st.status]||"#555";
  const initX=Math.max(0,(window.innerWidth-610)/2);
  const initY=Math.max(44,(window.innerHeight-620)/2);
  const{pos,dragging,startDrag}=useDraggable({x:initX,y:initY});
  const[banner,setBanner]=useState(null);
  const[copied,setCopied]=useState(false);
  const[cosmetics,setCosmetics]=useState({unlocked:[],equipped:{}});
  const[cosmDB,setCosmDB]=useState(COSMETICS_DEFAULT);
  const[potw,setPotw]=useState(null);

  useEffect(()=>{
    DB.getUserBanner(sp.username).then(b=>{if(b)setBanner(b);});
    DB.getCosmetics(sp.username).then(c=>setCosmetics(c||{unlocked:[],equipped:{}}));
    DB.getAllCosmetics().then(c=>{if(c)setCosmDB(c);});
    DB.getPOTW().then(p=>setPotw(p));
  },[sp.username]);

  const eq=cosmetics.equipped||{};
  const equippedBorder=(cosmDB.borders||[]).find(b=>b.id===eq.borders)||null;
  const equippedName=(cosmDB.nameEffects||[]).find(n=>n.id===eq.nameEffects)||null;
  const equippedTitle=(cosmDB.titles||[]).find(t=>t.id===eq.titles)||null;
  const equippedKill=(cosmDB.killStyles||[]).find(k=>k.id===eq.killStyles)||null;
  const isPotw=potw&&potw.username===sp.username&&new Date(potw.expiresAt)>new Date();
  const nameTextStyle=equippedName?.css?parseCssStr(equippedName.css):{};
  const accentColor=isPotw?"#fbbf24":(equippedTitle?.color||statusColor);
  const RARITY_COLOR={common:"var(--dim)",uncommon:"var(--green)",rare:"var(--cyan)",epic:"var(--purple)",legendary:"var(--amber)"};

  // Build avatar border: POTW > cosmetic border > status color
  let avatarStyle={};
  if(isPotw){
    avatarStyle={border:"2px solid rgba(251,191,36,.9)",boxShadow:"0 0 0 3px #010812,0 0 22px rgba(251,191,36,.6),0 0 45px rgba(251,191,36,.2)"};
  }else if(equippedBorder?.css){
    const bColor=equippedBorder.css.split(" ").pop();
    avatarStyle={border:equippedBorder.css,boxShadow:`0 0 0 3px #010812,0 0 18px ${bColor}55`};
  }else{
    avatarStyle={border:`3px solid ${statusColor}`,boxShadow:`0 0 22px ${statusColor}55,0 0 0 3px #010812`};
  }

  const relTime=iso=>{if(!iso)return null;const m=Math.floor((Date.now()-new Date(iso).getTime())/60000);if(m<1)return"just now";if(m<60)return`${m}m ago`;const h=Math.floor(m/60);if(h<24)return`${h}h ago`;return`${Math.floor(h/24)}d ago`;};
  const memberSince=iso=>{if(!iso)return null;const days=Math.floor((Date.now()-new Date(iso).getTime())/86400000);if(days<1)return"Today";if(days<30)return`${days}d`;if(days<365)return`${Math.floor(days/30)}mo`;return`${Math.floor(days/365)}y`;};
  const copyUsername=()=>{navigator.clipboard?.writeText(sp.username).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);});};
  const playerAchs=safeAchs.filter(a=>Array.isArray(a.awardedTo)&&a.awardedTo.includes(sp.username));

  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:9000,pointerEvents:"none"}}>
      <div className="glass" style={{
        width:"min(97vw,610px)",position:"absolute",left:pos.x,top:pos.y,
        maxHeight:"min(88vh,88dvh)",display:"flex",flexDirection:"column",
        animation:"profileIn .34s cubic-bezier(.22,1,.36,1)",
        border:`1px solid ${accentColor}44`,
        boxShadow:`0 0 0 1px ${accentColor}18,0 32px 100px rgba(0,0,0,.9),0 0 80px ${accentColor}12`,
        userSelect:dragging?"none":"auto",
        padding:0,overflow:"hidden",pointerEvents:"auto",
      }} onClick={e=>e.stopPropagation()}>

        {/* BANNER drag handle */}
        <div className="profile-banner-wrap" onMouseDown={startDrag} style={{cursor:dragging?"grabbing":"grab",flexShrink:0,position:"relative"}}>
          {banner
            ?<img src={banner} className="profile-banner" alt="banner" onError={()=>setBanner(null)}/>
            :<div className="profile-banner" style={{background:`linear-gradient(135deg,rgba(0,8,22,1) 0%,${accentColor}20 40%,rgba(20,0,40,.9) 70%,rgba(0,10,25,1) 100%)`,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",inset:0,backgroundImage:`linear-gradient(${accentColor}09 1px,transparent 1px),linear-gradient(90deg,${accentColor}09 1px,transparent 1px)`,backgroundSize:"22px 22px"}}/>
              <div style={{position:"absolute",bottom:8,right:14,fontFamily:"Orbitron",fontSize:7,color:`${accentColor}55`,letterSpacing:3}}>NEXSCI SMP v10.0</div>
            </div>
          }
          {isPotw&&(
            <div style={{position:"absolute",top:8,left:10,display:"flex",alignItems:"center",gap:6,background:"linear-gradient(135deg,rgba(251,191,36,.25),rgba(180,77,255,.15))",border:"1px solid rgba(251,191,36,.5)",borderRadius:6,padding:"4px 10px",backdropFilter:"blur(8px)"}}>
              <span style={{fontSize:14,animation:"crownBounce 2s ease-in-out infinite",display:"inline-block"}}>👑</span>
              <div>
                <div style={{fontFamily:"Orbitron",fontSize:7,color:"#fbbf24",letterSpacing:2}}>PLAYER OF THE WEEK</div>
                {potw.reason&&<div style={{fontFamily:"Share Tech Mono",fontSize:8,color:"rgba(251,191,36,.7)",marginTop:1}}>{potw.reason}</div>}
              </div>
            </div>
          )}
          <div style={{position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",display:"flex",gap:3,opacity:.3,pointerEvents:"none"}}>
            {[0,1,2,3,4].map(i=><div key={i} style={{width:3,height:3,borderRadius:"50%",background:"#fff"}}/>)}
          </div>
          <button onClick={onClose} className="close-btn" style={{position:"absolute",top:8,right:8,zIndex:10}}>✕</button>
        </div>

        {/* PFP overlapping banner — outside scroll so overflow:hidden on glass doesn't clip it */}
        <div style={{position:"relative",marginTop:-54,paddingLeft:18,flexShrink:0,zIndex:2}}>
          <div style={{position:"relative",display:"inline-block"}}>
            <div style={{width:108,height:108,borderRadius:13,overflow:"hidden",background:"#010812",...avatarStyle}}>
              <MCAvatar username={sp.username} size={108} style={{width:108,height:108,borderRadius:10}}/>
            </div>
            <div style={{position:"absolute",bottom:5,right:5,width:16,height:16,borderRadius:"50%",background:statusColor,border:"3px solid #010812",boxShadow:`0 0 12px ${statusColor}`,animation:st.status!=="offline"?"pulseDot 2s ease-in-out infinite":"none"}}/>
            {isPotw&&<div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",fontSize:20,animation:"crownBounce 2s ease-in-out infinite",display:"inline-block",filter:"drop-shadow(0 0 6px rgba(251,191,36,.8))"}}>👑</div>}
          </div>
        </div>

        {/* SCROLLABLE BODY */}
        <div style={{overflowY:"auto",flex:1,minHeight:0}}>

          {/* IDENTITY */}
          <div style={{padding:"5px 18px 0",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
            <div style={{minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                <div className="orb" style={{fontSize:15,color:"#fff",letterSpacing:2,...nameTextStyle}}>{sp.username}</div>
                {sp.isAdmin&&<span style={{fontSize:7,color:"var(--orange)",fontFamily:"Orbitron",padding:"2px 7px",border:"1px solid rgba(249,115,22,.4)",borderRadius:3,background:"rgba(249,115,22,.08)",letterSpacing:1}}>★ ADMIN</span>}
                {equippedTitle&&<span style={{fontFamily:"Orbitron",fontSize:7,padding:"2px 8px",border:`1px solid ${equippedTitle.color}66`,borderRadius:3,background:`${equippedTitle.color}14`,color:equippedTitle.color,letterSpacing:1}}>{equippedTitle.icon} {equippedTitle.name}</span>}
                {isPotw&&<span style={{fontFamily:"Orbitron",fontSize:7,padding:"2px 8px",border:"1px solid rgba(251,191,36,.5)",borderRadius:3,background:"rgba(251,191,36,.12)",color:"#fbbf24",letterSpacing:1,animation:"crownBounce 2s ease-in-out infinite",display:"inline-block"}}>👑 POTW</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span className="mono" style={{fontSize:10,color:statusColor}}>{STATUS_EMOJI[st.status]||"⚫"} {SL[st.status]||"OFFLINE"}</span>
                {sp.discord&&<span className="mono" style={{fontSize:9,color:"rgba(114,137,218,.8)"}}># {sp.discord}</span>}
              </div>
            </div>
            <button className="copy-btn" onClick={copyUsername} style={{marginTop:4,flexShrink:0,color:copied?"var(--green)":"",borderColor:copied?"rgba(57,255,20,.4)":""}}>{copied?"✓ COPIED":"⎘ COPY"}</button>
          </div>

          {/* STATS PILLS */}
          <div style={{padding:"8px 18px 0",display:"flex",gap:6,flexWrap:"wrap"}}>
            {[
              {l:"REP",v:`⭐ ${rep}`,c:"var(--amber)"},
              {l:"ACHIEVEMENTS",v:`🏅 ${playerAchs.length}`,c:"var(--purple)"},
              ...(sp.joinDate?[{l:"MEMBER",v:`🗓 ${memberSince(sp.joinDate)}`,c:"var(--cyan)"}]:[]),
              ...(st.updatedAt&&st.status!=="offline"?[{l:"LAST SEEN",v:relTime(st.updatedAt),c:statusColor}]:[]),
              ...(isPotw?[{l:"HONOUR",v:"👑 POTW",c:"#fbbf24"}]:[]),
            ].map((s,i)=>(
              <div key={i} style={{padding:"4px 9px",background:"rgba(0,245,255,.03)",border:"1px solid rgba(0,245,255,.07)",borderRadius:5}}>
                <div className="mono" style={{fontSize:6,color:"var(--dim)",letterSpacing:1,marginBottom:1}}>{s.l}</div>
                <div className="mono" style={{fontSize:10,color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>

          <div style={{margin:"10px 18px 0",height:1,background:`linear-gradient(to right,${accentColor}55,rgba(180,77,255,.25),transparent)`}}/>

          {/* POTW REASON BOX */}
          {isPotw&&(
            <div style={{margin:"10px 18px 0",padding:"10px 14px",background:"linear-gradient(135deg,rgba(251,191,36,.07),rgba(180,77,255,.04))",border:"1px solid rgba(251,191,36,.3)",borderRadius:8,display:"flex",gap:10,alignItems:"flex-start"}}>
              <span style={{fontSize:20,flexShrink:0}}>👑</span>
              <div>
                <div style={{fontFamily:"Orbitron",fontSize:8,color:"#fbbf24",letterSpacing:2,marginBottom:3}}>PLAYER OF THE WEEK</div>
                {potw.reason&&<div style={{fontFamily:"Share Tech Mono",fontSize:10,color:"rgba(251,191,36,.85)",lineHeight:1.6}}>{potw.reason}</div>}
                {potw.expiresAt&&<div style={{fontFamily:"Share Tech Mono",fontSize:8,color:"rgba(251,191,36,.4)",marginTop:4}}>Expires {new Date(potw.expiresAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div>}
              </div>
            </div>
          )}

          {/* BODY GRID */}
          <div style={{padding:"10px 18px 4px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{padding:"8px 11px",background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.09)",borderRadius:7}}>
                <div className="mono" style={{fontSize:7,color:"rgba(0,245,255,.45)",letterSpacing:2,marginBottom:3}}>CURRENTLY</div>
                <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.5}}>{st.activity||"Status not set"}</div>
              </div>
              <div style={{padding:"8px 11px",background:"rgba(0,245,255,.02)",border:"1px solid rgba(0,245,255,.07)",borderRadius:7,borderLeft:"3px solid rgba(0,245,255,.17)",flex:1}}>
                <div className="mono" style={{fontSize:7,color:"rgba(0,245,255,.4)",letterSpacing:2,marginBottom:4}}>ABOUT</div>
                <div className="mono" style={{fontSize:10,color:sp.bio?"var(--text)":"rgba(0,245,255,.18)",lineHeight:1.7,fontStyle:sp.bio?"normal":"italic"}}>{sp.bio||"No bio set yet."}</div>
              </div>
              {playerAchs.length>0&&(
                <div style={{padding:"6px 9px",background:"rgba(251,191,36,.03)",border:"1px solid rgba(251,191,36,.1)",borderRadius:6}}>
                  <div className="mono" style={{fontSize:7,color:"rgba(251,191,36,.5)",letterSpacing:2,marginBottom:4}}>ACHIEVEMENTS</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {playerAchs.slice(0,8).map(a=><span key={a.id} title={a.name} style={{fontSize:15,cursor:"default"}}>{a.icon}</span>)}
                    {playerAchs.length>8&&<span className="mono" style={{fontSize:9,color:"var(--amber)",alignSelf:"center"}}>+{playerAchs.length-8}</span>}
                  </div>
                </div>
              )}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {favs.length>0&&(
                <div>
                  <div className="mono" style={{fontSize:7,color:"rgba(180,77,255,.5)",letterSpacing:2,marginBottom:4}}>FAVOURITE THINGS</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {favs.map((f,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:7,padding:"5px 9px",background:"rgba(180,77,255,.05)",border:"1px solid rgba(180,77,255,.1)",borderRadius:5}}>
                        <span style={{color:"var(--purple)",fontSize:9,flexShrink:0}}>♦</span>
                        <span className="mono" style={{fontSize:9,color:"var(--text)"}}>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {surveyFields.length>0&&(
                <div>
                  <div className="mono" style={{fontSize:7,color:"rgba(59,130,246,.5)",letterSpacing:2,marginBottom:4}}>PLAY PROFILE</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                    {surveyFields.map(([k,v])=>(
                      <div key={k} style={{padding:"5px 8px",background:"rgba(59,130,246,.04)",border:"1px solid rgba(59,130,246,.1)",borderRadius:5}}>
                        <div className="mono" style={{fontSize:6,color:"rgba(59,130,246,.45)",letterSpacing:1,marginBottom:1}}>{k.toUpperCase()}</div>
                        <div className="mono" style={{fontSize:9,color:"var(--text)"}}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {favs.length===0&&surveyFields.length===0&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1,minHeight:50}}>
                  <div className="mono" style={{fontSize:9,color:"rgba(0,245,255,.12)",textAlign:"center",fontStyle:"italic"}}>No extra data yet.</div>
                </div>
              )}
              {sp.joinDate&&<div className="mono" style={{fontSize:7,color:"var(--dim)",marginTop:"auto"}}>🗓 Joined {new Date(sp.joinDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>}
            </div>
          </div>

          {/* EQUIPPED COSMETICS STRIP */}
          {(equippedBorder||equippedName||equippedTitle||equippedKill)&&(
            <div style={{margin:"8px 18px 16px",padding:"10px 14px",background:"rgba(180,77,255,.04)",border:"1px solid rgba(180,77,255,.18)",borderRadius:8}}>
              <div style={{fontFamily:"Orbitron",fontSize:7,color:"var(--purple)",letterSpacing:2,marginBottom:8}}>🎭 EQUIPPED COSMETICS</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[
                  equippedBorder&&{label:"BORDER",item:equippedBorder},
                  equippedName&&{label:"NAME FX",item:equippedName},
                  equippedTitle&&{label:"TITLE",item:equippedTitle},
                  equippedKill&&{label:"KILL STYLE",item:equippedKill},
                ].filter(Boolean).map(({label,item})=>(
                  <div key={label} style={{padding:"5px 10px",background:"rgba(0,0,0,.3)",border:`1px solid ${RARITY_COLOR[item.rarity]||"var(--dim)"}44`,borderRadius:6,display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:13}}>{item.icon}</span>
                    <div>
                      <div style={{fontFamily:"Share Tech Mono",fontSize:7,color:"var(--dim)",letterSpacing:1}}>{label}</div>
                      <div style={{fontFamily:"Orbitron",fontSize:8,color:RARITY_COLOR[item.rarity]||"var(--text)",letterSpacing:1}}>{item.name}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{height:4}}/>
        </div>
      </div>
    </div>,
    document.body
  );
}


// ─── REPUTATION ROW (proper component, no IIFE) ───────────────────────────────
function ReputationRow({rep,hasEndorsed,canEndorse,onEndorse}){
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:8,paddingTop:6,borderTop:"1px solid rgba(0,245,255,.06)"}}>
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <span style={{color:"var(--amber)",fontSize:11}}>⭐</span>
        <span className="mono" style={{fontSize:9,color:"var(--amber)"}}>{rep} rep</span>
      </div>
      {canEndorse&&(
        <button type="button" onClick={async e=>{e.stopPropagation();await onEndorse();}}
          style={{fontFamily:"Share Tech Mono",fontSize:8,padding:"3px 9px",borderRadius:4,cursor:"pointer",transition:"all .2s",
            background:hasEndorsed?"rgba(251,191,36,.15)":"rgba(0,245,255,.04)",
            border:`1px solid ${hasEndorsed?"rgba(251,191,36,.5)":"rgba(0,245,255,.15)"}`,
            color:hasEndorsed?"var(--amber)":"var(--dim)"}}>
          {hasEndorsed?"★ ENDORSED":"☆ ENDORSE"}
        </button>
      )}
    </div>
  );
}

function PlayersPanel({onClose,user}){
  const[statuses,setStatuses]=useState({});
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[selectedPlayer,setSelectedPlayer]=useState(null);
  const[surveys,setSurveys]=useState([]);
  const[achs,setAchs]=useState([]);
  // ── Cosmetics + POTW for cards ──────────────────────────────────────────────
  const[allCosmetics,setAllCosmetics]=useState({});// {username:{unlocked:[],equipped:{}}}
  const[cosmDB,setCosmDB]=useState(COSMETICS_DEFAULT);
  const[potwPlayer,setPotwPlayer]=useState(null);

  useEffect(()=>{DB.getSurveys().then(setSurveys);DB.getAchievements().then(setAchs);DB.getAllCosmetics().then(c=>{if(c)setCosmDB(c);});DB.getPOTW().then(p=>setPotwPlayer(p));},[]);

  useEffect(()=>{
    const load=async()=>{
      const[us,st]=await Promise.all([DB.getUsers(),DB.getPlayerStatus()]);
      setUsers(us);setStatuses(st);setLoading(false);
      // load cosmetics for all players in parallel
      const cosms={};
      await Promise.all(us.map(async u=>{
        const c=await DB.getCosmetics(u.username);
        if(c)cosms[u.username]=c;
      }));
      setAllCosmetics(cosms);
    };
    load();const t=setInterval(async()=>{const[us,st]=await Promise.all([DB.getUsers(),DB.getPlayerStatus()]);setUsers(us);setStatuses(st);},6000);
    return()=>clearInterval(t);
  },[]);

  const _pd={bio:"",fav1:"",fav2:"",fav3:"",discord:"",joinDate:null};
  const allPlayers=[
    {..._pd,username:"AdminOP",role:"Admin",isAdmin:true},
    ...users.map(u=>({..._pd,...u,role:u.role||"Player",isAdmin:false}))
  ];

  const onlineCount=allPlayers.filter(p=>{const s=statuses[p.username];return s?.status==="online"||s?.status==="busy";}).length;

  return(
    <Panel title="PLAYER SYSTEMS" subtitle={`LIVE STATUS · ${onlineCount} ACTIVE · ${allPlayers.length} TOTAL`} color="var(--cyan)" onClose={onClose} wide>
      <div style={{marginBottom:12,padding:"8px 12px",background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.1)",borderRadius:6}}>
        <div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.6}}>💡 Click any card to see full profile. Set your status via <span style={{color:"var(--cyan)"}}>📊 STATUS</span> in the top bar. Auto-refreshes every 6s.</div>
      </div>

      {selectedPlayer&&(
        <PlayerProfileModal
          key={selectedPlayer.username}
          player={selectedPlayer}
          status={statuses[selectedPlayer.username]||{status:"offline",activity:"Status not set"}}
          rep={statuses[selectedPlayer.username]?.rep||0}
          survey={surveys.find(s=>s.username===selectedPlayer.username)||null}
          achs={achs}
          onClose={()=>setSelectedPlayer(null)}
        />
      )}
      {loading
        ?<div style={{textAlign:"center",padding:"40px 0"}}><div className="mono" style={{color:"var(--dim)"}}>LOADING...</div></div>
        :allPlayers.length<=1
          ?<div style={{textAlign:"center",padding:"50px 0"}}>
            <div style={{fontSize:32,marginBottom:10}}>👾</div>
            <div className="mono" style={{fontSize:11,color:"var(--dim)"}}>NO PLAYERS REGISTERED YET.<br/>Sign up to appear here!</div>
          </div>
          :<div className="player-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(290px,1fr))",gap:14,maxHeight:"68vh",overflowY:"auto",paddingRight:4}}>
            {allPlayers.map(p=>{
              const st=statuses[p.username]||{status:"offline",activity:"Status not set"};
              const stColor=SC[st.status]||"#555";
              // resolve cosmetics for this player
              const pc=allCosmetics[p.username]||{equipped:{}};
              const eq=pc.equipped||{};
              const eqBorder=(cosmDB.borders||[]).find(b=>b.id===eq.borders)||null;
              const eqName=(cosmDB.nameEffects||[]).find(n=>n.id===eq.nameEffects)||null;
              const eqTitle=(cosmDB.titles||[]).find(t=>t.id===eq.titles)||null;
              const isPotw=potwPlayer&&potwPlayer.username===p.username&&new Date(potwPlayer.expiresAt)>new Date();
              const nameStyle=eqName?.css?parseCssStr(eqName.css):{};
              // card border: POTW > cosmetic border > status
              let cardBorderColor=stColor+"33";
              if(eqBorder?.css){const c=eqBorder.css.split(" ").pop();cardBorderColor=c+"aa";}
              if(isPotw)cardBorderColor="rgba(251,191,36,.6)";
              return(
                <div className="pcard" key={p.username} style={{cursor:"pointer",position:"relative",borderColor:cardBorderColor,boxShadow:isPotw?"0 0 18px rgba(251,191,36,.18)":eqBorder?"0 0 12px rgba(0,245,255,.08)":undefined}} onClick={()=>setSelectedPlayer(sp=>sp?.username===p.username?null:p)}>
                  {/* POTW crown badge — top right */}
                  {isPotw&&(
                    <div style={{position:"absolute",top:-8,right:10,background:"linear-gradient(135deg,#fbbf24,#f97316)",borderRadius:"10px 10px 6px 6px",padding:"2px 8px",display:"flex",alignItems:"center",gap:4,boxShadow:"0 2px 12px rgba(251,191,36,.4)"}}>
                      <span style={{fontSize:10,animation:"crownBounce 2s ease-in-out infinite",display:"inline-block"}}>👑</span>
                      <span style={{fontFamily:"Orbitron",fontSize:6,color:"#fff",letterSpacing:1}}>POTW</span>
                    </div>
                  )}
                  {/* HEADER ROW */}
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <div style={{position:"relative",flexShrink:0}}>
                      <MCAvatar username={p.username} size={42} style={{
                        border:isPotw?"2px solid rgba(251,191,36,.9)":eqBorder?.css?eqBorder.css:`2px solid ${stColor}44`,
                        boxShadow:isPotw?"0 0 10px rgba(251,191,36,.5)":eqBorder?.css?`0 0 8px ${eqBorder.css.split(" ").pop()}44`:undefined,
                        borderRadius:6,
                      }}/>
                      <div style={{position:"absolute",bottom:-2,right:-2,width:10,height:10,borderRadius:"50%",background:stColor,border:"2px solid #010812",boxShadow:`0 0 6px ${stColor}`,animation:st.status!=="offline"?"pulseDot 2s ease-in-out infinite":"none"}}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                        <div className="orb" style={{fontSize:10,letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",...(eqName?nameStyle:{color:"#fff"})}}>{p.username}</div>
                        {p.isAdmin&&<span style={{fontSize:7,color:"var(--orange)",fontFamily:"Orbitron"}}>★</span>}
                        {isPotw&&<span style={{fontSize:10,animation:"crownBounce 2s ease-in-out infinite",display:"inline-block"}}>👑</span>}
                      </div>
                      {/* Title badge */}
                      {eqTitle&&<div style={{marginTop:2}}><span style={{fontFamily:"Orbitron",fontSize:6,padding:"1px 6px",borderRadius:3,background:`${eqTitle.color}18`,border:`1px solid ${eqTitle.color}55`,color:eqTitle.color,letterSpacing:1}}>{eqTitle.icon} {eqTitle.name}</span></div>}
                      <span className="mono" style={{fontSize:9,color:stColor,letterSpacing:1}}>{STATUS_EMOJI[st.status]||"⚫"} {SL[st.status]||"OFFLINE"}</span>
                    </div>
                  </div>
                  {/* CURRENT ACTIVITY */}
                  <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.5,borderTop:"1px solid rgba(0,245,255,.07)",paddingTop:8,marginBottom:6}}>
                    <span style={{color:"rgba(0,245,255,.4)"}}>DOING › </span>{st.activity||"Status not set"}
                  </div>
                  {/* BIO */}
                  {p.bio&&<div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.6,marginBottom:6,padding:"6px 8px",background:"rgba(0,245,255,.03)",borderRadius:5,borderLeft:"2px solid rgba(0,245,255,.2)"}}>{p.bio}</div>}
                  {/* FAVOURITES */}
                  {(p.fav1||p.fav2||p.fav3)&&(
                    <div style={{marginBottom:6}}>
                      <div className="mono" style={{fontSize:7,color:"rgba(0,245,255,.35)",letterSpacing:2,marginBottom:4}}>FAVOURITE THINGS</div>
                      <div style={{display:"flex",flexDirection:"column",gap:3}}>
                        {[p.fav1,p.fav2,p.fav3].filter(Boolean).map((f,i)=>(
                          <div key={i} className="mono" style={{fontSize:9,color:"var(--text)",display:"flex",alignItems:"center",gap:5}}>
                            <span style={{color:"var(--cyan)",fontSize:8}}>♦</span>{f}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* JOIN DATE */}
                  {p.joinDate&&<div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:4}}>Joined {new Date(p.joinDate).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>}
                  {/* REPUTATION */}
                  <ReputationRow
                    username={p.username}
                    isAdmin={p.isAdmin}
                    rep={statuses[p.username]?.rep||0}
                    hasEndorsed={!!(user&&(statuses[p.username]?.endorsedBy||[]).includes(user.username))}
                    canEndorse={!!(user&&user.username!==p.username&&!p.isAdmin)}
                    onEndorse={async()=>{
                      const ps=await DB.getPlayerStatus();
                      const cur=ps[p.username]||{};
                      const endorsed=cur.endorsedBy||[];
                      const already=endorsed.includes(user.username);
                      const newEndorsed=already?endorsed.filter(x=>x!==user.username):[...endorsed,user.username];
                      const updated={...ps,[p.username]:{...cur,endorsedBy:newEndorsed,rep:newEndorsed.length}};
                      await DB.setPlayerStatus(updated);
                      setStatuses(updated);
                    }}
                  />
                  {/* CLICK HINT */}
                  <div className="mono" style={{fontSize:7,color:"rgba(0,245,255,.2)",marginTop:4,textAlign:"right"}}>click for full profile ›</div>
                </div>
              );
            })}
          </div>
      }
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LEADERBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function LeaderboardPanel({onClose,user}){
  const[board,setBoard]=useState([]);
  const[loading,setLoading]=useState(true);
  const[sortBy,setSortBy]=useState("kills");
  useEffect(()=>{DB.getLeaderboard().then(b=>{setBoard(b);setLoading(false);});},[]);

  const STATS=["kills","deaths","diamonds","playtime","builds"];
  const STAT_LABELS={kills:"⚔ Kills",deaths:"💀 Deaths",diamonds:"💎 Diamonds",playtime:"⏱ Hours",builds:"🏗 Builds"};
  const MEDALS=["🥇","🥈","🥉"];

  const sorted=[...board].sort((a,b)=>(b[sortBy]||0)-(a[sortBy]||0));

  return(
    <Panel title="LEADERBOARD" subtitle="PLAYER STATS · RANKING SYSTEM" color="var(--amber)" onClose={onClose} wide>
      <div style={{display:"flex",gap:7,marginBottom:16,flexWrap:"wrap"}}>
        {STATS.map(s=><button key={s} onClick={()=>setSortBy(s)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"6px 12px",borderRadius:5,cursor:"pointer",background:sortBy===s?"rgba(251,191,36,.2)":"transparent",border:`1px solid ${sortBy===s?"var(--amber)":"rgba(251,191,36,.15)"}`,color:sortBy===s?"var(--amber)":"var(--dim)",transition:"all .2s"}}>{STAT_LABELS[s]}</button>)}
      </div>
      {loading?<div style={{textAlign:"center",padding:"40px 0"}}><div className="mono" style={{color:"var(--dim)"}}>LOADING...</div></div>
      :board.length===0?<div style={{textAlign:"center",padding:"50px 0"}}><div style={{fontSize:32,marginBottom:10}}>🏆</div><div className="mono" style={{fontSize:11,color:"var(--dim)"}}>No stats yet. Admin adds stats via Admin Panel → Leaderboard.</div></div>
      :(
        <div style={{maxHeight:"60vh",overflowY:"auto"}}>
          {/* TOP 3 */}
          {sorted.length>=1&&(
            <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:20,flexWrap:"wrap"}}>
              {[1,0,2].map(ri=>{
                const p=sorted[ri];if(!p)return null;
                const h=[160,200,140][ri];
                return(
                  <div key={ri} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"14px 18px",borderRadius:10,background:`rgba(251,191,36,${[0.05,0.12,0.04][ri]})`,border:`1px solid rgba(251,191,36,${[0.15,0.35,0.12][ri]})`,minWidth:100}}>
                    <div style={{fontSize:[22,28,20][ri]}}>{MEDALS[ri]}</div>
                    <MCAvatar username={p.username} size={[38,48,34][ri]}/>
                    <div className="orb" style={{fontSize:[8,10,7][ri],color:"var(--amber)",letterSpacing:1,textAlign:"center"}}>{p.username}</div>
                    <div className="orb" style={{fontSize:[11,14,10][ri],color:"#fff"}}>{p[sortBy]||0}</div>
                    <div className="mono" style={{fontSize:7,color:"var(--dim)"}}>{STAT_LABELS[sortBy].replace(/[^ ]+ /,"")}</div>
                  </div>
                );
              })}
            </div>
          )}
          {/* FULL TABLE */}
          <div style={{border:"1px solid rgba(251,191,36,.14)",borderRadius:8,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",padding:"7px 14px",background:"rgba(251,191,36,.07)"}}>
              <span style={{width:30,fontSize:8,fontFamily:"Orbitron",color:"var(--amber)"}}>#</span>
              <span style={{flex:1,fontSize:8,fontFamily:"Orbitron",color:"var(--amber)",letterSpacing:1}}>PLAYER</span>
              {STATS.map(s=><span key={s} style={{width:60,textAlign:"right",fontSize:7,fontFamily:"Orbitron",color:sortBy===s?"var(--amber)":"var(--dim)",letterSpacing:1}}>{s.toUpperCase()}</span>)}
            </div>
            {sorted.map((p,i)=>(
              <div key={p.username} className="lb-row">
                <span style={{width:30,fontFamily:"Orbitron",fontSize:9,color:i<3?"var(--amber)":"var(--dim)"}}>{i+1}</span>
                <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}>
                  <MCAvatar username={p.username} size={26}/>
                  <span className="orb" style={{fontSize:9,color:i===0?"var(--amber)":"var(--text)"}}>{p.username}</span>
                </div>
                {STATS.map(s=><span key={s} className="mono" style={{width:60,textAlign:"right",fontSize:10,color:sortBy===s?"var(--text)":"var(--dim)"}}>{p[s]||0}</span>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WAR LOGS
// ═══════════════════════════════════════════════════════════════════════════════
function WarsPanel({onClose}){
  const[season,setSeason]=useState(1);
  const[wars,setWars]=useState([]);
  const[seasons,setSeasons]=useState([]);
  useEffect(()=>{DB.getWars().then(setWars);DB.getSeasons().then(setSeasons);},[]);
  const maxS=Math.max(2,...seasons.map(s=>s.num));
  const logs=wars.filter(w=>!w.season||w.season===season||(season===1&&!w.season));
  return(
    <Panel title="WAR LOGS" subtitle="CONFLICT HISTORY · TACTICAL ARCHIVE" color="var(--red)" onClose={onClose} wide>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {Array.from({length:maxS},(_,i)=>i+1).map(s=><button key={s} onClick={()=>setSeason(s)} style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:2,padding:"7px 16px",borderRadius:5,cursor:"pointer",background:season===s?"rgba(255,68,68,.2)":"transparent",border:`1px solid ${season===s?"var(--red)":"rgba(255,68,68,.2)"}`,color:season===s?"var(--red)":"var(--dim)",transition:"all .2s"}}>SEASON {s}</button>)}
      </div>
      <div style={{maxHeight:"60vh",overflowY:"auto"}}>
        {logs.length===0
          ?<div style={{textAlign:"center",padding:"52px 0"}}><div style={{fontSize:30,marginBottom:10}}>📭</div><div className="mono" style={{fontSize:11,color:"var(--dim)"}}>NO WAR RECORDS FOR THIS SEASON</div></div>
          :logs.map((w,i)=>(
            <div className="war-entry" key={w.id} style={{animationDelay:`${i*.09}s`,animationFillMode:"both"}}>
              <div className="war-header" style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <div><div className="orb" style={{fontSize:11,color:"#fff",letterSpacing:1,marginBottom:3}}>{w.title}</div><div className="mono" style={{fontSize:9,color:"rgba(255,68,68,.5)",letterSpacing:2}}>{w.date}</div></div>
                <span style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:2,padding:"4px 10px",borderRadius:4,background:w.winner===-1?"rgba(251,191,36,.15)":"rgba(57,255,20,.1)",border:`1px solid ${w.winner===-1?"var(--amber)":"var(--green)"}`,color:w.winner===-1?"var(--amber)":"var(--green)",flexShrink:0}}>{w.outcome}</span>
              </div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:8}}>
                {w.teams.map((t,ti)=><span key={ti} className="mono" style={{fontSize:10,padding:"3px 9px",borderRadius:3,background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.2)",color:"#ff8888"}}>⚔ {t}</span>)}
              </div>
              <div className="mono" style={{fontSize:11,color:"var(--dim)",lineHeight:1.5}}>{w.notes}</div>
            </div>
          ))
        }
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SEASONS
// ═══════════════════════════════════════════════════════════════════════════════
function SeasonsPanel({onClose}){
  const[sel,setSel]=useState(null);
  const[seasons,setSeasons]=useState([]);
  useEffect(()=>{DB.getSeasons().then(setSeasons);},[]);
  if(sel)return(
    <Panel title={`SEASON ${sel.num} ARCHIVE`} subtitle={sel.tagline?.toUpperCase()} color="var(--purple)" onClose={()=>setSel(null)}>
      <div style={{maxHeight:"66vh",overflowY:"auto"}}>
        {[["ACHIEVEMENTS",sel.achievements],["MAJOR EVENTS",sel.events],["NOTABLE BUILDS",sel.builds]].map(([t,items])=>(
          <div key={t} style={{marginBottom:18}}>
            <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:3,marginBottom:9}}>{t}</div>
            {(items||[]).map((item,i)=><div key={i} className="rule-item" style={{borderColor:"rgba(180,77,255,.4)"}}><span style={{color:"rgba(180,77,255,.5)"}}>◆ </span>{item}</div>)}
          </div>
        ))}
      </div>
    </Panel>
  );
  return(
    <Panel title="SEASON ARCHIVES" subtitle="SMP HISTORY DATABASE" color="var(--purple)" onClose={onClose}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(195px,1fr))",gap:12}}>
        {seasons.map(s=>(
          <div key={s.num} className="scard" onClick={()=>s.available&&setSel(s)}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:9}}>
              <span className="orb" style={{fontSize:20,fontWeight:900,color:s.available?"#fff":"#252525"}}>S{s.num}</span>
              {!s.available&&<span className="orb" style={{fontSize:7,letterSpacing:2,padding:"3px 8px",borderRadius:3,background:"rgba(180,77,255,.15)",border:"1px solid rgba(180,77,255,.3)",color:"var(--purple)",animation:"borderGlow 3s ease-in-out infinite"}}>SOON</span>}
            </div>
            <div className="mono" style={{fontSize:10,color:s.available?"var(--dim)":"#252525"}}>{s.available?`Season ${s.num} · ${s.tagline}`:"Data locked · Not yet initialized"}</div>
            {s.available&&<div className="mono" style={{fontSize:8,color:"rgba(180,77,255,.5)",letterSpacing:2,marginTop:9}}>VIEW ARCHIVE →</div>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RULES
// ═══════════════════════════════════════════════════════════════════════════════
function RulesPanel({onClose}){
  const[rules,setRules]=useState([]);
  useEffect(()=>{DB.getRules().then(setRules);},[]);
  return(
    <Panel title="PROTOCOL RULES" subtitle="SERVER REGULATIONS · COMMAND LAW" color="var(--amber)" onClose={onClose}>
      <div style={{maxHeight:"66vh",overflowY:"auto"}}>
        {rules.map(cat=>(
          <div key={cat.cat} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}><span style={{fontSize:14}}>{cat.icon}</span><span className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:3}}>{cat.cat}</span></div>
            {(cat.items||[]).map((rule,i)=><div key={i} className="rule-item" style={{borderColor:"rgba(251,191,36,.4)"}}><span className="mono" style={{color:"rgba(251,191,36,.5)"}}>R{i+1}. </span>{rule}</div>)}
          </div>
        ))}
        <div style={{padding:12,borderRadius:8,background:"rgba(251,191,36,.05)",border:"1px dashed rgba(251,191,36,.18)",fontFamily:"Share Tech Mono",fontSize:11,color:"rgba(251,191,36,.5)",lineHeight:1.7}}>
          ⚠ Violation may result in warnings, ban, or whitelist removal. Admin decisions are final.
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DIAGNOSTICS — upgraded with dashboard metrics
// ═══════════════════════════════════════════════════════════════════════════════
const DC2={ok:"var(--green)",warn:"var(--amber)",error:"var(--red)"};
const DI2={ok:"✅",warn:"⚠️",error:"❌"};

function PingMiniGraph({history}){
  if(!history||history.length===0)return<div className="mono" style={{fontSize:8,color:"var(--dim)"}}>No data yet</div>;
  const max=history.length;
  return(
    <div className="ping-graph" style={{background:"rgba(0,0,0,.3)",borderRadius:6,width:"100%",boxSizing:"border-box"}}>
      {history.map((p,i)=>(
        <div key={i} className="ping-bar-g" style={{height:`${p.ok?Math.round(60+Math.random()*30):10}%`,background:p.ok?"var(--green)":"var(--red)",opacity:.7+i/max*.3}}/>
      ))}
    </div>
  );
}

function DiagPanel({onClose,user}){
  const toast=useToast();
  const[tab,setTab]=useState("checks");
  const[pingHist,setPingHist]=useState([..._pingHistory]);
  const[fbOps,setFbOps]=useState({..._fbOps});
  const[perfData,setPerfData]=useState({fps:60,memory:null,uptime:0});
  const[activeUsers,setActiveUsers]=useState([]);
  const[adminLog,setAdminLog]=useState([]);
  const[featureFlags,setFeatureFlags]=useState(FEATURE_FLAGS_DEFAULT);
  const[savingFlags,setSavingFlags]=useState(false);
  const errC=DIAG_DEFAULT.filter(d=>d.s==="error").length;
  const warnC=DIAG_DEFAULT.filter(d=>d.s==="warn").length;

  useEffect(()=>{
    // Load data
    DB.getAdminLog().then(setAdminLog);
    DB.getFeatureFlags().then(setFeatureFlags);
    // Active users = players with status updated in last 30 min
    DB.getPlayerStatus().then(ps=>{
      const now=Date.now();
      const active=Object.entries(ps).filter(([,s])=>s.updatedAt&&(now-new Date(s.updatedAt).getTime())<30*60*1000).map(([u,s])=>({username:u,...s}));
      setActiveUsers(active);
    });
    // Performance
    const perf={fps:60,memory:null,uptime:Math.floor((Date.now()-_sessionStart)/1000)};
    if(performance?.memory)perf.memory=Math.round(performance.memory.usedJSHeapSize/1048576);
    setPerfData(perf);

    // Poll ping history every 2s
    const t=setInterval(()=>{
      setPingHist([..._pingHistory]);
      setFbOps({..._fbOps});
      setPerfData(p=>({...p,uptime:Math.floor((Date.now()-_sessionStart)/1000)}));
    },2000);
    return()=>clearInterval(t);
  },[]);

  const requestHelp=async label=>{
    await DB.pushNotif({type:"admin",title:"HELP REQUEST — DIAGNOSTICS",body:`${user?.username||"A user"} needs help with: "${label}".`});
    toast("Help request sent to AdminOP!","var(--blue)","🆘");
  };

  const saveFlags=async()=>{
    setSavingFlags(true);
    await DB.setFeatureFlags(featureFlags);
    await DB.pushAdminLog({action:"FEATURE FLAGS UPDATED",by:user?.username||"admin",detail:JSON.stringify(featureFlags).slice(0,100)});
    setSavingFlags(false);toast("Feature flags saved!","var(--green)","✅");
  };

  const TABS=[{id:"checks",l:"CHECKS"},{id:"metrics",l:"METRICS"},{id:"activeusr",l:"ACTIVE USERS"},{id:"adminlog",l:"ADMIN LOG"},{id:"featureflags",l:"FEATURE FLAGS"}];

  return(
    <Panel title="DIAGNOSTICS" subtitle={`${DIAG_DEFAULT.length} CHECKS · ${errC} ERROR · ${warnC} WARN · METRICS`} color="var(--blue)" onClose={onClose} wide>
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 10px",borderRadius:4,cursor:"pointer",background:tab===t.id?"rgba(59,130,246,.2)":"transparent",border:`1px solid ${tab===t.id?"var(--blue)":"rgba(59,130,246,.18)"}`,color:tab===t.id?"var(--blue)":"var(--dim)",transition:"all .2s"}}>{t.l}</button>)}
      </div>
      <div style={{maxHeight:"64vh",overflowY:"auto"}}>

        {/* CHECKS TAB */}
        {tab==="checks"&&(
          <>
            <div className="mono" style={{fontSize:11,color:"var(--blue)",marginBottom:12,padding:"9px 13px",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",borderRadius:6}}>
              SCANNING SYSTEM... {DIAG_DEFAULT.length} CHECKS · {errC} ERROR · {warnC} WARNINGS
            </div>
            {DIAG_DEFAULT.map((item,i)=>(
              <div className="diag-row" key={i}>
                <div style={{fontSize:18,flexShrink:0}}>{item.icon}</div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                    <span className="orb" style={{fontSize:9,color:"#fff",letterSpacing:1}}>{item.label}</span>
                    <span className="mono" style={{fontSize:8,color:DC2[item.s],letterSpacing:2}}>{item.s.toUpperCase()} {DI2[item.s]}</span>
                  </div>
                  <div className="mono" style={{fontSize:11,color:"var(--dim)",lineHeight:1.5}}>{item.tip}</div>
                </div>
                <button onClick={()=>requestHelp(item.label)} style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.25)",borderRadius:5,color:"var(--blue)",cursor:"pointer",padding:"5px 9px",fontFamily:"Orbitron",fontSize:7,letterSpacing:1,flexShrink:0,transition:"all .2s"}}
                  onMouseOver={e=>{e.currentTarget.style.background="rgba(59,130,246,.2)"}}
                  onMouseOut={e=>{e.currentTarget.style.background="rgba(59,130,246,.08)"}}>🆘 HELP</button>
              </div>
            ))}
          </>
        )}

        {/* METRICS TAB */}
        {tab==="metrics"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,marginBottom:18}}>
              {[
                {icon:"⚡",label:"Session Uptime",value:`${Math.floor(perfData.uptime/60)}m ${perfData.uptime%60}s`,color:"var(--cyan)"},
                {icon:"🖥",label:"JS Heap",value:perfData.memory?`${perfData.memory} MB`:"N/A",color:"var(--blue)"},
                {icon:"📖",label:"FB Reads",value:fbOps.reads,color:"var(--green)"},
                {icon:"✏️",label:"FB Writes",value:fbOps.writes,color:"var(--amber)"},
                {icon:"👥",label:"Active Players",value:activeUsers.length,color:"var(--purple)"},
                {icon:"🌐",label:"Ping Checks",value:pingHist.length,color:"var(--blue)"},
                {icon:"✅",label:"Ping Success",value:`${pingHist.filter(p=>p.ok).length}/${pingHist.length}`,color:"var(--green)"},
                {icon:"💥",label:"Ping Failures",value:pingHist.filter(p=>!p.ok).length,color:"var(--red)"},
              ].map(m=>(
                <div key={m.label} className="diag-metric">
                  <div style={{fontSize:20,marginBottom:5}}>{m.icon}</div>
                  <div className="orb" style={{fontSize:16,color:m.color,marginBottom:3}}>{m.value}</div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{m.label}</div>
                </div>
              ))}
            </div>
            {/* Ping history graph */}
            <div style={{background:"rgba(59,130,246,.05)",border:"1px solid rgba(59,130,246,.2)",borderRadius:8,padding:14,marginBottom:14}}>
              <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:8}}>📡 PING HISTORY (last 30 checks)</div>
              <PingMiniGraph history={pingHist}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                <span className="mono" style={{fontSize:8,color:"var(--green)"}}>■ Online</span>
                <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>← older · newer →</span>
                <span className="mono" style={{fontSize:8,color:"var(--red)"}}>■ Offline</span>
              </div>
            </div>
            {/* Performance note */}
            <div style={{background:"rgba(0,245,255,.03)",border:"1px solid rgba(0,245,255,.1)",borderRadius:6,padding:"10px 14px"}}>
              <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.8}}>
                📊 Metrics update every 2 seconds · FB read/write counts are per-session · Ping history records server reachability checks
              </div>
            </div>
          </div>
        )}

        {/* ACTIVE USERS TAB */}
        {tab==="activeusr"&&(
          <div>
            <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:12}}>👥 PLAYERS ACTIVE IN LAST 30 MINUTES · {activeUsers.length}</div>
            {activeUsers.length===0?<div style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>👥</div><div className="mono" style={{fontSize:10}}>No players have updated their status recently.</div></div>:(
              <div style={{display:"grid",gap:8}}>
                {activeUsers.map(u=>(
                  <div key={u.username} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",border:"1px solid rgba(59,130,246,.15)",borderRadius:8,background:"rgba(0,10,30,.4)"}}>
                    <MCAvatar username={u.username} size={34}/>
                    <div style={{flex:1}}>
                      <div className="orb" style={{fontSize:10,color:"var(--text)"}}>{u.username}</div>
                      <div className="mono" style={{fontSize:8,color:SC[u.status]||"var(--dim)",marginTop:2}}>{STATUS_EMOJI[u.status]||"⚫"} {u.activity||u.status}</div>
                    </div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>
                      {u.updatedAt?`${Math.floor((Date.now()-new Date(u.updatedAt).getTime())/60000)}m ago`:""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ADMIN LOG TAB */}
        {tab==="adminlog"&&(
          <div>
            <div className="orb" style={{fontSize:8,color:"var(--orange)",letterSpacing:2,marginBottom:12}}>🛠 ADMIN ACTIONS LOG · LAST 200</div>
            {adminLog.length===0?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>No admin actions recorded yet.</div>:(
              <div style={{background:"rgba(0,5,15,.7)",border:"1px solid rgba(249,115,22,.15)",borderRadius:8,overflow:"hidden"}}>
                {adminLog.map((e,i)=>(
                  <div key={e.id||i} className="admin-log-item" style={{background:i%2===0?"transparent":"rgba(249,115,22,.02)"}}>
                    <span style={{color:"var(--amber)"}}>{new Date(e.ts).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}</span>
                    <span style={{color:"var(--orange)",marginLeft:10,marginRight:8}}>[{e.by||"admin"}]</span>
                    <span style={{color:"var(--text)"}}>{e.action}</span>
                    {e.detail&&<span style={{color:"var(--dim)",marginLeft:8}}>· {e.detail}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* FEATURE FLAGS TAB */}
        {tab==="featureflags"&&(
          <div>
            <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:8}}>🚩 FEATURE FLAGS — TOGGLE SITE FEATURES</div>
            <div className="mono" style={{fontSize:9,color:"var(--dim)",marginBottom:14,lineHeight:1.7}}>Disable features site-wide without deleting data. Changes take effect immediately for all users.</div>
            {!user?.isAdmin&&<div className="mono" style={{color:"var(--amber)",fontSize:9,marginBottom:10}}>⚠ Admin only</div>}
            <div style={{background:"rgba(0,5,15,.6)",border:"1px solid rgba(0,245,255,.12)",borderRadius:8,overflow:"hidden",marginBottom:12}}>
              {Object.entries(featureFlags).map(([key,val])=>(
                <div key={key} className="flag-row">
                  <div>
                    <div className="mono" style={{fontSize:10,color:"var(--text)"}}>{key.replace(/([A-Z])/g," $1").toUpperCase()}</div>
                  </div>
                  <label className="toggle">
                    <input type="checkbox" checked={!!val} onChange={e=>user?.isAdmin&&setFeatureFlags(f=>({...f,[key]:e.target.checked}))} disabled={!user?.isAdmin}/>
                    <span className="toggle-slider"/>
                  </label>
                </div>
              ))}
            </div>
            {user?.isAdmin&&<button className="neon-btn" onClick={saveFlags} disabled={savingFlags} style={{fontSize:9,borderColor:"var(--cyan)",color:"var(--cyan)"}}>{savingFlags?"SAVING...":"⟩ SAVE FLAGS ⟨"}</button>}
          </div>
        )}

      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function AdminPanel({onClose,user}){
  const toast=useToast();
  const[tab,setTab]=useState("users");
  const[whitelist,setWhitelist]=useState([]);
  const[wars,setWars]=useState([]);
  const[surveys,setSurveys]=useState([]);
  const[users,setUsers]=useState([]);
  const[rules,setRules]=useState([]);
  const[seasons,setSeasons]=useState([]);
  const[accessReqs,setAccessReqs]=useState([]);
  const[powerAccessReqs,setPowerAccessReqs]=useState([]);
  const[musicList,setMusicList]=useState([]);
  const[board,setBoard]=useState([]);
  const[wlIn,setWlIn]=useState("");
  const[wi,setWi]=useState({title:"",teams:"",outcome:"",notes:"",winner:"0",season:"1"});
  const[pwReset,setPwReset]=useState({});
  const[saving,setSaving]=useState(false);
  const[newTrack,setNewTrack]=useState({title:"",artist:"",url:"",_file:null,_fileName:""});
  const[newCat,setNewCat]=useState({cat:"",icon:"⚙️"});
  const[newRuleItem,setNewRuleItem]=useState("");
  const[editRuleCat,setEditRuleCat]=useState(null);
  const[newSeasonNum,setNewSeasonNum]=useState("");
  const[newSeasonItem,setNewSeasonItem]=useState({achievements:"",events:"",builds:""});
  const[editSeason,setEditSeason]=useState(null);
  const[lbEdit,setLbEdit]=useState({});
  const[newLbPlayer,setNewLbPlayer]=useState("");

  useEffect(()=>{
    DB.getWhitelist().then(setWhitelist);
    DB.getWars().then(setWars);
    DB.getSurveys().then(setSurveys);
    DB.getUsers().then(setUsers);
    DB.getRules().then(setRules);
    DB.getSeasons().then(setSeasons);
    DB.getAccessReqs().then(setAccessReqs);
    DB.getServerPowerAccess().then(setPowerAccessReqs);
    DB.getMusicList().then(setMusicList);
    DB.getLeaderboard().then(setBoard);
  },[]);

  // WHITELIST
  const addWL=async()=>{if(!wlIn.trim()||whitelist.includes(wlIn.trim()))return;const nw=[...whitelist,wlIn.trim()];setWhitelist(nw);await DB.setWhitelist(nw);setWlIn("");toast("Added to whitelist.","var(--green)","✅");};
  const removeWL=async n=>{const nw=whitelist.filter(p=>p!==n);setWhitelist(nw);await DB.setWhitelist(nw);toast(`${n} removed.`,"var(--amber)","🗑");};

  // WARS
  const addWar=async()=>{
    if(!wi.title.trim())return;setSaving(true);
    const e={id:Date.now(),...wi,teams:wi.teams.split(",").map(t=>t.trim()),winner:parseInt(wi.winner),season:parseInt(wi.season)||1,date:`S${wi.season||1}·${new Date().toLocaleDateString()}`};
    const nw=[...wars,e];setWars(nw);await DB.setWars(nw);
    await DB.pushNotif({type:"war",title:"WAR ENTRY LOGGED",body:`"${wi.title}" logged.`});
    setWi({title:"",teams:"",outcome:"",notes:"",winner:"0",season:"1"});setSaving(false);toast("War logged.","var(--red)","⚔️");
  };
  const removeWar=async id=>{const nw=wars.filter(w=>w.id!==id);setWars(nw);await DB.setWars(nw);};

  // USERS
  const resetSurvey=async u=>{const ns=surveys.filter(s=>s.username!==u);setSurveys(ns);await DB.setSurveys(ns);toast(`Survey reset for ${u}.`,"var(--amber)","🔄");};
  const removeUser=async u=>{
    const nu=users.filter(x=>x.username!==u);setUsers(nu);await DB.setUsers(nu);
    const nw=whitelist.filter(w=>w!==u);setWhitelist(nw);await DB.setWhitelist(nw);
    toast(`${u} removed.`,"var(--red)","🗑");
  };
  const doPwReset=async username=>{
    const newPw=pwReset[username];if(!newPw||newPw.length<6){toast("Min 6 chars.","var(--red)","⚠");return;}
    await DB.resetUserPw(username,newPw);const u2=await DB.getUsers();setUsers(u2);
    setPwReset(p=>({...p,[username]:""}));toast(`Password reset for ${username}.`,"var(--green)","🔑");
  };

  // RULES
  const addRuleItem=async ci=>{if(!newRuleItem.trim())return;const r=[...rules];r[ci]={...r[ci],items:[...r[ci].items,newRuleItem.trim()]};setRules(r);await DB.setRules(r);setNewRuleItem("");toast("Rule added.","var(--amber)","✅");};
  const removeRuleItem=async(ci,ii)=>{const r=[...rules];r[ci]={...r[ci],items:r[ci].items.filter((_,i)=>i!==ii)};setRules(r);await DB.setRules(r);};
  const addRuleCat=async()=>{if(!newCat.cat.trim())return;const r=[...rules,{cat:newCat.cat.toUpperCase(),icon:newCat.icon,items:[]}];setRules(r);await DB.setRules(r);setNewCat({cat:"",icon:"⚙️"});toast("Category added.","var(--amber)","✅");};
  const removeRuleCat=async ci=>{const r=rules.filter((_,i)=>i!==ci);setRules(r);await DB.setRules(r);};

  // SEASONS
  const addSeasonData=async(si,field)=>{const val=newSeasonItem[field].trim();if(!val)return;const s=[...seasons];s[si]={...s[si],[field]:[...(s[si][field]||[]),val]};setSeasons(s);await DB.setSeasons(s);setNewSeasonItem(p=>({...p,[field]:""}));};
  const removeSeasonData=async(si,field,ii)=>{const s=[...seasons];s[si]={...s[si],[field]:s[si][field].filter((_,i)=>i!==ii)};setSeasons(s);await DB.setSeasons(s);};
  const addSeason=async()=>{if(!newSeasonNum||seasons.some(s=>s.num===parseInt(newSeasonNum)))return;const s=[...seasons,{num:parseInt(newSeasonNum),available:false,tagline:"Coming Soon",achievements:[],events:[],builds:[]}].sort((a,b)=>a.num-b.num);setSeasons(s);await DB.setSeasons(s);setNewSeasonNum("");};
  const toggleSeasonAvail=async si=>{const s=[...seasons];s[si]={...s[si],available:!s[si].available};setSeasons(s);await DB.setSeasons(s);};
  const updateSeasonTagline=async(si,val)=>{const s=[...seasons];s[si]={...s[si],tagline:val};setSeasons(s);await DB.setSeasons(s);};

  // ACCESS
  const approveAccess=async req=>{const u2=accessReqs.map(r=>r.id===req.id?{...r,status:"approved"}:r);setAccessReqs(u2);await DB.setAccessReqs(u2);await DB.pushNotif({type:"access",title:"ACCESS APPROVED",body:`${req.username}'s access was approved.`});toast("Approved.","var(--green)","✅");};
  const denyAccess=async req=>{const u2=accessReqs.map(r=>r.id===req.id?{...r,status:"denied"}:r);setAccessReqs(u2);await DB.setAccessReqs(u2);toast("Denied.","var(--red)","❌");};
  // Server Power Access management
  const approvePowerAccess=async req=>{
    const u2=powerAccessReqs.map(r=>r.id===req.id?{...r,status:"approved",grantedAt:new Date().toISOString(),grantedBy:user.username}:r);
    setPowerAccessReqs(u2);await DB.setServerPowerAccess(u2);
    await DB.pushNotif({type:"access",title:"SERVER POWER GRANTED",body:`${req.username} has been granted server start/stop access.`});
    toast("Power access granted.","var(--green)","✅");
  };
  const denyPowerAccess=async req=>{
    const u2=powerAccessReqs.map(r=>r.id===req.id?{...r,status:"denied"}:r);
    setPowerAccessReqs(u2);await DB.setServerPowerAccess(u2);
    toast("Power access denied.","var(--red)","❌");
  };
  const revokePowerAccess=async req=>{
    const u2=powerAccessReqs.map(r=>r.id===req.id?{...r,status:"revoked",revokedAt:new Date().toISOString(),revokedBy:user.username}:r);
    setPowerAccessReqs(u2);await DB.setServerPowerAccess(u2);
    await DB.pushNotif({type:"access",title:"SERVER POWER REVOKED",body:`${req.username}'s server control access has been revoked.`});
    toast("Access revoked.","var(--amber)","🔒");
  };

  // MUSIC
  const addTrack=async()=>{
    if(!newTrack.title.trim()){return;}
    if(!newTrack._file&&!newTrack.url.trim()){toast("Add a file or URL.","var(--red)","\u26a0");return;}
    let url=newTrack.url.trim();
    if(newTrack._file){
      toast("Uploading audio to Cloudinary...","var(--cyan)","\u2b06");
      try{url=await DB.uploadMusicFile(newTrack._file);}
      catch(e){toast("Upload failed: "+e.message,"var(--red)","\u26a0");return;}
    }
    const list=[...musicList,{id:Date.now(),title:newTrack.title.trim(),artist:newTrack.artist.trim(),url,addedAt:new Date().toISOString()}];
    setMusicList(list);await DB.setMusicList(list);
    setNewTrack({title:"",artist:"",url:"",_file:null,_fileName:""});
    toast("Track added!","var(--purple)","\U0001f3b5");
  };
  const removeTrack=async id=>{const list=musicList.filter(t=>t.id!==id);setMusicList(list);await DB.setMusicList(list);};

  // LEADERBOARD
  const saveLbPlayer=async()=>{
    if(!newLbPlayer.trim())return;
    const exists=board.find(p=>p.username===newLbPlayer.trim());
    if(!exists){const nb=[...board,{username:newLbPlayer.trim(),kills:0,deaths:0,diamonds:0,playtime:0,builds:0}];setBoard(nb);await DB.setLeaderboard(nb);}
    setNewLbPlayer("");toast("Player added to leaderboard.","var(--amber)","🏆");
  };
  const updateLbStat=async(username,stat,val)=>{
    const nb=board.map(p=>p.username===username?{...p,[stat]:parseInt(val)||0}:p);
    setBoard(nb);await DB.setLeaderboard(nb);
  };
  const removeLbPlayer=async username=>{const nb=board.filter(p=>p.username!==username);setBoard(nb);await DB.setLeaderboard(nb);};

  const TABS=[{id:"users",l:"USERS"},{id:"wl",l:"WHITELIST"},{id:"war",l:"WARS"},{id:"rules",l:"RULES"},{id:"seasons",l:"SEASONS"},{id:"music",l:"MUSIC"},{id:"leaderboard",l:"LEADERBOARD"},{id:"access",l:"ACCESS REQS"},{id:"poweraccess",l:"⚡ POWER ACCESS"},{id:"surveys",l:"SURVEYS"},{id:"broadcast",l:"BROADCAST"},{id:"storagereqs",l:"STORAGE REQS"},{id:"potw_admin",l:"POTW"},{id:"autoclear",l:"AUTO-CLEAR"},{id:"schedann",l:"SCHED. ANN"}];

  return(
    <Panel title="ADMIN CONTROLS" subtitle={`RESTRICTED · ${user?.username?.toUpperCase()} AUTHENTICATED`} color="var(--orange)" onClose={onClose} wide>
      <div className="admin-tabs" style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 9px",borderRadius:5,cursor:"pointer",background:tab===t.id?"rgba(249,115,22,.2)":"transparent",border:`1px solid ${tab===t.id?"var(--orange)":"rgba(249,115,22,.18)"}`,color:tab===t.id?"var(--orange)":"var(--dim)",transition:"all .2s"}}>{t.l}</button>)}
      </div>
      <div style={{maxHeight:"60vh",overflowY:"auto"}}>

        {/* USERS — merged player+user list */}
        {tab==="users"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:12}}>ALL REGISTERED ACCOUNTS · {users.length}</div>
          <div style={{padding:"8px 12px",background:"rgba(0,245,255,.04)",border:"1px dashed rgba(0,245,255,.12)",borderRadius:6,marginBottom:12}}>
            <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.7}}>Every account that signs up appears here automatically. No separate player list needed — accounts ARE the player list.</div>
          </div>
          {users.length===0&&<div className="mono" style={{color:"var(--dim)",fontSize:11}}>No registered accounts yet.</div>}
          {users.map((u,i)=>(
            <div key={i} style={{border:"1px solid rgba(0,245,255,.09)",borderRadius:8,padding:"12px 14px",marginBottom:9,background:"rgba(0,10,25,.4)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <MCAvatar username={u.username} size={36}/>
                  <div>
                    <div className="orb" style={{fontSize:10,color:"var(--text)"}}>{u.username} {u.resetRequested&&<span style={{color:"var(--amber)",fontSize:8}}>⚠ RESET REQ</span>}</div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:2}}>{u.email} · {new Date(u.createdAt).toLocaleDateString()}</div>
                    <div className="mono" style={{fontSize:8,color:u.surveyDone?"var(--green)":"var(--amber)",marginTop:1}}>{u.surveyDone?"✅ Survey done":"⏳ No survey"}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>resetSurvey(u.username)} style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.3)",color:"var(--amber)",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>RESET SURVEY</button>
                  <button onClick={()=>removeUser(u.username)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>REMOVE</button>
                </div>
              </div>
              <div style={{borderTop:"1px solid rgba(0,245,255,.07)",paddingTop:9}}>
                <label className="si-label">SET NEW PASSWORD FOR {u.username}</label>
                <div style={{display:"flex",gap:8}}>
                  <input className="si" type="password" placeholder="New password (≥6 chars)..." value={pwReset[u.username]||""} onChange={e=>setPwReset(p=>({...p,[u.username]:e.target.value}))} style={{flex:1}}/>
                  <button onClick={()=>doPwReset(u.username)} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"6px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono",flexShrink:0}}>SET PW</button>
                </div>
              </div>
            </div>
          ))}
        </>}

        {/* WHITELIST */}
        {tab==="wl"&&<>
          <div style={{padding:"8px 12px",background:"rgba(249,115,22,.04)",border:"1px dashed rgba(249,115,22,.18)",borderRadius:6,marginBottom:12}}>
            <div className="mono" style={{fontSize:9,color:"rgba(249,115,22,.7)",lineHeight:1.7}}>The whitelist is the list of Minecraft usernames allowed to JOIN the server. All registered users are auto-whitelisted on signup. You can also manually add extra IGNs here.</div>
          </div>
          <div style={{display:"flex",gap:9,marginBottom:14,alignItems:"flex-end"}}>
            <div style={{flex:1}}><label className="si-label">ADD USERNAME TO WHITELIST</label><input className="si" value={wlIn} onChange={e=>setWlIn(e.target.value)} placeholder="Minecraft IGN..." onKeyDown={e=>e.key==="Enter"&&addWL()}/></div>
            <button className="neon-btn" onClick={addWL} style={{borderColor:"var(--orange)",color:"var(--orange)",fontSize:9,padding:"10px 16px",flexShrink:0}}>ADD</button>
          </div>
          <div style={{border:"1px solid rgba(249,115,22,.14)",borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"7px 14px",background:"rgba(249,115,22,.07)"}}><span className="orb" style={{fontSize:8,color:"var(--orange)",letterSpacing:2}}>WHITELIST · {whitelist.length}</span></div>
            {whitelist.map((name,i)=>(
              <div className="wl-row" key={i}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><MCAvatar username={name} size={24}/><span>{name}</span></div>
                <button onClick={()=>removeWL(name)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:10,cursor:"pointer",fontFamily:"Share Tech Mono"}}>REMOVE</button>
              </div>
            ))}
          </div>
        </>}

        {/* WARS */}
        {tab==="war"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--red)",letterSpacing:3,marginBottom:10}}>LOG NEW WAR ENTRY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            {[["title","WAR TITLE","e.g. Battle of Spawn Plains"],["teams","TEAMS (comma separated)","Alpha Squad, Night Raiders"],["outcome","OUTCOME","e.g. Alpha Victory"],["notes","NOTES","Summary of the battle..."]].map(([k,l,ph])=>(
              <div key={k}><label className="si-label">{l}</label><input className="si" placeholder={ph} value={wi[k]} onChange={e=>setWi(w=>({...w,[k]:e.target.value}))}/></div>
            ))}
            <div><label className="si-label">SEASON</label><input className="si" type="number" min="1" value={wi.season} onChange={e=>setWi(w=>({...w,season:e.target.value}))}/></div>
            <div><label className="si-label">WINNER</label><select className="si" value={wi.winner} onChange={e=>setWi(w=>({...w,winner:e.target.value}))}><option value="0">Team 1 wins</option><option value="1">Team 2 wins</option><option value="-1">Draw</option></select></div>
          </div>
          <button className="neon-btn" onClick={addWar} disabled={saving} style={{borderColor:"var(--red)",color:"var(--red)",fontSize:9,marginBottom:18}}>{saving?"...":"⟩ LOG WAR ENTRY ⟨"}</button>
          {wars.map(w=>(
            <div key={w.id} style={{padding:"9px 13px",borderRadius:6,border:"1px solid rgba(255,68,68,.14)",marginBottom:7,display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
              <div><span className="mono" style={{color:"#ff8888",fontSize:11}}>{w.title}</span><span className="mono" style={{color:"var(--dim)",fontSize:9}}> · S{w.season||1} · {Array.isArray(w.teams)?w.teams.join(" vs "):w.teams}</span></div>
              <button onClick={()=>removeWar(w.id)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>DEL</button>
            </div>
          ))}
        </>}

        {/* RULES */}
        {tab==="rules"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:12}}>EDIT PROTOCOL RULES</div>
          <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div><label className="si-label">NEW CATEGORY NAME</label><input className="si" style={{width:140}} value={newCat.cat} onChange={e=>setNewCat(c=>({...c,cat:e.target.value}))} placeholder="Category..."/></div>
            <div><label className="si-label">ICON</label><input className="si" style={{width:60}} value={newCat.icon} onChange={e=>setNewCat(c=>({...c,icon:e.target.value}))} placeholder="⚙️"/></div>
            <button className="neon-btn" onClick={addRuleCat} style={{borderColor:"var(--amber)",color:"var(--amber)",fontSize:9,padding:"10px 14px"}}>+ ADD CAT</button>
          </div>
          {rules.map((cat,ci)=>(
            <div key={ci} style={{border:"1px solid rgba(251,191,36,.15)",borderRadius:8,padding:12,marginBottom:12,background:"rgba(20,15,0,.4)"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:9}}>
                <span className="orb" style={{fontSize:9,color:"var(--amber)"}}>{cat.icon} {cat.cat}</span>
                <button onClick={()=>removeRuleCat(ci)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"2px 8px",fontSize:8,cursor:"pointer",fontFamily:"Share Tech Mono"}}>DEL</button>
              </div>
              {(cat.items||[]).map((rule,ri)=>(
                <div key={ri} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",borderRadius:4,background:"rgba(251,191,36,.03)",marginBottom:3}}>
                  <span className="mono" style={{fontSize:10,color:"var(--text)"}}>{rule}</span>
                  <button onClick={()=>removeRuleItem(ci,ri)} style={{background:"none",border:"none",color:"rgba(255,68,68,.6)",cursor:"pointer",fontSize:13}}>×</button>
                </div>
              ))}
              <div style={{display:"flex",gap:7,marginTop:7}}>
                <input className="si" placeholder="New rule..." value={editRuleCat===ci?newRuleItem:""} onFocus={()=>setEditRuleCat(ci)} onChange={e=>setNewRuleItem(e.target.value)} style={{flex:1}}/>
                <button onClick={()=>addRuleItem(ci)} style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.3)",color:"var(--amber)",borderRadius:4,padding:"6px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>ADD</button>
              </div>
            </div>
          ))}
        </>}

        {/* SEASONS */}
        {tab==="seasons"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:12}}>SEASON ARCHIVES EDITOR</div>
          <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"flex-end"}}>
            <div><label className="si-label">ADD SEASON #</label><input className="si" style={{width:100}} type="number" min="1" value={newSeasonNum} onChange={e=>setNewSeasonNum(e.target.value)} placeholder="e.g. 4"/></div>
            <button className="neon-btn" onClick={addSeason} style={{borderColor:"var(--purple)",color:"var(--purple)",fontSize:9,padding:"10px 14px"}}>+ ADD</button>
          </div>
          {seasons.map((s,si)=>(
            <div key={s.num} style={{border:"1px solid rgba(180,77,255,.18)",borderRadius:8,padding:14,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:10}}>
                <span className="orb" style={{fontSize:11,color:"var(--purple)",fontWeight:900}}>S{s.num}</span>
                <button onClick={()=>toggleSeasonAvail(si)} style={{background:s.available?"rgba(57,255,20,.1)":"rgba(255,68,68,.08)",border:`1px solid ${s.available?"rgba(57,255,20,.3)":"rgba(255,68,68,.25)"}`,color:s.available?"var(--green)":"var(--red)",borderRadius:4,padding:"3px 9px",fontSize:8,cursor:"pointer",fontFamily:"Share Tech Mono"}}>{s.available?"PUBLISHED":"HIDDEN"}</button>
              </div>
              <div style={{marginBottom:10}}><label className="si-label">TAGLINE</label><input className="si" value={s.tagline||""} onChange={e=>updateSeasonTagline(si,e.target.value)}/></div>
              {[["achievements","ACHIEVEMENTS"],["events","MAJOR EVENTS"],["builds","NOTABLE BUILDS"]].map(([field,fl])=>(
                <div key={field} style={{marginBottom:10}}>
                  <label className="si-label">{fl}</label>
                  {(s[field]||[]).map((item,ii)=>(
                    <div key={ii} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",marginBottom:3,borderRadius:4,background:"rgba(180,77,255,.04)"}}>
                      <span className="mono" style={{fontSize:10,color:"var(--text)"}}>{item}</span>
                      <button onClick={()=>removeSeasonData(si,field,ii)} style={{background:"none",border:"none",color:"rgba(255,68,68,.6)",cursor:"pointer",fontSize:12}}>×</button>
                    </div>
                  ))}
                  <div style={{display:"flex",gap:6,marginTop:4}}>
                    <input className="si" placeholder={`Add ${field}...`} value={editSeason===`${si}-${field}`?newSeasonItem[field]:""} onFocus={()=>setEditSeason(`${si}-${field}`)} onChange={e=>setNewSeasonItem(p=>({...p,[field]:e.target.value}))} style={{flex:1}}/>
                    <button onClick={()=>addSeasonData(si,field)} style={{background:"rgba(180,77,255,.1)",border:"1px solid rgba(180,77,255,.3)",color:"var(--purple)",borderRadius:4,padding:"6px 10px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>ADD</button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>}

        {/* MUSIC */}
        {tab==="music"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:12}}>🎵 MUSIC LIBRARY — CLOUDINARY STORAGE</div>
          <div style={{padding:"9px 12px",background:"rgba(180,77,255,.05)",border:"1px solid rgba(180,77,255,.2)",borderRadius:6,marginBottom:14}}>
            <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.8}}>
              <span style={{color:"var(--green)"}}>📁 Upload audio files</span> — mp3, ogg, wav. Files go to Cloudinary (25GB free), permanent URL saved in Firebase.<br/>
              <span style={{color:"#ff6666"}}>▶ YouTube links</span> — embed player inside widget. Use the video's own play button.
            </div>
          </div>
          <div style={{display:"grid",gap:9,marginBottom:14}}>
            <div><label className="si-label">TRACK TITLE</label><input className="si" value={newTrack.title} onChange={e=>setNewTrack(t=>({...t,title:e.target.value}))} placeholder="e.g. Minecraft - Sweden"/></div>
            <div><label className="si-label">ARTIST</label><input className="si" value={newTrack.artist} onChange={e=>setNewTrack(t=>({...t,artist:e.target.value}))} placeholder="e.g. C418"/></div>
            <div>
              <label className="si-label">SOURCE — UPLOAD FILE OR PASTE URL</label>
              <label style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",marginBottom:8,
                background:newTrack._file?"rgba(57,255,20,.06)":"rgba(180,77,255,.04)",
                border:`2px dashed ${newTrack._file?"rgba(57,255,20,.5)":"rgba(180,77,255,.3)"}`,
                borderRadius:6,cursor:"pointer"}}>
                <input type="file" accept="audio/*" style={{display:"none"}} onChange={e=>{
                  const f=e.target.files?.[0];if(!f)return;
                  setNewTrack(t=>({...t,_file:f,_fileName:f.name,url:"",title:t.title||f.name.replace(/\.[^.]+$/,"")}));
                  e.target.value="";
                }}/>
                <span style={{fontSize:20}}>{newTrack._file?"✅":"📁"}</span>
                <div>
                  <div className="mono" style={{fontSize:10,color:newTrack._file?"var(--green)":"var(--purple)"}}>
                    {newTrack._file?`Ready: ${newTrack._fileName}`:"Click to upload audio (mp3, ogg, wav…)"}
                  </div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>Uploads to Cloudinary — permanent URL, no size limit issues</div>
                </div>
                {newTrack._file&&<button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();setNewTrack(t=>({...t,_file:null,_fileName:""}));}}
                  style={{marginLeft:"auto",background:"rgba(255,68,68,.12)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:10,cursor:"pointer"}}>✕</button>}
              </label>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <div style={{flex:1,height:1,background:"rgba(180,77,255,.2)"}}/>
                <span className="mono" style={{fontSize:9,color:"var(--dim)"}}>OR PASTE URL</span>
                <div style={{flex:1,height:1,background:"rgba(180,77,255,.2)"}}/>
              </div>
              <input className="si" value={newTrack.url} disabled={!!newTrack._file}
                onChange={e=>setNewTrack(t=>({...t,url:e.target.value}))}
                placeholder="https://youtube.com/watch?v=... or direct .mp3 URL"
                style={{opacity:newTrack._file?0.4:1}}/>
            </div>
            <button className="neon-btn" onClick={addTrack} style={{borderColor:"var(--purple)",color:"var(--purple)",fontSize:9}}>⟩ ADD TRACK ⟨</button>
          </div>
          {musicList.map((t,i)=>(
            <div key={t.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",borderRadius:6,border:"1px solid rgba(180,77,255,.14)",marginBottom:7,gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div className="mono" style={{fontSize:11,color:"var(--text)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {getYtId(t.url||"")?<span style={{color:"#ff4444",fontSize:9,fontFamily:"Orbitron"}}>▶YT </span>:"☁ "}{t.title}
                </div>
                <div className="mono" style={{fontSize:9,color:"var(--purple)"}}>{t.artist||"—"} · <span style={{color:"rgba(180,77,255,.4)",fontSize:8}}>{t.url?.slice(0,50)||"no url"}</span></div>
              </div>
              <button onClick={()=>removeTrack(t.id||i)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono",flexShrink:0}}>DEL</button>
            </div>
          ))}
        </>}

        {/* LEADERBOARD */}
        {tab==="leaderboard"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:12}}>🏆 LEADERBOARD EDITOR</div>
          <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"flex-end"}}>
            <div style={{flex:1}}><label className="si-label">ADD PLAYER</label><input className="si" value={newLbPlayer} onChange={e=>setNewLbPlayer(e.target.value)} placeholder="Username..."/></div>
            <button className="neon-btn" onClick={saveLbPlayer} style={{borderColor:"var(--amber)",color:"var(--amber)",fontSize:9,padding:"10px 14px"}}>+ ADD</button>
          </div>
          {board.map((p,i)=>(
            <div key={p.username} style={{border:"1px solid rgba(251,191,36,.14)",borderRadius:8,padding:"10px 14px",marginBottom:9,background:"rgba(20,15,0,.3)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><MCAvatar username={p.username} size={30}/><span className="orb" style={{fontSize:9,color:"var(--amber)"}}>{p.username}</span></div>
                <button onClick={()=>removeLbPlayer(p.username)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>REMOVE</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))",gap:7}}>
                {["kills","deaths","diamonds","playtime","builds"].map(stat=>(
                  <div key={stat}>
                    <label className="si-label">{stat.toUpperCase()}</label>
                    <input className="si" type="number" min="0" value={p[stat]||0}
                      onChange={e=>updateLbStat(p.username,stat,e.target.value)}
                      style={{padding:"6px 10px",fontSize:12}}/>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>}

        {/* ACCESS REQUESTS */}
        {tab==="access"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:12}}>SERVER ACCESS REQUESTS · {accessReqs.filter(r=>r.status==="pending").length} PENDING</div>
          {accessReqs.length===0&&<div className="mono" style={{color:"var(--dim)",fontSize:11}}>No requests yet.</div>}
          {accessReqs.map((r,i)=>(
            <div key={r.id||i} style={{border:`1px solid rgba(180,77,255,${r.status==="pending"?".3":".1"})`,borderRadius:8,padding:"12px 14px",marginBottom:9}}>
              <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6,marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><MCAvatar username={r.username} size={28}/><div><div className="orb" style={{fontSize:9,color:"var(--purple)"}}>{r.username}</div><div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{r.ts?new Date(r.ts).toLocaleString():""}</div></div></div>
                <span style={{fontFamily:"Orbitron",fontSize:7,padding:"3px 8px",borderRadius:3,background:r.status==="pending"?"rgba(251,191,36,.1)":r.status==="approved"?"rgba(57,255,20,.1)":"rgba(255,68,68,.1)",border:`1px solid ${r.status==="pending"?"var(--amber)":r.status==="approved"?"var(--green)":"var(--red)"}`,color:r.status==="pending"?"var(--amber)":r.status==="approved"?"var(--green)":"var(--red)",letterSpacing:1}}>{r.status.toUpperCase()}</span>
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--dim)",marginBottom:10}}>"{r.message}"</div>
              {r.status==="pending"&&<div style={{display:"flex",gap:8}}>
                <button onClick={()=>approveAccess(r)} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"5px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>✅ APPROVE</button>
                <button onClick={()=>denyAccess(r)} style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"5px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>❌ DENY</button>
              </div>}
            </div>
          ))}
        </>}

        {/* SERVER POWER ACCESS */}
        {tab==="poweraccess"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:2,marginBottom:4}}>⚡ SERVER POWER ACCESS · {powerAccessReqs.filter(r=>r.status==="pending").length} PENDING</div>
          <div className="mono" style={{fontSize:9,color:"var(--dim)",marginBottom:14,lineHeight:1.7}}>Manage which players can start/stop the Minecraft server. Approved players see Start/Stop controls in the Server Status panel, which trigger the Oracle bridge directly.</div>
          {powerAccessReqs.length===0&&<div className="mono" style={{color:"var(--dim)",fontSize:11}}>No requests yet. Players can request access from the Server Status panel.</div>}
          {powerAccessReqs.map((r,i)=>{
            const statusColor=r.status==="pending"?"var(--amber)":r.status==="approved"?"var(--green)":r.status==="revoked"?"var(--amber)":"var(--red)";
            return(
            <div key={r.id||i} style={{border:`1px solid ${r.status==="pending"?"rgba(251,191,36,.3)":r.status==="approved"?"rgba(57,255,20,.2)":"rgba(255,68,68,.15)"}`,borderRadius:8,padding:"12px 14px",marginBottom:9,background:r.status==="approved"?"rgba(57,255,20,.03)":"transparent"}}>
              <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6,marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <MCAvatar username={r.username} size={28}/>
                  <div>
                    <div className="orb" style={{fontSize:9,color:"var(--green)"}}>{r.username}</div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{r.ts?new Date(r.ts).toLocaleString():""}</div>
                    {r.grantedAt&&<div className="mono" style={{fontSize:7,color:"rgba(57,255,20,.5)"}}>Granted {new Date(r.grantedAt).toLocaleDateString()} by {r.grantedBy}</div>}
                    {r.revokedAt&&<div className="mono" style={{fontSize:7,color:"var(--amber)"}}>Revoked {new Date(r.revokedAt).toLocaleDateString()} by {r.revokedBy}</div>}
                  </div>
                </div>
                <span style={{fontFamily:"Orbitron",fontSize:7,padding:"3px 8px",borderRadius:3,background:r.status==="pending"?"rgba(251,191,36,.1)":r.status==="approved"?"rgba(57,255,20,.1)":"rgba(255,68,68,.1)",border:`1px solid ${statusColor}`,color:statusColor,letterSpacing:1}}>{r.status.toUpperCase()}</span>
              </div>
              {r.message&&<div className="mono" style={{fontSize:10,color:"var(--dim)",marginBottom:10,fontStyle:"italic"}}>"{r.message}"</div>}
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {r.status==="pending"&&<>
                  <button onClick={()=>approvePowerAccess(r)} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"5px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>✅ GRANT ACCESS</button>
                  <button onClick={()=>denyPowerAccess(r)} style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"5px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>❌ DENY</button>
                </>}
                {r.status==="approved"&&<button onClick={()=>revokePowerAccess(r)} style={{background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.3)",color:"var(--amber)",borderRadius:4,padding:"5px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>🔒 REVOKE ACCESS</button>}
                {(r.status==="denied"||r.status==="revoked")&&<button onClick={()=>approvePowerAccess(r)} style={{background:"rgba(57,255,20,.07)",border:"1px solid rgba(57,255,20,.2)",color:"var(--green)",borderRadius:4,padding:"5px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>↩ RE-GRANT</button>}
              </div>
            </div>
          );})}
        </>}

        {/* SURVEYS */}
        {tab==="surveys"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:12}}>SURVEY SUBMISSIONS · {surveys.length}</div>
          {surveys.length===0&&<div className="mono" style={{color:"var(--dim)",fontSize:11}}>No submissions yet.</div>}
          {surveys.map((s,i)=>(
            <div key={i} style={{border:"1px solid rgba(59,130,246,.14)",borderRadius:8,padding:13,marginBottom:9,background:"rgba(0,8,22,.5)"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:9,flexWrap:"wrap",gap:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><MCAvatar username={s.username} size={26}/><div className="orb" style={{fontSize:9,color:"var(--blue)"}}>{s.username}</div></div>
                <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{new Date(s.submittedAt).toLocaleString()}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:5}}>
                {Object.entries(s.responses||{}).filter(([k])=>k!=="notes").map(([k,v])=>(
                  <div key={k} style={{padding:"4px 7px",background:"rgba(59,130,246,.05)",borderRadius:4}}>
                    <div className="mono" style={{fontSize:7,color:"rgba(59,130,246,.5)",letterSpacing:1}}>{k.toUpperCase()}</div>
                    <div className="mono" style={{fontSize:9,color:"var(--text)"}}>{v||"—"}</div>
                  </div>
                ))}
              </div>
              {s.responses?.notes&&<div style={{marginTop:7,fontFamily:"Share Tech Mono",fontSize:10,color:"var(--dim)",borderTop:"1px solid rgba(59,130,246,.08)",paddingTop:7}}>📝 {s.responses.notes}</div>}
            </div>
          ))}
        </>}

        {/* BROADCAST */}
        {tab==="broadcast"&&<BroadcastTab user={user} toast={toast}/>}
        {tab==="announce"&&<AnnounceTab toast={toast}/>}
        {tab==="stats"&&<StatsTab/>}

        {/* STORAGE REQUESTS */}
        {tab==="storagereqs"&&<StorageReqsTab toast={toast}/>}

        {/* POTW ADMIN */}
        {tab==="potw_admin"&&<POTWAdminTab user={user} toast={toast}/>}

        {/* AUTO-CLEAR */}
        {tab==="autoclear"&&<AutoClearTab user={user} toast={toast}/>}

        {/* SCHEDULED ANNOUNCEMENTS */}
        {tab==="schedann"&&<ScheduledAnnsTab user={user} toast={toast}/>}
      </div>
    </Panel>
  );
}

function BroadcastTab({user,toast}){
  const[title,setTitle]=useState("");
  const[body,setBody]=useState("");
  const[type,setType]=useState("system");
  const[sending,setSending]=useState(false);
  const send=async()=>{
    if(!title.trim()||!body.trim())return;setSending(true);
    await DB.pushNotif({type,title:title.toUpperCase(),body,sentBy:user.username});
    fireBrowserNotif(title,body);toast("Broadcast sent!","var(--orange)","📢");setTitle("");setBody("");setSending(false);
  };
  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--orange)",letterSpacing:2,marginBottom:14}}>📢 BROADCAST NOTIFICATION</div>
      <div style={{display:"grid",gap:11,maxWidth:480}}>
        <div><label className="si-label">TYPE</label><select className="si" value={type} onChange={e=>setType(e.target.value)}>{["system","server","war","admin"].map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}</select></div>
        <div><label className="si-label">TITLE</label><input className="si" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Notification title..."/></div>
        <div><label className="si-label">MESSAGE</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={body} onChange={e=>setBody(e.target.value)} placeholder="Message body..."/></div>
        <button className="neon-btn" onClick={send} disabled={sending} style={{borderColor:"var(--orange)",color:"var(--orange)"}}>{sending?"SENDING...":"⟩ BROADCAST TO ALL ⟨"}</button>
      </div>
    </div>
  );
}

// ─── FEATURE 9: ANNOUNCEMENTS admin tab (pinned banners on hub) ───────────────
function AnnounceTab({toast}){
  const[ann,setAnn]=useState([]);
  const[form,setForm]=useState({title:"",body:"",type:"info",icon:"📢",active:true});
  useEffect(()=>{DB.getAnnouncements().then(setAnn);},[]);
  const TYPES={info:"var(--cyan)",warning:"var(--amber)",danger:"var(--red)",event:"var(--purple)"};
  const add=async()=>{
    if(!form.title.trim()||!form.body.trim())return;
    const a=[{id:Date.now(),...form,createdAt:new Date().toISOString()},...ann];
    setAnn(a);await DB.setAnnouncements(a);
    setForm({title:"",body:"",type:"info",icon:"📢",active:true});
    toast("Announcement posted!","var(--cyan)","📢");
  };
  const toggle=async id=>{const a=ann.map(x=>x.id===id?{...x,active:!x.active}:x);setAnn(a);await DB.setAnnouncements(a);};
  const del=async id=>{const a=ann.filter(x=>x.id!==id);setAnn(a);await DB.setAnnouncements(a);};
  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:14}}>📢 HUB ANNOUNCEMENTS</div>
      <div style={{padding:"7px 12px",background:"rgba(0,245,255,.04)",border:"1px dashed rgba(0,245,255,.2)",borderRadius:6,marginBottom:14}}>
        <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.7}}>Active announcements appear as a banner on the main hub screen for all visitors. Use for server news, events, warnings.</div>
      </div>
      <div style={{display:"grid",gap:8,marginBottom:16,maxWidth:500}}>
        <div style={{display:"flex",gap:8}}><div style={{flex:1}}><label className="si-label">TITLE</label><input className="si" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Announcement title"/></div><div style={{width:70}}><label className="si-label">ICON</label><input className="si" value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))}/></div></div>
        <div><label className="si-label">MESSAGE</label><textarea className="si" rows={2} style={{resize:"vertical"}} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} placeholder="Announcement body..."/></div>
        <div><label className="si-label">TYPE</label><select className="si" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{Object.keys(TYPES).map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}</select></div>
        <button className="neon-btn" onClick={add} style={{borderColor:"var(--cyan)",color:"var(--cyan)",fontSize:9}}>⟩ POST ANNOUNCEMENT ⟨</button>
      </div>
      {ann.map(a=>{
        const col=TYPES[a.type]||"var(--cyan)";
        return(
          <div key={a.id} style={{border:`1px solid ${col}33`,borderRadius:8,padding:"10px 14px",marginBottom:8,background:`${col}08`,opacity:a.active?1:.5}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span>{a.icon}</span>
                <div>
                  <div className="orb" style={{fontSize:9,color:col}}>{a.title}</div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{new Date(a.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button onClick={()=>toggle(a.id)} style={{fontFamily:"Share Tech Mono",fontSize:8,padding:"3px 8px",borderRadius:3,border:`1px solid ${a.active?"rgba(57,255,20,.4)":"rgba(100,100,100,.3)"}`,color:a.active?"var(--green)":"var(--dim)",background:"none",cursor:"pointer"}}>{a.active?"LIVE":"HIDDEN"}</button>
                <button onClick={()=>del(a.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:14}}>×</button>
              </div>
            </div>
            <div className="mono" style={{fontSize:10,color:"var(--text)"}}>{a.body}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── FEATURE 10: SERVER STATS tab ─────────────────────────────────────────────

// ─── v6.0: Storage Requests Admin Tab ─────────────────────────────────────────
function StorageReqsTab({toast}){
  const[reqs,setReqs]=useState([]);
  useEffect(()=>{DB.getStorageRequests().then(setReqs);},[]);
  const approve=async(req,extraSlots=5)=>{
    const g=await DB.getGallery(req.username);
    const updated={...g,maxSlots:(g.maxSlots||10)+extraSlots};
    await DB.setGallery(req.username,updated);
    const updatedReqs=reqs.map(r=>r.id===req.id?{...r,status:"approved",approvedAt:new Date().toISOString(),slotGranted:extraSlots}:r);
    setReqs(updatedReqs);await DB.setStorageRequests(updatedReqs);
    toast(`Granted ${extraSlots} slots to ${req.username}!`,"var(--green)","✅");
  };
  const reject=async(id)=>{
    const updatedReqs=reqs.map(r=>r.id===id?{...r,status:"rejected"}:r);
    setReqs(updatedReqs);await DB.setStorageRequests(updatedReqs);
    toast("Request rejected.","var(--red)","❌");
  };
  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:14}}>📁 GALLERY STORAGE REQUESTS</div>
      {reqs.length===0?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>No storage requests yet.</div>:(
        <div style={{display:"grid",gap:8}}>
          {reqs.map(r=>(
            <div key={r.id} style={{border:`1px solid rgba(59,130,246,${r.status==="pending"?0.35:0.1})`,borderRadius:8,padding:"10px 14px",background:"rgba(0,10,30,.5)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
                <div>
                  <div className="orb" style={{fontSize:10,color:"var(--text)"}}>{r.username}</div>
                  <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:2}}>Current: {r.currentMax} slots · {new Date(r.ts||Date.now()).toLocaleDateString()}</div>
                  {r.message&&<div className="mono" style={{fontSize:9,color:"var(--text)",marginTop:4}}>{r.message}</div>}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <span className="mono" style={{fontSize:8,color:r.status==="approved"?"var(--green)":r.status==="rejected"?"var(--red)":"var(--amber)"}}>{r.status?.toUpperCase()||"PENDING"}</span>
                  {r.status==="pending"&&<>
                    <button onClick={()=>approve(r,5)} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>+5 SLOTS</button>
                    <button onClick={()=>approve(r,10)} style={{background:"rgba(0,245,255,.08)",border:"1px solid rgba(0,245,255,.25)",color:"var(--cyan)",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>+10 SLOTS</button>
                    <button onClick={()=>reject(r.id)} style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>REJECT</button>
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── v6.0: POTW Admin Tab ────────────────────────────────────────────────────
function POTWAdminTab({user,toast}){
  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:14}}>👑 PLAYER OF THE WEEK CONTROLS</div>
      <div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.8}}>
        Select, manage, and archive Player of the Week entries via the dedicated <strong style={{color:"var(--amber)"}}>POTW panel</strong> on the main hub. The panel includes full admin controls for selection, screenshot upload, and hall of fame.
      </div>
    </div>
  );
}

function StatsTab(){
  const[users,setUsers]=useState([]);
  const[surveys,setSurveys]=useState([]);
  const[wars,setWars]=useState([]);
  const[music,setMusic]=useState([]);
  const[trades,setTrades]=useState([]);
  const[achs,setAchs]=useState([]);
  useEffect(()=>{
    Promise.all([DB.getUsers(),DB.getSurveys(),DB.getWars(),DB.getMusicList(),DB.getTrades(),DB.getAchievements()])
      .then(([u,sv,w,m,t,a])=>{setUsers(u);setSurveys(sv);setWars(w);setMusic(m);setTrades(t);setAchs(a);});
  },[]);
  const joinDates=users.filter(u=>u.joinDate).sort((a,b)=>new Date(a.joinDate)-new Date(b.joinDate));
  const stats=[
    {icon:"👤",label:"Registered Players",value:users.length,color:"var(--cyan)"},
    {icon:"📋",label:"Survey Responses",value:surveys.length,color:"var(--blue)"},
    {icon:"⚔️",label:"Wars Recorded",value:wars.length,color:"var(--red)"},
    {icon:"🎵",label:"Music Tracks",value:music.length,color:"var(--purple)"},
    {icon:"💎",label:"Trade Listings",value:trades.length,color:"var(--green)"},
    {icon:"🏅",label:"Achievements Created",value:achs.length,color:"var(--amber)"},
    {icon:"🏆",label:"Achievements Awarded",value:achs.reduce((s,a)=>s+a.awardedTo.length,0),color:"var(--amber)"},
  ];
  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:14}}>📊 SERVER STATISTICS</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10,marginBottom:20}}>
        {stats.map(s=>(
          <div key={s.label} style={{background:`${s.color}0a`,border:`1px solid ${s.color}22`,borderRadius:8,padding:"12px 14px",textAlign:"center"}}>
            <div style={{fontSize:22,marginBottom:6}}>{s.icon}</div>
            <div className="orb" style={{fontSize:14,color:s.color,marginBottom:4}}>{s.value}</div>
            <div className="mono" style={{fontSize:8,color:"var(--dim)",lineHeight:1.5}}>{s.label}</div>
          </div>
        ))}
      </div>
      {joinDates.length>0&&(
        <div>
          <div className="mono" style={{fontSize:8,color:"var(--dim)",letterSpacing:2,marginBottom:8}}>FIRST TO JOIN</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {joinDates.slice(0,5).map((u,i)=>(
              <div key={u.username} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 10px",background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.1)",borderRadius:6}}>
                <span className="mono" style={{fontSize:9,color:"var(--amber)"}}>{i+1}.</span>
                <span className="mono" style={{fontSize:9,color:"var(--text)"}}>{u.username}</span>
                <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>{new Date(u.joinDate).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 1: CHANGELOG — admin posts updates, everyone sees them
// ═══════════════════════════════════════════════════════════════════════════════
function ChangelogPanel({onClose,user}){
  const toast=useToast();
  const[entries,setEntries]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({version:"",title:"",body:"",type:"update"});
  const[adding,setAdding]=useState(false);
  useEffect(()=>{DB.getChangelog().then(e=>{setEntries(e);setLoading(false);});},[]);
  const TYPES={update:{color:"var(--cyan)",icon:"🔄"},hotfix:{color:"var(--red)",icon:"🔥"},event:{color:"var(--purple)",icon:"🎉"},season:{color:"var(--amber)",icon:"🗓"}};
  const add=async()=>{
    if(!form.title.trim()||!form.body.trim())return;
    setAdding(true);
    const e=[{id:Date.now(),postedAt:new Date().toISOString(),postedBy:user.username,...form},...entries];
    setEntries(e);await DB.setChangelog(e);
    await DB.pushNotif({type:"system",title:`CHANGELOG: ${form.title.toUpperCase()}`,body:form.body.slice(0,80)});
    setForm({version:"",title:"",body:"",type:"update"});setAdding(false);
    toast("Changelog posted!","var(--cyan)","📋");
  };
  const del=async id=>{const e=entries.filter(x=>x.id!==id);setEntries(e);await DB.setChangelog(e);};
  return(
    <Panel title="SERVER CHANGELOG" subtitle="UPDATES · PATCHES · EVENTS" color="var(--cyan)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>
        {user?.isAdmin&&(
          <div style={{background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.15)",borderRadius:8,padding:14,marginBottom:18}}>
            <div className="orb" style={{fontSize:7,color:"var(--cyan)",letterSpacing:2,marginBottom:10}}>+ POST UPDATE</div>
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label className="si-label">TYPE</label>
                  <select className="si" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                    {Object.keys(TYPES).map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div style={{width:100}}><label className="si-label">VERSION</label><input className="si" value={form.version} onChange={e=>setForm(f=>({...f,version:e.target.value}))} placeholder="v1.2.0"/></div>
              </div>
              <div><label className="si-label">TITLE</label><input className="si" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="What changed?"/></div>
              <div><label className="si-label">DETAILS</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} placeholder="Describe the changes..."/></div>
              <button className="neon-btn" onClick={add} disabled={adding} style={{borderColor:"var(--cyan)",color:"var(--cyan)",fontSize:9}}>{adding?"POSTING...":"⟩ POST CHANGELOG ⟨"}</button>
            </div>
          </div>
        )}
        {loading?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>LOADING...</div>
        :entries.length===0?<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:32,marginBottom:8}}>📋</div><div className="mono" style={{color:"var(--dim)"}}>No changelog entries yet.</div></div>
        :entries.map(e=>{
          const T=TYPES[e.type]||TYPES.update;
          return(
            <div key={e.id} className="cl-entry" style={{borderLeftColor:T.color}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:6,marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:16}}>{T.icon}</span>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <span className="orb" style={{fontSize:10,color:T.color}}>{e.title}</span>
                      {e.version&&<span className="mono" style={{fontSize:8,padding:"1px 6px",border:`1px solid ${T.color}44`,borderRadius:3,color:T.color}}>{e.version}</span>}
                    </div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:2}}>{new Date(e.postedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})} · by {e.postedBy}</div>
                  </div>
                </div>
                {user?.isAdmin&&<button onClick={()=>del(e.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:13}}>×</button>}
              </div>
              <div className="mono" style={{fontSize:11,color:"var(--text)",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{e.body}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 2: EVENT COUNTDOWN — admin sets events with dates, everyone sees timer
// ═══════════════════════════════════════════════════════════════════════════════
function useCountdown(target){
  const[diff,setDiff]=useState(0);
  useEffect(()=>{
    const calc=()=>setDiff(Math.max(0,new Date(target)-Date.now()));
    calc();const t=setInterval(calc,1000);return()=>clearInterval(t);
  },[target]);
  const d=Math.floor(diff/86400000);
  const h=Math.floor((diff%86400000)/3600000);
  const m=Math.floor((diff%3600000)/60000);
  const s=Math.floor((diff%60000)/1000);
  return{d,h,m,s,over:diff===0};
}
function CountdownUnit({n,label}){
  return(
    <div className="countdown-unit">
      <div className="orb" style={{fontSize:22,color:"var(--cyan)",lineHeight:1}}>{String(n).padStart(2,"0")}</div>
      <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:4,letterSpacing:2}}>{label}</div>
    </div>
  );
}
function EventsPanel({onClose,user}){
  const toast=useToast();
  const[events,setEvents]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({name:"",date:"",desc:"",icon:"🎮"});
  const[now,setNow]=useState(Date.now());
  useEffect(()=>{DB.getEvents().then(e=>{setEvents(e);setLoading(false);});},[]);
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
  const add=async()=>{
    if(!form.name.trim()||!form.date)return;
    const e=[...events,{id:Date.now(),...form,createdBy:user.username}].sort((a,b)=>new Date(a.date)-new Date(b.date));
    setEvents(e);await DB.setEvents(e);
    setForm({name:"",date:"",desc:"",icon:"🎮"});toast("Event added!","var(--purple)","🎉");
  };
  const del=async id=>{const e=events.filter(x=>x.id!==id);setEvents(e);await DB.setEvents(e);};
  const upcoming=events.filter(e=>new Date(e.date)>now).sort((a,b)=>new Date(a.date)-new Date(b.date));
  const past=events.filter(e=>new Date(e.date)<=now).sort((a,b)=>new Date(b.date)-new Date(a.date));
  function EventCard({ev}){
    const{d,h,m,s,over}=useCountdown(ev.date);
    return(
      <div style={{border:`1px solid ${over?"rgba(100,100,100,.2)":"rgba(180,77,255,.25)"}`,borderRadius:10,padding:16,marginBottom:12,background:over?"rgba(10,10,10,.4)":"rgba(20,5,40,.5)",opacity:over?0.6:1}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:28}}>{ev.icon}</span>
            <div>
              <div className="orb" style={{fontSize:11,color:over?"var(--dim)":"var(--purple)",letterSpacing:1}}>{ev.name}</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>{new Date(ev.date).toLocaleString()}</div>
            </div>
          </div>
          {user?.isAdmin&&<button onClick={()=>del(ev.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:14}}>×</button>}
        </div>
        {ev.desc&&<div className="mono" style={{fontSize:10,color:"var(--text)",marginBottom:10,lineHeight:1.6}}>{ev.desc}</div>}
        {over
          ?<div className="orb" style={{fontSize:9,color:"var(--dim)",letterSpacing:3,textAlign:"center",padding:"8px 0"}}>EVENT HAS PASSED</div>
          :<div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <CountdownUnit n={d} label="DAYS"/>
            <CountdownUnit n={h} label="HRS"/>
            <CountdownUnit n={m} label="MIN"/>
            <CountdownUnit n={s} label="SEC"/>
          </div>
        }
      </div>
    );
  }
  return(
    <Panel title="EVENTS & COUNTDOWNS" subtitle="UPCOMING SMP EVENTS" color="var(--purple)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>
        {user?.isAdmin&&(
          <div style={{background:"rgba(180,77,255,.05)",border:"1px solid rgba(180,77,255,.2)",borderRadius:8,padding:14,marginBottom:18}}>
            <div className="orb" style={{fontSize:7,color:"var(--purple)",letterSpacing:2,marginBottom:10}}>+ ADD EVENT</div>
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"flex",gap:8}}><div style={{flex:1}}><label className="si-label">EVENT NAME</label><input className="si" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Season 2 Launch"/></div><div style={{width:70}}><label className="si-label">ICON</label><input className="si" value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))} placeholder="🎮"/></div></div>
              <div><label className="si-label">DATE & TIME</label><input className="si" type="datetime-local" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
              <div><label className="si-label">DESCRIPTION (optional)</label><input className="si" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="What happens at this event?"/></div>
              <button className="neon-btn" onClick={add} style={{borderColor:"var(--purple)",color:"var(--purple)",fontSize:9}}>⟩ ADD EVENT ⟨</button>
            </div>
          </div>
        )}
        {loading?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>LOADING...</div>
        :<>
          {upcoming.length===0&&past.length===0&&<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:32,marginBottom:8}}>🗓</div><div className="mono" style={{color:"var(--dim)"}}>No events scheduled yet.</div></div>}
          {upcoming.length>0&&<><div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:12}}>UPCOMING · {upcoming.length}</div>{upcoming.map(e=><EventCard key={e.id} ev={e}/>)}</>}
          {past.length>0&&<><div className="orb" style={{fontSize:8,color:"var(--dim)",letterSpacing:2,marginBottom:12,marginTop:16}}>PAST EVENTS · {past.length}</div>{past.map(e=><EventCard key={e.id} ev={e}/>)}</>}
        </>}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 3: COMMUNITY POLLS — players vote, see live results
// ═══════════════════════════════════════════════════════════════════════════════
function PollsPanel({onClose,user}){
  const toast=useToast();
  const[polls,setPolls]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({question:"",options:["",""],multi:false});
  useEffect(()=>{DB.getPolls().then(p=>{setPolls(p);setLoading(false);});},[]);
  const addOption=()=>setForm(f=>({...f,options:[...f.options,""]}));
  const setOpt=(i,v)=>setForm(f=>({...f,options:f.options.map((o,j)=>j===i?v:o)}));
  const createPoll=async()=>{
    const opts=form.options.filter(o=>o.trim());
    if(!form.question.trim()||opts.length<2)return;
    const p=[{id:Date.now(),question:form.question.trim(),options:opts.map(o=>({text:o.trim(),votes:[]})),multi:form.multi,createdAt:new Date().toISOString(),createdBy:user.username,active:true},...polls];
    setPolls(p);await DB.setPolls(p);
    setForm({question:"",options:["",""],multi:false});toast("Poll created!","var(--blue)","🗳");
  };
  const vote=async(pollId,optIdx)=>{
    if(!user)return toast("Log in to vote.","var(--red)","⚠");
    const updated=polls.map(p=>{
      if(p.id!==pollId)return p;
      const opts=p.options.map((o,i)=>{
        if(!p.multi){const filtered=o.votes.filter(v=>v!==user.username);return i===optIdx?{...o,votes:[...filtered,user.username]}:{...o,votes:filtered};}
        if(i===optIdx){const has=o.votes.includes(user.username);return{...o,votes:has?o.votes.filter(v=>v!==user.username):[...o.votes,user.username]};}
        return o;
      });
      return{...p,options:opts};
    });
    setPolls(updated);await DB.setPolls(updated);
  };
  const closePoll=async id=>{const p=polls.map(x=>x.id===id?{...x,active:false}:x);setPolls(p);await DB.setPolls(p);};
  const delPoll=async id=>{const p=polls.filter(x=>x.id!==id);setPolls(p);await DB.setPolls(p);};
  return(
    <Panel title="COMMUNITY POLLS" subtitle="VOTE · DECIDE · TOGETHER" color="var(--blue)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>
        {user?.isAdmin&&(
          <div style={{background:"rgba(59,130,246,.05)",border:"1px solid rgba(59,130,246,.2)",borderRadius:8,padding:14,marginBottom:18}}>
            <div className="orb" style={{fontSize:7,color:"var(--blue)",letterSpacing:2,marginBottom:10}}>+ CREATE POLL</div>
            <div style={{display:"grid",gap:8}}>
              <div><label className="si-label">QUESTION</label><input className="si" value={form.question} onChange={e=>setForm(f=>({...f,question:e.target.value}))} placeholder="What should we vote on?"/></div>
              {form.options.map((o,i)=><div key={i}><label className="si-label">OPTION {i+1}</label><input className="si" value={o} onChange={e=>setOpt(i,e.target.value)} placeholder={`Choice ${i+1}...`}/></div>)}
              <button type="button" onClick={addOption} style={{background:"none",border:"1px dashed rgba(59,130,246,.3)",color:"var(--blue)",borderRadius:5,padding:"7px",cursor:"pointer",fontSize:10,fontFamily:"Share Tech Mono"}}>+ ADD OPTION</button>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}><input type="checkbox" checked={form.multi} onChange={e=>setForm(f=>({...f,multi:e.target.checked}))}/><span className="mono" style={{fontSize:10,color:"var(--dim)"}}>Allow multiple choices</span></label>
              <button className="neon-btn" onClick={createPoll} style={{borderColor:"var(--blue)",color:"var(--blue)",fontSize:9}}>⟩ CREATE POLL ⟨</button>
            </div>
          </div>
        )}
        {loading?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>LOADING...</div>
        :polls.length===0?<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:32,marginBottom:8}}>🗳</div><div className="mono" style={{color:"var(--dim)"}}>No polls yet.</div></div>
        :polls.map(poll=>{
          const total=poll.options.reduce((s,o)=>s+o.votes.length,0)||1;
          const myVotes=poll.options.filter(o=>user&&o.votes.includes(user.username));
          return(
            <div key={poll.id} style={{border:`1px solid rgba(59,130,246,${poll.active?0.3:0.1})`,borderRadius:10,padding:16,marginBottom:14,background:"rgba(0,8,22,.5)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div>
                  <div className="orb" style={{fontSize:11,color:poll.active?"var(--blue)":"var(--dim)",letterSpacing:1}}>{poll.question}</div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:2}}>{poll.active?"ACTIVE":"CLOSED"} · {new Date(poll.createdAt).toLocaleDateString()} · by {poll.createdBy}</div>
                </div>
                {user?.isAdmin&&<div style={{display:"flex",gap:6}}>
                  {poll.active&&<button onClick={()=>closePoll(poll.id)} style={{fontFamily:"Share Tech Mono",fontSize:8,padding:"3px 8px",borderRadius:3,border:"1px solid rgba(251,191,36,.4)",color:"var(--amber)",background:"none",cursor:"pointer"}}>CLOSE</button>}
                  <button onClick={()=>delPoll(poll.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:13}}>×</button>
                </div>}
              </div>
              <div style={{display:"grid",gap:8}}>
                {poll.options.map((opt,i)=>{
                  const pct=Math.round((opt.votes.length/total)*100);
                  const voted=user&&opt.votes.includes(user.username);
                  return(
                    <div key={i} className={`vote-opt${voted?" voted":""}`} onClick={()=>poll.active&&vote(poll.id,i)}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                        <span className="mono" style={{fontSize:11,color:"var(--text)"}}>{voted?"✓ ":""}{opt.text}</span>
                        <span className="mono" style={{fontSize:10,color:"var(--cyan)"}}>{opt.votes.length} · {pct}%</span>
                      </div>
                      <div style={{height:6,background:"rgba(0,245,255,.08)",borderRadius:3,overflow:"hidden"}}>
                        <div className="poll-bar" style={{width:`${pct}%`,background:voted?"var(--cyan)":"rgba(0,245,255,.4)"}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!poll.active&&<div className="mono" style={{fontSize:8,color:"var(--dim)",textAlign:"right",marginTop:8}}>Total votes: {poll.options.reduce((s,o)=>s+o.votes.length,0)}</div>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 4: TRADE BOARD — players post WTS/WTB listings
// ═══════════════════════════════════════════════════════════════════════════════
function TradeBoardPanel({onClose,user}){
  const toast=useToast();
  const[trades,setTrades]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({item:"",amount:"",price:"",type:"WTS",desc:""});
  const[filter,setFilter]=useState("ALL");
  useEffect(()=>{DB.getTrades().then(t=>{setTrades(t);setLoading(false);});},[]);
  const post=async()=>{
    if(!user)return toast("Log in to post trades.","var(--red)","⚠");
    if(!form.item.trim()||!form.price.trim())return;
    const t=[{id:Date.now(),...form,seller:user.username,postedAt:new Date().toISOString(),active:true},...trades];
    setTrades(t);await DB.setTrades(t);
    setForm({item:"",amount:"",price:"",type:"WTS",desc:""});toast("Trade posted!","var(--green)","💎");
  };
  const close=async id=>{const t=trades.map(x=>x.id===id?{...x,active:false}:x);setTrades(t);await DB.setTrades(t);};
  const del=async id=>{const t=trades.filter(x=>x.id!==id);setTrades(t);await DB.setTrades(t);};
  const TYPE_COLOR={WTS:"var(--green)",WTB:"var(--amber)",TRADE:"var(--purple)"};
  const visible=trades.filter(t=>filter==="ALL"||t.type===filter);
  return(
    <Panel title="TRADE BOARD" subtitle="PLAYER ECONOMY · BUY · SELL · TRADE" color="var(--green)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>
        {user&&!user.isAdmin&&(
          <div style={{background:"rgba(57,255,20,.04)",border:"1px solid rgba(57,255,20,.2)",borderRadius:8,padding:14,marginBottom:18}}>
            <div className="orb" style={{fontSize:7,color:"var(--green)",letterSpacing:2,marginBottom:10}}>+ POST LISTING</div>
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label className="si-label">ITEM</label><input className="si" value={form.item} onChange={e=>setForm(f=>({...f,item:e.target.value}))} placeholder="e.g. Diamond Sword (Sharpness V)"/></div>
                <div style={{width:80}}><label className="si-label">AMOUNT</label><input className="si" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="x32"/></div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label className="si-label">PRICE (diamonds/items)</label><input className="si" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} placeholder="e.g. 5 diamonds"/></div>
                <div style={{width:100}}><label className="si-label">TYPE</label>
                  <select className="si" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                    <option value="WTS">WTS (Selling)</option><option value="WTB">WTB (Buying)</option><option value="TRADE">Trade</option>
                  </select>
                </div>
              </div>
              <div><label className="si-label">NOTE (optional)</label><input className="si" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="Any extra details..."/></div>
              <button className="neon-btn" onClick={post} style={{borderColor:"var(--green)",color:"var(--green)",fontSize:9}}>⟩ POST LISTING ⟨</button>
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:7,marginBottom:14}}>
          {["ALL","WTS","WTB","TRADE"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:1,padding:"5px 12px",borderRadius:4,cursor:"pointer",background:filter===f?"rgba(57,255,20,.12)":"transparent",border:`1px solid ${filter===f?"var(--green)":"rgba(57,255,20,.2)"}`,color:filter===f?"var(--green)":"var(--dim)",transition:"all .2s"}}>{f}</button>)}
        </div>
        {loading?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>LOADING...</div>
        :visible.length===0?<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:32,marginBottom:8}}>💎</div><div className="mono" style={{color:"var(--dim)"}}>No listings yet. Be the first!</div></div>
        :<div style={{display:"grid",gap:10}}>
          {visible.map(t=>(
            <div key={t.id} className="trade-card" style={{opacity:t.active?1:.5,borderColor:t.active?`rgba(57,255,20,.2)`:undefined}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontFamily:"Orbitron",fontSize:8,padding:"3px 8px",borderRadius:3,background:`${TYPE_COLOR[t.type]}18`,border:`1px solid ${TYPE_COLOR[t.type]}44`,color:TYPE_COLOR[t.type],letterSpacing:2}}>{t.type}</span>
                  <div>
                    <div className="orb" style={{fontSize:10,color:"var(--text)"}}>{t.item}{t.amount&&` × ${t.amount}`}</div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>by {t.seller} · {new Date(t.postedAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                  <div className="orb" style={{fontSize:11,color:TYPE_COLOR[t.type]}}>💎 {t.price}</div>
                  {(user?.username===t.seller||user?.isAdmin)&&(
                    <div style={{display:"flex",gap:5}}>
                      {t.active&&<button onClick={()=>close(t.id)} style={{fontFamily:"Share Tech Mono",fontSize:7,padding:"2px 7px",borderRadius:3,border:"1px solid rgba(251,191,36,.4)",color:"var(--amber)",background:"none",cursor:"pointer"}}>SOLD</button>}
                      <button onClick={()=>del(t.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:12}}>×</button>
                    </div>
                  )}
                </div>
              </div>
              {t.desc&&<div className="mono" style={{fontSize:9,color:"var(--dim)",borderTop:"1px solid rgba(57,255,20,.08)",paddingTop:6,marginTop:4}}>{t.desc}</div>}
              {!t.active&&<div className="orb" style={{fontSize:7,color:"var(--dim)",letterSpacing:2,marginTop:6}}>COMPLETED</div>}
            </div>
          ))}
        </div>}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 5: ACHIEVEMENTS — admin creates, players get awarded
// ═══════════════════════════════════════════════════════════════════════════════
function AchievementsPanel({onClose,user}){
  const toast=useToast();
  const[achs,setAchs]=useState([]);
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({name:"",desc:"",icon:"🏅",rarity:"common"});
  const RARITY={common:{color:"var(--dim)",label:"COMMON"},rare:{color:"var(--blue)",label:"RARE"},epic:{color:"var(--purple)",label:"EPIC"},legendary:{color:"var(--amber)",label:"LEGENDARY"}};
  useEffect(()=>{Promise.all([DB.getAchievements(),DB.getUsers()]).then(([a,u])=>{setAchs(a);setUsers(u);setLoading(false);});},[]);
  const addAch=async()=>{
    if(!form.name.trim())return;
    const a=[...achs,{id:Date.now(),...form,awardedTo:[]}];
    setAchs(a);await DB.setAchievements(a);
    setForm({name:"",desc:"",icon:"🏅",rarity:"common"});toast("Achievement created!","var(--amber)","🏅");
  };
  const award=async(achId,username)=>{
    const a=achs.map(x=>x.id===achId?{...x,awardedTo:x.awardedTo.includes(username)?x.awardedTo.filter(u=>u!==username):[...x.awardedTo,username]}:x);
    setAchs(a);await DB.setAchievements(a);
    await DB.pushNotif({type:"system",title:"ACHIEVEMENT UNLOCKED",body:`${username} earned: ${achs.find(x=>x.id===achId)?.name}`});
  };
  const delAch=async id=>{const a=achs.filter(x=>x.id!==id);setAchs(a);await DB.setAchievements(a);};
  const myAchs=user?achs.filter(a=>a.awardedTo.includes(user.username)):[];
  return(
    <Panel title="ACHIEVEMENTS" subtitle="HALL OF GLORY · EARN YOUR LEGEND" color="var(--amber)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>
        {user&&!user.isAdmin&&myAchs.length>0&&(
          <div style={{background:"rgba(251,191,36,.05)",border:"1px solid rgba(251,191,36,.2)",borderRadius:8,padding:12,marginBottom:16}}>
            <div className="orb" style={{fontSize:7,color:"var(--amber)",letterSpacing:2,marginBottom:8}}>YOUR ACHIEVEMENTS · {myAchs.length}</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {myAchs.map(a=><div key={a.id} title={a.desc} style={{padding:"4px 10px",background:`${RARITY[a.rarity]?.color||"#555"}18`,border:`1px solid ${RARITY[a.rarity]?.color||"#555"}44`,borderRadius:5,display:"flex",alignItems:"center",gap:5}}>
                <span>{a.icon}</span><span className="mono" style={{fontSize:9,color:"var(--text)"}}>{a.name}</span>
              </div>)}
            </div>
          </div>
        )}
        {user?.isAdmin&&(
          <div style={{background:"rgba(251,191,36,.04)",border:"1px solid rgba(251,191,36,.2)",borderRadius:8,padding:14,marginBottom:18}}>
            <div className="orb" style={{fontSize:7,color:"var(--amber)",letterSpacing:2,marginBottom:10}}>+ CREATE ACHIEVEMENT</div>
            <div style={{display:"grid",gap:8}}>
              <div style={{display:"flex",gap:8}}>
                <div style={{flex:1}}><label className="si-label">NAME</label><input className="si" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Dragon Slayer"/></div>
                <div style={{width:70}}><label className="si-label">ICON</label><input className="si" value={form.icon} onChange={e=>setForm(f=>({...f,icon:e.target.value}))}/></div>
              </div>
              <div><label className="si-label">DESCRIPTION</label><input className="si" value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="How to earn this..."/></div>
              <div><label className="si-label">RARITY</label><select className="si" value={form.rarity} onChange={e=>setForm(f=>({...f,rarity:e.target.value}))}>{Object.entries(RARITY).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
              <button className="neon-btn" onClick={addAch} style={{borderColor:"var(--amber)",color:"var(--amber)",fontSize:9}}>⟩ CREATE ⟨</button>
            </div>
          </div>
        )}
        {loading?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"30px 0"}}>LOADING...</div>
        :achs.length===0?<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:32,marginBottom:8}}>🏅</div><div className="mono" style={{color:"var(--dim)"}}>No achievements yet. Admin creates them.</div></div>
        :<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
          {achs.map(a=>{
            const R=RARITY[a.rarity]||RARITY.common;
            const unlocked=user&&a.awardedTo.includes(user.username);
            return(
              <div key={a.id} className={`ach-card ${unlocked?"unlocked":"locked"}`}>
                {user?.isAdmin&&<button onClick={()=>delAch(a.id)} style={{position:"absolute",top:8,right:8,background:"none",border:"none",color:"rgba(255,68,68,.4)",cursor:"pointer",fontSize:12}}>×</button>}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <span style={{fontSize:32,filter:unlocked?"none":"grayscale(1)"}}>{a.icon}</span>
                  <div>
                    <div className="orb" style={{fontSize:10,color:unlocked?R.color:"var(--dim)",letterSpacing:1}}>{a.name}</div>
                    <div style={{fontSize:7,fontFamily:"Orbitron",padding:"1px 6px",borderRadius:2,display:"inline-block",background:`${R.color}18`,border:`1px solid ${R.color}33`,color:R.color,letterSpacing:2,marginTop:2}}>{R.label}</div>
                  </div>
                </div>
                {a.desc&&<div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.6,marginBottom:8}}>{a.desc}</div>}
                <div className="mono" style={{fontSize:8,color:unlocked?"var(--green)":"var(--dim)",marginBottom:user?.isAdmin?8:0}}>{unlocked?"✅ UNLOCKED":"🔒 LOCKED"} · {a.awardedTo.length} player{a.awardedTo.length!==1?"s":""}</div>
                {user?.isAdmin&&(
                  <div style={{borderTop:"1px solid rgba(251,191,36,.1)",paddingTop:8}}>
                    <div className="mono" style={{fontSize:7,color:"var(--dim)",marginBottom:5,letterSpacing:1}}>AWARD TO:</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                      {users.map(u=>(
                        <button key={u.username} onClick={()=>award(a.id,u.username)}
                          style={{fontFamily:"Share Tech Mono",fontSize:8,padding:"2px 7px",borderRadius:3,cursor:"pointer",transition:"all .2s",
                            background:a.awardedTo.includes(u.username)?"rgba(57,255,20,.15)":"rgba(0,245,255,.04)",
                            border:`1px solid ${a.awardedTo.includes(u.username)?"rgba(57,255,20,.5)":"rgba(0,245,255,.2)"}`,
                            color:a.awardedTo.includes(u.username)?"var(--green)":"var(--dim)"}}>
                          {u.username}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 6: SERVER ANNOUNCEMENTS — pinned banner visible on hub
// ═══════════════════════════════════════════════════════════════════════════════
function useAnnouncements(){
  const[ann,setAnn]=useState([]);
  useEffect(()=>{DB.getAnnouncements().then(setAnn);},[]);
  return[ann,setAnn];
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FEATURE 7: PLAYER REPUTATION — upvote/endorse other players
// ═══════════════════════════════════════════════════════════════════════════════
// Integrated into player cards (inline endorse button)

// ═══════════════════════════════════════════════════════════════════════════════
//  v6.0 FEATURE 1: MULTI-CHANNEL CHAT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const CHAT_EMOJIS=["👍","❤️","😂","😮","🔥","💎","⚔️","🏆"];
const RARITY_COLORS={common:"var(--dim)",uncommon:"var(--green)",rare:"var(--blue)",epic:"var(--purple)",legendary:"var(--amber)"};

function ChatPanel({onClose,user}){
  const toast=useToast();
  const[channel,setChannel]=useState("global");
  const[messages,setMessages]=useState([]);
  const[text,setText]=useState("");
  const[sending,setSending]=useState(false);
  const[dmTarget,setDmTarget]=useState("");
  const[users,setUsers]=useState([]);
  const[emojiPickerFor,setEmojiPickerFor]=useState(null);
  const[recording,setRecording]=useState(false);
  const[mediaRecorder,setMediaRecorder]=useState(null);
  const[audioChunks,setAudioChunks]=useState([]);
  const bottomRef=useRef(null);
  const pollRef=useRef(null);

  useEffect(()=>{DB.getUsers().then(u=>setUsers(u.filter(x=>!x.isAdmin)));},[]);

  const getChannelKey=()=>{
    if(channel==="global")return"global";
    if(channel==="alliance")return"alliance";
    if(channel==="dm"&&dmTarget&&user)return`dm_${[user.username,dmTarget].sort().join("_")}`;
    return null;
  };

  const loadMessages=async()=>{
    const key=getChannelKey();
    if(!key)return;
    const msgs=await DB.getMessages(key);
    setMessages(msgs);
  };

  useEffect(()=>{
    loadMessages();
    pollRef.current=setInterval(loadMessages,2500);
    return()=>clearInterval(pollRef.current);
  },[channel,dmTarget]);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const sendMsg=async()=>{
    const key=getChannelKey();
    if(!key||!text.trim()||!user)return;
    setSending(true);
    await DB.pushMessage(key,{text:text.trim(),username:user.username,type:channel,reactions:{},deleted:false,participants:channel==="dm"?[user.username,dmTarget]:null,allianceId:channel==="alliance"?"main":null});
    setText("");setSending(false);
  };

  const deleteMsg=async(msg)=>{
    const key=getChannelKey();
    const updated=messages.map(m=>m.id===msg.id?{...m,deleted:true}:m);
    setMessages(updated);
    await DB.setMessages(key,updated);
  };

  const reactMsg=async(msgId,emoji)=>{
    if(!user)return;
    const key=getChannelKey();
    const updated=messages.map(m=>{
      if(m.id!==msgId)return m;
      const r={...(m.reactions||{})};
      const list=r[emoji]||[];
      r[emoji]=list.includes(user.username)?list.filter(u=>u!==user.username):[...list,user.username];
      return{...m,reactions:r};
    });
    setMessages(updated);
    await DB.setMessages(key,updated);
    setEmojiPickerFor(null);
  };

  const startRecording=async()=>{
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mr=new MediaRecorder(stream);
      const chunks=[];
      mr.ondataavailable=e=>chunks.push(e.data);
      mr.onstop=async()=>{
        const blob=new Blob(chunks,{type:"audio/webm"});
        const file=new File([blob],"voice.webm",{type:"audio/webm"});
        try{
          const url=await CLOUDINARY.upload(file,"nexsci/voice");
          const key=getChannelKey();
          if(key&&user)await DB.pushMessage(key,{voiceUrl:url,username:user.username,type:channel,reactions:{},deleted:false});
          toast("Voice message sent!","var(--cyan)","🎙");
        }catch{toast("Failed to upload voice message.","var(--red)","❌");}
        stream.getTracks().forEach(t=>t.stop());
        setRecording(false);
      };
      mr.start();
      setMediaRecorder(mr);setRecording(true);
      setTimeout(()=>{if(mr.state==="recording")mr.stop()},60000);
    }catch{toast("Microphone access denied.","var(--red)","🎙");}
  };

  const stopRecording=()=>{if(mediaRecorder&&recording)mediaRecorder.stop();};

  const channels=[{id:"global",label:"🌐 GLOBAL",color:"var(--cyan)"},{id:"dm",label:"💬 DIRECT MSG",color:"var(--purple)"},{id:"alliance",label:"⚔️ ALLIANCE",color:"var(--red)"}];
  const canChat=!!user;

  return(
    <Panel title="CHAT SYSTEM" subtitle="GLOBAL · DM · ALLIANCE" color="var(--cyan)" onClose={onClose} wide>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {channels.map(c=>(
          <button key={c.id} className={`chat-channel-btn${channel===c.id?" active":""}`} onClick={()=>setChannel(c.id)} style={{borderColor:channel===c.id?c.color:"",color:channel===c.id?c.color:""}}>{c.label}</button>
        ))}
      </div>
      {channel==="dm"&&(
        <div style={{marginBottom:12}}>
          <label className="si-label">DM TO</label>
          <select className="si" value={dmTarget} onChange={e=>setDmTarget(e.target.value)}>
            <option value="">— Select player —</option>
            {users.filter(u=>u.username!==user?.username).map(u=><option key={u.username} value={u.username}>{u.username}</option>)}
          </select>
        </div>
      )}
      {/* Message list */}
      <div style={{height:"52vh",overflowY:"auto",display:"flex",flexDirection:"column",gap:2,padding:"8px 4px",marginBottom:4}}>
        {messages.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}>
          <div style={{fontSize:28,marginBottom:8}}>💬</div>
          <div className="mono" style={{fontSize:10}}>No messages yet. Say something!</div>
        </div>}
        {messages.map(m=>{
          if(m.deleted)return<div key={m.id} className="chat-msg"><span className="mono" style={{fontSize:9,color:"rgba(255,68,68,.4)",fontStyle:"italic"}}>🗑 Message deleted</span></div>;
          const isOwn=user&&m.username===user.username;
          const isAdmin=user?.isAdmin;
          const canDel=isOwn||isAdmin;
          return(
            <div key={m.id} className="chat-msg" style={{alignSelf:isOwn?"flex-end":"flex-start",maxWidth:"75%",background:isOwn?"rgba(0,245,255,.06)":"rgba(180,77,255,.05)",border:`1px solid ${isOwn?"rgba(0,245,255,.15)":"rgba(180,77,255,.1)"}`,borderRadius:isOwn?"12px 4px 12px 12px":"4px 12px 12px 12px"}}>
              {!isOwn&&<div className="orb" style={{fontSize:8,color:"var(--cyan)",marginBottom:3,letterSpacing:1}}>{m.username}</div>}
              {m.voiceUrl
                ?<div className="voice-bar"><span style={{fontSize:14}}>🎙</span><audio controls src={m.voiceUrl} style={{height:28,flex:1}}/></div>
                :<div className="mono" style={{fontSize:11,color:"var(--text)",lineHeight:1.6}}>{m.text}</div>
              }
              {/* Reactions */}
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                {Object.entries(m.reactions||{}).filter(([,list])=>list.length>0).map(([emoji,list])=>(
                  <button key={emoji} className={`reaction-btn${user&&list.includes(user.username)?" reacted":""}`} onClick={()=>reactMsg(m.id,emoji)}>
                    <span>{emoji}</span><span className="mono" style={{fontSize:8}}>{list.length}</span>
                  </button>
                ))}
              </div>
              <div style={{display:"flex",gap:5,marginTop:3,alignItems:"center"}}>
                <span className="mono" style={{fontSize:7,color:"var(--dim)"}}>{new Date(m.ts||Date.now()).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
                {user&&<button onClick={()=>setEmojiPickerFor(emojiPickerFor===m.id?null:m.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"var(--dim)",padding:"0 2px"}}>😀</button>}
                {canDel&&<button onClick={()=>deleteMsg(m)} style={{background:"none",border:"none",cursor:"pointer",fontSize:9,color:"rgba(255,68,68,.5)",padding:"0 2px"}}>🗑</button>}
              </div>
              {emojiPickerFor===m.id&&(
                <div className="emoji-picker">
                  {CHAT_EMOJIS.map(e=><button key={e} onClick={()=>reactMsg(m.id,e)} style={{background:"none",border:"none",cursor:"pointer",fontSize:18,padding:2}}>{e}</button>)}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>
      {/* Input */}
      {canChat?(
        <div className="chat-input-wrap">
          <textarea className="si" rows={2} style={{flex:1,resize:"none",padding:"8px 10px"}} placeholder={channel==="dm"&&!dmTarget?"Select a player to DM...":"Type a message..."} value={text} onChange={e=>setText(e.target.value)} disabled={channel==="dm"&&!dmTarget} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}}/>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button className="neon-btn" onClick={sendMsg} disabled={sending||!text.trim()||(channel==="dm"&&!dmTarget)} style={{fontSize:8,padding:"8px 14px",borderColor:"var(--cyan)",color:"var(--cyan)"}}>SEND</button>
            <button onClick={recording?stopRecording:startRecording} style={{background:recording?"rgba(255,68,68,.15)":"rgba(0,245,255,.07)",border:`1px solid ${recording?"var(--red)":"rgba(0,245,255,.2)"}`,borderRadius:4,color:recording?"var(--red)":"var(--dim)",cursor:"pointer",padding:"6px",fontSize:13,transition:"all .2s"}} title="Voice message (max 60s)">
              {recording?"⏹":"🎙"}
            </button>
          </div>
        </div>
      ):(
        <div style={{textAlign:"center",padding:"14px",color:"var(--dim)"}}><span className="mono" style={{fontSize:10}}>🔐 Log in to chat</span></div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v6.0 FEATURE 2: SEASON PASS / CHALLENGES
// ═══════════════════════════════════════════════════════════════════════════════
const XP_PER_LEVEL=500;
const PREMIUM_START=81;

function SeasonPassPanel({onClose,user}){
  const toast=useToast();
  const[pass,setPass]=useState(null);
  const[progress,setProgress]=useState({level:0,xp:0});
  const[challenges,setChallenges]=useState([]);
  const[loading,setLoading]=useState(true);
  const[adminTab,setAdminTab]=useState("pass");
  const[newChallenge,setNewChallenge]=useState({name:"",desc:"",xp:100,icon:"⭐"});
  const[saving,setSaving]=useState(false);
  const scrollRef=useRef(null);

  useEffect(()=>{
    Promise.all([DB.getSeasonPass(),DB.getSeasonPassChallenges()]).then(([p,c])=>{
      setPass(p);setChallenges(c);setLoading(false);
    });
    if(user&&!user.isAdmin){
      DB.getSeasonPassProgress(user.username).then(setProgress);
    }
  },[user?.username]);

  useEffect(()=>{
    if(progress.level>0&&scrollRef.current){
      const card=scrollRef.current.children[progress.level-1];
      if(card)card.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
    }
  },[progress.level]);

  const completeChallenge=async(c)=>{
    if(!user||user.isAdmin)return;
    const prog=await DB.getSeasonPassProgress(user.username);
    if((prog.completed||[]).includes(c.id)){toast("Already completed!","var(--amber)","⭐");return;}
    const newXp=prog.xp+c.xp;
    const newLevel=Math.floor(newXp/XP_PER_LEVEL);
    const updated={...prog,xp:newXp,level:Math.min(newLevel,100),completed:[...(prog.completed||[]),c.id]};
    setProgress(updated);
    await DB.setSeasonPassProgress(user.username,updated);
    toast(`+${c.xp} XP earned! ${newLevel>prog.level?`Level up! Now level ${updated.level}!`:""}`.trim(),"var(--green)","⭐");
  };

  const addChallenge=async()=>{
    if(!newChallenge.name.trim())return;
    setSaving(true);
    const ch=[...challenges,{...newChallenge,id:Date.now(),xp:Number(newChallenge.xp)||100}];
    setChallenges(ch);await DB.setSeasonPassChallenges(ch);
    setNewChallenge({name:"",desc:"",xp:100,icon:"⭐"});setSaving(false);
    toast("Challenge added!","var(--cyan)","✅");
  };

  const delChallenge=async(id)=>{
    const ch=challenges.filter(c=>c.id!==id);
    setChallenges(ch);await DB.setSeasonPassChallenges(ch);
  };

  const savePass=async()=>{
    setSaving(true);
    await DB.setSeasonPass(pass);setSaving(false);
    toast("Season Pass saved!","var(--green)","✅");
  };

  const REWARD_ICONS=["🎁","👑","💎","⚔️","🔥","🌟","🏆","🎭","🎪","✨"];

  return(
    <Panel title="SEASON PASS" subtitle="PROGRESSION · CHALLENGES · REWARDS" color="var(--purple)" onClose={onClose} wide>
      {loading?<div className="mono" style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}>LOADING...</div>:(
        <div>
          {/* PASS HEADER */}
          {pass&&(
            <div style={{background:"linear-gradient(135deg,rgba(180,77,255,.12),rgba(0,245,255,.06))",border:"1px solid rgba(180,77,255,.3)",borderRadius:12,padding:"16px 20px",marginBottom:18}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div>
                  <div className="orb" style={{fontSize:12,color:"var(--purple)",letterSpacing:3}}>{pass.name||"SEASON PASS"}</div>
                  <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:3}}>{pass.desc||"Complete challenges to earn XP and unlock rewards"}</div>
                </div>
                {!user?.isAdmin&&(
                  <div style={{textAlign:"right"}}>
                    <div className="orb" style={{fontSize:18,color:"var(--cyan)"}}>LVL {progress.level}</div>
                    <div className="mono" style={{fontSize:9,color:"var(--dim)"}}>/ 100</div>
                  </div>
                )}
              </div>
              {!user?.isAdmin&&(
                <div style={{marginTop:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span className="mono" style={{fontSize:9,color:"var(--dim)"}}>XP: {progress.xp} / {(progress.level+1)*XP_PER_LEVEL}</span>
                    <span className="mono" style={{fontSize:9,color:"var(--purple)"}}>{Math.round((progress.xp%XP_PER_LEVEL)/XP_PER_LEVEL*100)}% to next level</span>
                  </div>
                  <div className="xp-bar"><div className="xp-fill" style={{width:`${Math.round((progress.xp%XP_PER_LEVEL)/XP_PER_LEVEL*100)}%`}}/></div>
                </div>
              )}
            </div>
          )}
          {!pass&&!user?.isAdmin&&<div style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>🎫</div><div className="mono" style={{fontSize:10}}>No season pass active. Admin activates one.</div></div>}

          {/* LEVEL SCROLL */}
          {pass&&(
            <div style={{marginBottom:18}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2}}>LEVELS 1–100</div>
                <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>⭐ = Premium (lv.{PREMIUM_START}+)</div>
              </div>
              <div className="sp-scroll" ref={scrollRef}>
                {Array.from({length:100},(_,i)=>{
                  const lv=i+1;
                  const unlocked=progress.level>=lv;
                  const isPremium=lv>=PREMIUM_START;
                  const isCurrent=progress.level===lv-1;
                  const reward=pass.rewards?.[lv];
                  return(
                    <div key={lv} className={`sp-level-card ${unlocked?"unlocked":""} ${isPremium&&!unlocked?"premium":""} ${isCurrent?"current":""}`} style={{borderColor:isPremium?unlocked?"rgba(251,191,36,.7)":"rgba(251,191,36,.25)":undefined}}>
                      <div className="mono" style={{fontSize:7,color:"var(--dim)",letterSpacing:1}}>{lv}</div>
                      {reward?<div style={{fontSize:18}}>{reward.icon||"🎁"}</div>:<div style={{fontSize:18,opacity:.2}}>{isPremium?"⭐":"🔒"}</div>}
                      {reward&&<div className="mono" style={{fontSize:7,color:unlocked?"var(--amber)":"var(--dim)",textAlign:"center",maxWidth:72,lineHeight:1.3}}>{reward.name||"Reward"}</div>}
                      {unlocked&&<div style={{position:"absolute",top:4,right:4,fontSize:8}}>✅</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* CHALLENGES */}
          {pass&&challenges.length>0&&(
            <div style={{marginBottom:16}}>
              <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:10}}>CHALLENGES</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:8}}>
                {challenges.map(c=>{
                  const done=user&&!user.isAdmin&&(progress.completed||[]).includes(c.id);
                  return(
                    <div key={c.id} style={{border:`1px solid ${done?"rgba(57,255,20,.35)":"rgba(0,245,255,.15)"}`,borderRadius:8,padding:"10px 12px",background:done?"rgba(57,255,20,.04)":"rgba(0,5,15,.6)",display:"flex",alignItems:"center",gap:10}}>
                      <div style={{fontSize:22,flexShrink:0}}>{c.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="orb" style={{fontSize:9,color:done?"var(--green)":"var(--text)",letterSpacing:1}}>{c.name}</div>
                        {c.desc&&<div className="mono" style={{fontSize:8,color:"var(--dim)",lineHeight:1.5}}>{c.desc}</div>}
                        <div className="mono" style={{fontSize:8,color:"var(--amber)",marginTop:2}}>+{c.xp} XP</div>
                      </div>
                      {user&&!user.isAdmin&&!done&&<button className="neon-btn" onClick={()=>completeChallenge(c)} style={{fontSize:7,padding:"5px 10px",borderColor:"var(--green)",color:"var(--green)"}}>DONE</button>}
                      {done&&<span style={{fontSize:18}}>✅</span>}
                      {user?.isAdmin&&<button onClick={()=>delChallenge(c.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:14}}>×</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ADMIN CONTROLS */}
          {user?.isAdmin&&(
            <div style={{background:"rgba(251,191,36,.04)",border:"1px solid rgba(251,191,36,.2)",borderRadius:10,padding:16,marginTop:16}}>
              <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:12}}>ADMIN: SEASON PASS CONTROLS</div>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                {["pass","challenges","rewards"].map(t=><button key={t} onClick={()=>setAdminTab(t)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 12px",borderRadius:4,cursor:"pointer",background:adminTab===t?"rgba(251,191,36,.2)":"transparent",border:`1px solid ${adminTab===t?"var(--amber)":"rgba(251,191,36,.2)"}`,color:adminTab===t?"var(--amber)":"var(--dim)"}}>{t.toUpperCase()}</button>)}
              </div>
              {adminTab==="pass"&&(
                <div style={{display:"grid",gap:9}}>
                  <div><label className="si-label">PASS NAME</label><input className="si" value={pass?.name||""} onChange={e=>setPass(p=>({...p,name:e.target.value}))}/></div>
                  <div><label className="si-label">DESCRIPTION</label><input className="si" value={pass?.desc||""} onChange={e=>setPass(p=>({...p,desc:e.target.value}))}/></div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="neon-btn" onClick={()=>setPass(p=>({...(p||{}),name:"Season Pass 1",desc:"Earn XP and unlock rewards!",rewards:{}}))} style={{fontSize:8,borderColor:"var(--cyan)",color:"var(--cyan)"}}>ACTIVATE NEW PASS</button>
                    <button className="neon-btn" onClick={savePass} disabled={saving} style={{fontSize:8,borderColor:"var(--amber)",color:"var(--amber)"}}>{saving?"...":"SAVE PASS"}</button>
                  </div>
                </div>
              )}
              {adminTab==="challenges"&&(
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
                    <div><label className="si-label">NAME</label><input className="si" value={newChallenge.name} onChange={e=>setNewChallenge(c=>({...c,name:e.target.value}))} placeholder="e.g. Mine 64 diamonds"/></div>
                    <div><label className="si-label">XP REWARD</label><input className="si" type="number" value={newChallenge.xp} onChange={e=>setNewChallenge(c=>({...c,xp:e.target.value}))}/></div>
                    <div><label className="si-label">DESCRIPTION</label><input className="si" value={newChallenge.desc} onChange={e=>setNewChallenge(c=>({...c,desc:e.target.value}))}/></div>
                    <div><label className="si-label">ICON</label><input className="si" value={newChallenge.icon} onChange={e=>setNewChallenge(c=>({...c,icon:e.target.value}))}/></div>
                  </div>
                  <button className="neon-btn" onClick={addChallenge} disabled={saving} style={{fontSize:8,borderColor:"var(--green)",color:"var(--green)",marginBottom:14}}>+ ADD CHALLENGE</button>
                  {challenges.map(c=>(
                    <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",border:"1px solid rgba(0,245,255,.1)",borderRadius:6,marginBottom:5}}>
                      <span className="mono" style={{fontSize:10}}>{c.icon} {c.name} — <span style={{color:"var(--amber)"}}>{c.xp} XP</span></span>
                      <button onClick={()=>delChallenge(c.id)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:9}}>DEL</button>
                    </div>
                  ))}
                </div>
              )}
              {adminTab==="rewards"&&(
                <div>
                  <div className="mono" style={{fontSize:9,color:"var(--dim)",marginBottom:10,lineHeight:1.6}}>Set rewards for specific levels. Premium rewards = levels {PREMIUM_START}–100.</div>
                  <div style={{display:"grid",gap:8}}>
                    {[1,10,20,30,40,50,60,70,80,81,90,100].map(lv=>{
                      const r=pass?.rewards?.[lv]||{};
                      return(
                        <div key={lv} style={{display:"flex",gap:8,alignItems:"center"}}>
                          <div className="orb" style={{fontSize:9,color:lv>=PREMIUM_START?"var(--amber)":"var(--cyan)",width:30,flexShrink:0}}>L{lv}{lv>=PREMIUM_START&&"⭐"}</div>
                          <input className="si" placeholder="Reward name" value={r.name||""} onChange={e=>setPass(p=>({...p,rewards:{...(p?.rewards||{}),[lv]:{...r,name:e.target.value}}}))} style={{flex:1}}/>
                          <select className="si" value={r.icon||"🎁"} onChange={e=>setPass(p=>({...p,rewards:{...(p?.rewards||{}),[lv]:{...r,icon:e.target.value}}}))} style={{width:60,padding:"8px 4px"}}>
                            {REWARD_ICONS.map(ic=><option key={ic}>{ic}</option>)}
                          </select>
                        </div>
                      );
                    })}
                    <button className="neon-btn" onClick={savePass} disabled={saving} style={{fontSize:8,borderColor:"var(--amber)",color:"var(--amber)"}}>{saving?"SAVING...":"SAVE REWARDS"}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v6.0 FEATURE 3: COSMETICS SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
function CosmeticsPanel({onClose,user}){
  const toast=useToast();
  const[cosmDB,setCosmDB]=useState(COSMETICS_DEFAULT);
  const[userCosmetics,setUserCosmetics]=useState({unlocked:[],equipped:{}});
  const[tab,setTab]=useState("borders");
  const[adminTab,setAdminTab]=useState("grant");
  const[loading,setLoading]=useState(true);
  const[previewEquipped,setPreviewEquipped]=useState({});
  // Admin: per-player data
  const[allUsers,setAllUsers]=useState([]);
  const[selectedPlayer,setSelectedPlayer]=useState("");
  const[playerCosmetics,setPlayerCosmetics]=useState({unlocked:[],equipped:{}});
  const[playerProgress,setPlayerProgress]=useState({level:0,xp:0});
  const[allProgress,setAllProgress]=useState({});
  const[grantLoading,setGrantLoading]=useState(false);

  useEffect(()=>{
    DB.getAllCosmetics().then(c=>{if(c)setCosmDB(c);});
    if(user?.isAdmin){
      DB.getUsers().then(async(us)=>{
        const nonAdmin=us.filter(u=>!u.isAdmin);
        setAllUsers(nonAdmin);
        // Load all progress in parallel
        const progMap={};
        await Promise.all(nonAdmin.map(async u=>{
          const p=await DB.getSeasonPassProgress(u.username);
          progMap[u.username]=p||{level:0,xp:0};
        }));
        setAllProgress(progMap);
      });
    }else if(user){
      DB.getCosmetics(user.username).then(c=>{setUserCosmetics(c||{unlocked:[],equipped:{}});setPreviewEquipped((c||{}).equipped||{});});
    }
    setLoading(false);
  },[user?.username]);

  useEffect(()=>{
    if(selectedPlayer){
      setGrantLoading(true);
      Promise.all([DB.getCosmetics(selectedPlayer),DB.getSeasonPassProgress(selectedPlayer)]).then(([c,p])=>{
        setPlayerCosmetics(c||{unlocked:[],equipped:{}});
        setPlayerProgress(p||{level:0,xp:0});
        setGrantLoading(false);
      });
    }
  },[selectedPlayer]);

  const equip=async(category,id)=>{
    if(!user||user.isAdmin)return;
    const owned=userCosmetics.unlocked||[];
    if(!owned.includes(id)){toast("You don't own this cosmetic!","var(--red)","🔒");return;}
    const newEquipped={...userCosmetics.equipped,[category]:id};
    const updated={...userCosmetics,equipped:newEquipped};
    setUserCosmetics(updated);setPreviewEquipped(newEquipped);
    await DB.setCosmetics(user.username,updated);
    await DB.pushAdminLog&&undefined;// players don't log
    toast("Cosmetic equipped!","var(--green)","✅");
  };

  const grantItem=async(id)=>{
    if(!user?.isAdmin||!selectedPlayer)return;
    const cur=playerCosmetics.unlocked||[];
    if(cur.includes(id)){
      // Revoke
      const updated={...playerCosmetics,unlocked:cur.filter(x=>x!==id)};
      setPlayerCosmetics(updated);await DB.setCosmetics(selectedPlayer,updated);
      await DB.pushAdminLog({action:`REVOKED COSMETIC ${id} FROM ${selectedPlayer}`,by:user.username});
      toast(`Revoked from ${selectedPlayer}!`,"var(--amber)","🔒");
    }else{
      // Grant
      const updated={...playerCosmetics,unlocked:[...cur,id]};
      setPlayerCosmetics(updated);await DB.setCosmetics(selectedPlayer,updated);
      await DB.pushAdminLog({action:`GRANTED COSMETIC ${id} TO ${selectedPlayer}`,by:user.username});
      toast(`Granted to ${selectedPlayer}!`,"var(--green)","✅");
    }
  };

  const grantAllForLevel=async(level)=>{
    if(!user?.isAdmin||!selectedPlayer)return;
    // Grant all common+uncommon at low levels, rarer at high levels
    const getRarityByLevel=(lv)=>{
      if(lv>=80)return["common","uncommon","rare","epic","legendary"];
      if(lv>=50)return["common","uncommon","rare","epic"];
      if(lv>=25)return["common","uncommon","rare"];
      if(lv>=10)return["common","uncommon"];
      return["common"];
    };
    const rarities=getRarityByLevel(level);
    const allItems=[...COSMETICS_DEFAULT.borders,...COSMETICS_DEFAULT.nameEffects,...COSMETICS_DEFAULT.titles,...COSMETICS_DEFAULT.killStyles];
    const toGrant=allItems.filter(it=>rarities.includes(it.rarity)).map(it=>it.id);
    const cur=playerCosmetics.unlocked||[];
    const newUnlocked=[...new Set([...cur,...toGrant])];
    const updated={...playerCosmetics,unlocked:newUnlocked};
    setPlayerCosmetics(updated);await DB.setCosmetics(selectedPlayer,updated);
    await DB.pushAdminLog({action:`BULK GRANTED ${toGrant.length} COSMETICS TO ${selectedPlayer} (LV${level})`,by:user.username});
    toast(`Granted ${toGrant.length - cur.filter(id=>toGrant.includes(id)).length} new items!`,"var(--green)","✅");
  };

  const CATS={borders:{icon:"🔷",label:"BORDERS"},nameEffects:{icon:"✨",label:"NAME EFFECTS"},titles:{icon:"📛",label:"TITLES"},killStyles:{icon:"💀",label:"KILL STYLES"}};
  const items=cosmDB[tab]||[];
  const equippedId=previewEquipped[tab];

  // All items flat for admin grant view
  const tabItems=COSMETICS_DEFAULT[tab]||[];

  return(
    <Panel title="COSMETICS" subtitle="WARDROBE · CUSTOMIZE YOUR IDENTITY" color="var(--purple)" onClose={onClose} wide>
      {user?.isAdmin?(
        // ── ADMIN VIEW ──────────────────────────────────────────────────────────
        <div>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            {[{id:"grant",l:"🎁 GRANT COSMETICS"},{id:"players",l:"👥 PLAYER OVERVIEW"}].map(t=>(
              <button key={t.id} onClick={()=>setAdminTab(t.id)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"6px 12px",borderRadius:5,cursor:"pointer",background:adminTab===t.id?"rgba(180,77,255,.2)":"transparent",border:`1px solid ${adminTab===t.id?"var(--purple)":"rgba(180,77,255,.18)"}`,color:adminTab===t.id?"var(--purple)":"var(--dim)"}}>{t.l}</button>
            ))}
          </div>

          {adminTab==="grant"&&(
            <div>
              {/* Player selector */}
              <div style={{marginBottom:14}}>
                <label className="si-label">SELECT PLAYER</label>
                <select className="si" value={selectedPlayer} onChange={e=>setSelectedPlayer(e.target.value)}>
                  <option value="">— Select a player —</option>
                  {allUsers.map(u=><option key={u.username} value={u.username}>{u.username} · LV{(allProgress[u.username]||{}).level||0}</option>)}
                </select>
              </div>

              {selectedPlayer&&!grantLoading&&(
                <>
                  {/* Player snapshot */}
                  <div style={{display:"flex",gap:12,alignItems:"center",padding:"10px 14px",background:"rgba(180,77,255,.06)",border:"1px solid rgba(180,77,255,.2)",borderRadius:8,marginBottom:14,flexWrap:"wrap"}}>
                    <MCAvatar username={selectedPlayer} size={40}/>
                    <div style={{flex:1}}>
                      <div className="orb" style={{fontSize:11,color:"var(--text)"}}>{selectedPlayer}</div>
                      <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:2}}>Season Pass: <span style={{color:"var(--purple)"}}>Level {playerProgress.level}</span> · {playerProgress.xp||0} XP · {playerCosmetics.unlocked?.length||0} cosmetics unlocked</div>
                    </div>
                    {/* Quick grant by pass level */}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <span className="mono" style={{fontSize:8,color:"var(--dim)",alignSelf:"center"}}>GRANT BY LEVEL:</span>
                      {[10,25,50,80,100].map(lv=>(
                        <button key={lv} onClick={()=>grantAllForLevel(lv)} style={{fontFamily:"Orbitron",fontSize:7,padding:"4px 9px",borderRadius:4,cursor:"pointer",background:"rgba(180,77,255,.1)",border:"1px solid rgba(180,77,255,.3)",color:"var(--purple)",transition:"all .2s"}}>LV{lv}+</button>
                      ))}
                    </div>
                  </div>

                  {/* Category tabs */}
                  <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap"}}>
                    {Object.entries(CATS).map(([k,v])=>(
                      <button key={k} onClick={()=>setTab(k)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 10px",borderRadius:4,cursor:"pointer",background:tab===k?"rgba(180,77,255,.2)":"transparent",border:`1px solid ${tab===k?"var(--purple)":"rgba(180,77,255,.15)"}`,color:tab===k?"var(--purple)":"var(--dim)"}}>{v.icon} {v.label}</button>
                    ))}
                  </div>

                  {/* Items grid */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:4}}>
                    {tabItems.map(item=>{
                      const owned=(playerCosmetics.unlocked||[]).includes(item.id);
                      return(
                        <div key={item.id} className={`cosm-card${owned?" equipped":""}`} onClick={()=>grantItem(item.id)} title={owned?"Click to revoke":"Click to grant"} style={{cursor:"pointer"}}>
                          <div style={{fontSize:22,marginBottom:5}}>{item.icon}</div>
                          <div className="orb" style={{fontSize:7,color:owned?"var(--green)":"var(--text)",letterSpacing:1,marginBottom:2}}>{item.name}</div>
                          <div className="mono" style={{fontSize:6,color:RARITY_COLORS[item.rarity]||"var(--dim)"}}>{(item.rarity||"common").toUpperCase()}</div>
                          <div style={{position:"absolute",top:5,right:5,fontSize:9}}>{owned?"✅":"➕"}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:8}}>Click ✅ item to revoke · Click ➕ item to grant</div>
                </>
              )}
              {selectedPlayer&&grantLoading&&<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"20px"}}>LOADING PLAYER DATA...</div>}
              {!selectedPlayer&&<div style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>🎭</div><div className="mono" style={{fontSize:10}}>Select a player to manage their cosmetics</div></div>}
            </div>
          )}

          {adminTab==="players"&&(
            <div>
              <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:12}}>ALL PLAYERS · SEASON PASS & COSMETICS OVERVIEW</div>
              <div style={{border:"1px solid rgba(0,245,255,.12)",borderRadius:8,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 80px",padding:"7px 12px",background:"rgba(0,245,255,.05)"}}>
                  {["PLAYER","PASS LV","XP","COSMETICS"].map(h=><span key={h} className="orb" style={{fontSize:7,color:"var(--cyan)",letterSpacing:1}}>{h}</span>)}
                </div>
                {allUsers.map(u=>{
                  const prog=allProgress[u.username]||{level:0,xp:0};
                  return(
                    <div key={u.username} style={{display:"grid",gridTemplateColumns:"1fr 80px 80px 80px",padding:"9px 12px",borderTop:"1px solid rgba(0,245,255,.06)",alignItems:"center",transition:"background .2s",cursor:"pointer"}}
                      onClick={()=>{setSelectedPlayer(u.username);setAdminTab("grant");}}
                      onMouseOver={e=>e.currentTarget.style.background="rgba(0,245,255,.04)"}
                      onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <MCAvatar username={u.username} size={26}/>
                        <span className="mono" style={{fontSize:10,color:"var(--text)"}}>{u.username}</span>
                      </div>
                      <span className="orb" style={{fontSize:10,color:"var(--purple)"}}>{prog.level}</span>
                      <span className="mono" style={{fontSize:9,color:"var(--dim)"}}>{prog.xp||0}</span>
                      <span className="mono" style={{fontSize:9,color:"var(--cyan)"}}>—</span>
                    </div>
                  );
                })}
                {allUsers.length===0&&<div className="mono" style={{padding:"20px",color:"var(--dim)",textAlign:"center"}}>No registered players.</div>}
              </div>
            </div>
          )}
        </div>
      ):(
        // ── PLAYER VIEW ─────────────────────────────────────────────────────────
        <div>
          {/* Live Preview */}
          <div style={{background:"rgba(180,77,255,.06)",border:"1px solid rgba(180,77,255,.2)",borderRadius:10,padding:"14px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div style={{position:"relative",display:"inline-block"}}>
              <div style={{width:56,height:56,borderRadius:8,overflow:"hidden",border:previewEquipped.borders?(tabItems.find(i=>i.id===previewEquipped.borders)?.css||"2px solid rgba(0,245,255,.5)"):"2px solid rgba(0,245,255,.3)"}}>
                <MCAvatar username={user?.username||"?"} size={56}/>
              </div>
            </div>
            <div>
              <div className="orb" style={{fontSize:13,letterSpacing:2,color:"#fff"}}>{user?.username||"Guest"}</div>
              {previewEquipped.titles&&<div className="mono" style={{fontSize:9,color:"var(--purple)",marginTop:2}}>
                {(COSMETICS_DEFAULT.titles.find(i=>i.id===previewEquipped.titles)||{}).icon} {(COSMETICS_DEFAULT.titles.find(i=>i.id===previewEquipped.titles)||{}).name}
              </div>}
              <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:3}}>LIVE PREVIEW · {userCosmetics.unlocked?.length||0} cosmetics owned</div>
            </div>
          </div>

          {/* Category tabs */}
          <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
            {Object.entries(CATS).map(([k,v])=>(
              <button key={k} onClick={()=>setTab(k)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"6px 12px",borderRadius:5,cursor:"pointer",background:tab===k?"rgba(180,77,255,.2)":"transparent",border:`1px solid ${tab===k?"var(--purple)":"rgba(180,77,255,.18)"}`,color:tab===k?"var(--purple)":"var(--dim)",transition:"all .2s"}}>
                {v.icon} {v.label}
              </button>
            ))}
          </div>

          {/* Items grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:10,marginBottom:10}}>
            {tabItems.map(item=>{
              const owned=user&&(userCosmetics.unlocked||[]).includes(item.id);
              const equipped=equippedId===item.id;
              const locked=user&&!owned;
              return(
                <div key={item.id} className={`cosm-card${equipped?" equipped":""} ${locked?" locked":""}`} onClick={()=>owned&&equip(tab,item.id)} title={locked?"Not unlocked — ask Admin":equipped?"Equipped":"Click to equip"}>
                  <div style={{fontSize:24,marginBottom:5}}>{item.icon}</div>
                  <div className="orb" style={{fontSize:7,color:equipped?"var(--green)":"var(--text)",letterSpacing:1,marginBottom:2}}>{item.name}</div>
                  <div className="mono" style={{fontSize:6,color:RARITY_COLORS[item.rarity]||"var(--dim)",letterSpacing:1}}>{(item.rarity||"common").toUpperCase()}</div>
                  {equipped&&<div style={{position:"absolute",top:5,right:5,fontSize:9}}>✅</div>}
                  {locked&&!equipped&&<div style={{position:"absolute",top:5,right:5,fontSize:9}}>🔒</div>}
                </div>
              );
            })}
          </div>
          {!user&&<div className="mono" style={{textAlign:"center",padding:"20px 0",color:"var(--dim)"}}>🔐 Log in to equip cosmetics</div>}
          <div className="mono" style={{fontSize:8,color:"var(--dim)",textAlign:"center"}}>🔓 Cosmetics are granted by Admin based on your Season Pass level and achievements</div>
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v6.0 FEATURE 4: GALLERY (10 SLOTS + STORAGE REQUEST)
// ═══════════════════════════════════════════════════════════════════════════════
function GalleryPanel({onClose,user}){
  const toast=useToast();
  const[gallery,setGallery]=useState({slots:[],maxSlots:10});
  const[loading,setLoading]=useState(true);
  const[uploading,setUploading]=useState(false);
  const[lightbox,setLightbox]=useState(null);
  const[reqMsg,setReqMsg]=useState("");
  const[reqSent,setReqSent]=useState(false);
  const[allUsers,setAllUsers]=useState([]);
  const[viewUser,setViewUser]=useState(user?.username||"");
  const fileRef=useRef();

  const load=async(uname)=>{
    if(!uname)return;
    const g=await DB.getGallery(uname);
    setGallery(g);setLoading(false);
  };

  useEffect(()=>{
    DB.getUsers().then(u=>setAllUsers(u));
    if(user?.username)load(user.username);
    else setLoading(false);
  },[user?.username]);

  useEffect(()=>{if(viewUser)load(viewUser);},[viewUser]);

  const upload=async(e)=>{
    const file=e.target.files?.[0];
    if(!file||!user)return;
    if(gallery.slots.length>=gallery.maxSlots){toast("Gallery full! Request more storage.","var(--amber)","📁");return;}
    setUploading(true);
    try{
      const url=await CLOUDINARY.upload(file,"nexsci/gallery");
      const updated={...gallery,slots:[...gallery.slots,{url,uploadedAt:new Date().toISOString(),caption:""}]};
      setGallery(updated);await DB.setGallery(user.username,updated);
      toast("Image uploaded!","var(--green)","🖼️");
    }catch{toast("Upload failed.","var(--red)","❌");}
    setUploading(false);
  };

  const deleteSlot=async(idx)=>{
    if(!user||user.username!==viewUser)return;
    const slots=gallery.slots.filter((_,i)=>i!==idx);
    const updated={...gallery,slots};
    setGallery(updated);await DB.setGallery(user.username,updated);
    toast("Image removed.","var(--dim)","🗑");setLightbox(null);
  };

  const updateCaption=async(idx,caption)=>{
    if(!user||user.username!==viewUser)return;
    const slots=gallery.slots.map((s,i)=>i===idx?{...s,caption}:s);
    const updated={...gallery,slots};
    setGallery(updated);await DB.setGallery(user.username,updated);
  };

  const requestStorage=async()=>{
    if(!user||reqSent)return;
    const reqs=await DB.getStorageRequests();
    await DB.setStorageRequests([...reqs,{id:Date.now(),username:user.username,message:reqMsg.trim()||"No message.",currentMax:gallery.maxSlots,status:"pending",ts:new Date().toISOString()}]);
    await DB.pushNotif({type:"access",title:"STORAGE REQUEST",body:`${user.username} wants more gallery storage. Current: ${gallery.maxSlots} slots.`});
    setReqSent(true);toast("Request sent to Admin!","var(--purple)","📨");
  };

  const isOwn=user?.username===viewUser;

  return(
    <Panel title="PLAYER GALLERY" subtitle="SCREENSHOTS · BUILDS · MEMORIES" color="var(--blue)" onClose={onClose} wide>
      {/* User selector */}
      <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          <label className="si-label">VIEW PLAYER GALLERY</label>
          <select className="si" value={viewUser} onChange={e=>setViewUser(e.target.value)}>
            {user&&<option value={user.username}>{user.username} (me)</option>}
            {allUsers.filter(u=>u.username!==user?.username).map(u=><option key={u.username} value={u.username}>{u.username}</option>)}
          </select>
        </div>
        {isOwn&&<div style={{paddingTop:18}}>
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={upload}/>
          <button className="neon-btn" onClick={()=>fileRef.current?.click()} disabled={uploading||gallery.slots.length>=gallery.maxSlots} style={{fontSize:8,borderColor:"var(--blue)",color:"var(--blue)"}}>
            {uploading?"UPLOADING...":"📷 UPLOAD"}
          </button>
        </div>}
      </div>

      {/* Stats bar */}
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <span className="mono" style={{fontSize:9,color:"var(--dim)"}}>Slots: <span style={{color:"var(--cyan)"}}>{gallery.slots.length}/{gallery.maxSlots}</span></span>
        <div style={{flex:1,height:5,background:"rgba(0,245,255,.1)",borderRadius:3,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${(gallery.slots.length/gallery.maxSlots)*100}%`,background:"var(--cyan)",borderRadius:3,transition:"width .4s"}}/>
        </div>
        {isOwn&&gallery.slots.length>=gallery.maxSlots&&!reqSent&&(
          <button className="neon-btn" onClick={()=>document.getElementById("storagereq")?.scrollIntoView({behavior:"smooth"})} style={{fontSize:8,padding:"5px 10px",borderColor:"var(--amber)",color:"var(--amber)"}}>REQUEST MORE</button>
        )}
      </div>

      {loading?<div className="mono" style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}>LOADING...</div>:(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10,marginBottom:16}}>
            {gallery.slots.map((slot,i)=>(
              <div key={i} className="gallery-slot filled" onClick={()=>setLightbox({...slot,idx:i})}>
                <img src={slot.url} alt={slot.caption||`Photo ${i+1}`}/>
                {slot.caption&&<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,.7)",padding:"4px 6px"}}><div className="mono" style={{fontSize:8,color:"#fff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{slot.caption}</div></div>}
              </div>
            ))}
            {isOwn&&gallery.slots.length<gallery.maxSlots&&Array.from({length:gallery.maxSlots-gallery.slots.length},(_,i)=>(
              <div key={`empty-${i}`} className="gallery-slot" onClick={()=>fileRef.current?.click()}>
                <div style={{textAlign:"center",pointerEvents:"none"}}>
                  <div style={{fontSize:22,marginBottom:4,opacity:.3}}>📷</div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>EMPTY SLOT</div>
                </div>
              </div>
            ))}
          </div>

          {/* Request more storage */}
          {isOwn&&(
            <div id="storagereq" style={{background:"rgba(180,77,255,.05)",border:"1px solid rgba(180,77,255,.2)",borderRadius:8,padding:"12px 14px"}}>
              <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:8}}>REQUEST MORE STORAGE</div>
              {reqSent
                ?<div className="mono" style={{fontSize:10,color:"var(--green)"}}>✅ Request submitted! AdminOP will review.</div>
                :<div style={{display:"flex",gap:8}}>
                  <input className="si" placeholder="Why do you need more slots?" value={reqMsg} onChange={e=>setReqMsg(e.target.value)} style={{flex:1}}/>
                  <button className="neon-btn" onClick={requestStorage} style={{fontSize:8,padding:"8px 12px",borderColor:"var(--purple)",color:"var(--purple)",flexShrink:0}}>REQUEST</button>
                </div>
              }
            </div>
          )}
        </>
      )}

      {/* Lightbox */}
      {lightbox&&createPortal(
        <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.92)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setLightbox(null)}>
          <div style={{maxWidth:"90vw",maxHeight:"90vh",position:"relative"}} onClick={e=>e.stopPropagation()}>
            <img src={lightbox.url} alt="" style={{maxWidth:"100%",maxHeight:"80vh",objectFit:"contain",borderRadius:8}}/>
            <button onClick={()=>setLightbox(null)} style={{position:"absolute",top:-10,right:-10,background:"rgba(255,68,68,.8)",border:"none",borderRadius:"50%",width:28,height:28,color:"#fff",cursor:"pointer",fontSize:13}}>×</button>
            {isOwn&&(
              <div style={{marginTop:10,display:"flex",gap:8}}>
                <input className="si" value={lightbox.caption||""} onChange={e=>setLightbox(l=>({...l,caption:e.target.value}))} onBlur={()=>updateCaption(lightbox.idx,lightbox.caption||"")} placeholder="Add caption..." style={{flex:1}}/>
                <button className="neon-btn" onClick={()=>deleteSlot(lightbox.idx)} style={{fontSize:8,padding:"8px 12px",borderColor:"var(--red)",color:"var(--red)"}}>DELETE</button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v6.0 FEATURE 5: SUGGESTION BOX
// ═══════════════════════════════════════════════════════════════════════════════
function SuggestionBoxPanel({onClose,user}){
  const toast=useToast();
  const[suggestions,setSuggestions]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({title:"",body:"",anonymous:false});
  const[filter,setFilter]=useState("all");
  const[submitting,setSubmitting]=useState(false);

  useEffect(()=>{DB.getSuggestions().then(s=>{setSuggestions(s);setLoading(false);});},[]);

  const poll=()=>DB.getSuggestions().then(setSuggestions);
  useEffect(()=>{const t=setInterval(poll,6000);return()=>clearInterval(t);},[]);

  const submit=async()=>{
    if(!form.title.trim()||!user){return;}
    setSubmitting(true);
    await DB.pushSuggestion({title:form.title.trim(),body:form.body.trim(),author:form.anonymous?"Anonymous":user.username,upvotes:[],status:"open"});
    setForm({title:"",body:"",anonymous:false});
    await poll();setSubmitting(false);
    toast("Suggestion submitted!","var(--green)","💡");
  };

  const upvote=async(id)=>{
    if(!user)return;
    const updated=suggestions.map(s=>{
      if(s.id!==id)return s;
      const ups=s.upvotes||[];
      return{...s,upvotes:ups.includes(user.username)?ups.filter(u=>u!==user.username):[...ups,user.username]};
    });
    setSuggestions(updated);await DB.setSuggestions(updated);
  };

  const setStatus=async(id,status)=>{
    if(!user?.isAdmin)return;
    let updated=suggestions.map(s=>s.id===id?{...s,status}:s);
    if(status==="completed")updated=updated.filter(s=>s.id!==id).concat({...updated.find(s=>s.id===id),archived:true}).filter(s=>!s.archived||filter==="all");
    setSuggestions(updated);await DB.setSuggestions(updated);
  };

  const STATUS_COLORS={open:"var(--cyan)",reviewing:"var(--amber)",planned:"var(--purple)",completed:"var(--green)",rejected:"var(--red)"};
  const filtered=filter==="all"?suggestions.filter(s=>!s.archived):suggestions.filter(s=>s.status===filter);
  const sorted=[...filtered].sort((a,b)=>(b.upvotes?.length||0)-(a.upvotes?.length||0));

  return(
    <Panel title="SUGGESTION BOX" subtitle="COMMUNITY FEEDBACK · VOTE ON IDEAS" color="var(--green)" onClose={onClose} wide>
      {/* Submit */}
      {user&&(
        <div style={{background:"rgba(57,255,20,.04)",border:"1px solid rgba(57,255,20,.2)",borderRadius:10,padding:14,marginBottom:16}}>
          <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:2,marginBottom:10}}>💡 SUBMIT A SUGGESTION</div>
          <div style={{display:"grid",gap:8}}>
            <div><label className="si-label">TITLE</label><input className="si" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Add a trading market at spawn" maxLength={100}/></div>
            <div><label className="si-label">DETAILS (OPTIONAL)</label><textarea className="si" rows={2} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} placeholder="Describe your suggestion..." style={{resize:"vertical"}}/></div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                <input type="checkbox" checked={form.anonymous} onChange={e=>setForm(f=>({...f,anonymous:e.target.checked}))}/>
                <span className="mono" style={{fontSize:9,color:"var(--dim)"}}>Submit anonymously</span>
              </label>
              <button className="neon-btn" onClick={submit} disabled={submitting||!form.title.trim()} style={{fontSize:8,borderColor:"var(--green)",color:"var(--green)"}}>{submitting?"...":"SUBMIT →"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>FILTER:</span>
        {["all","open","reviewing","planned","completed","rejected"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"4px 10px",borderRadius:4,cursor:"pointer",background:filter===f?`${STATUS_COLORS[f]||"rgba(0,245,255,.15)"}20`:"transparent",border:`1px solid ${filter===f?STATUS_COLORS[f]||"var(--cyan)":"rgba(0,245,255,.1)"}`,color:filter===f?STATUS_COLORS[f]||"var(--cyan)":"var(--dim)"}}>{f.toUpperCase()}</button>
        ))}
        <span className="mono" style={{fontSize:9,color:"var(--dim)",marginLeft:"auto"}}>{sorted.length} suggestions</span>
      </div>

      {loading?<div className="mono" style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}>LOADING...</div>:(
        sorted.length===0?<div style={{textAlign:"center",padding:"40px 0"}}><div style={{fontSize:28,marginBottom:8}}>💡</div><div className="mono" style={{color:"var(--dim)"}}>No suggestions yet.</div></div>:
        <div style={{display:"grid",gap:10,maxHeight:"55vh",overflowY:"auto"}}>
          {sorted.map(s=>{
            const voted=user&&(s.upvotes||[]).includes(user.username);
            const col=STATUS_COLORS[s.status]||"var(--cyan)";
            return(
              <div key={s.id} className="sug-card">
                <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                  {/* Upvote */}
                  <button onClick={()=>upvote(s.id)} style={{flexShrink:0,background:voted?"rgba(57,255,20,.15)":"rgba(0,245,255,.04)",border:`1px solid ${voted?"rgba(57,255,20,.5)":"rgba(0,245,255,.15)"}`,borderRadius:6,padding:"6px 10px",cursor:"pointer",textAlign:"center",transition:"all .2s",minWidth:44}}>
                    <div style={{fontSize:14}}>{voted?"💚":"👍"}</div>
                    <div className="mono" style={{fontSize:9,color:voted?"var(--green)":"var(--dim)"}}>{(s.upvotes||[]).length}</div>
                  </button>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                      <div className="orb" style={{fontSize:10,color:"var(--text)",letterSpacing:1}}>{s.title}</div>
                      <span className="sug-status" style={{background:`${col}15`,border:`1px solid ${col}44`,color:col}}>{s.status?.toUpperCase()||"OPEN"}</span>
                    </div>
                    {s.body&&<div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.6,marginBottom:4}}>{s.body}</div>}
                    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                      <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>By {s.author||"Anonymous"} · {new Date(s.ts||Date.now()).toLocaleDateString()}</span>
                      {user?.isAdmin&&(
                        <select className="si" value={s.status||"open"} onChange={e=>setStatus(s.id,e.target.value)} style={{width:"auto",padding:"3px 8px",fontSize:9}}>
                          {Object.keys(STATUS_COLORS).map(st=><option key={st} value={st}>{st}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v6.0 FEATURE 6: PLAYER OF THE WEEK (POTW)
// ═══════════════════════════════════════════════════════════════════════════════
function POTWPanel({onClose,user}){
  const toast=useToast();
  const[potw,setPotw]=useState(null);
  const[hall,setHall]=useState([]);
  const[loading,setLoading]=useState(true);
  const[users,setUsers]=useState([]);
  const[form,setForm]=useState({username:"",reason:"",screenshotUrl:""});
  const[uploading,setUploading]=useState(false);
  const fileRef=useRef();

  useEffect(()=>{
    Promise.all([DB.getPOTW(),DB.getPOTWHall(),DB.getUsers()]).then(([p,h,u])=>{
      setPotw(p);setHall(h);setUsers(u.filter(x=>!x.isAdmin));setLoading(false);
    });
    const t=setInterval(()=>DB.getPOTW().then(p=>{
      if(p&&potw&&p.expiresAt&&new Date(p.expiresAt)<new Date())DB.setPOTW(null);
      setPotw(p);
    }),30000);
    return()=>clearInterval(t);
  },[]);

  const selectPOTW=async()=>{
    if(!user?.isAdmin||!form.username.trim())return;
    const expiresAt=new Date(Date.now()+7*24*60*60*1000).toISOString();
    const entry={username:form.username,reason:form.reason.trim()||"Outstanding player this week!",screenshotUrl:form.screenshotUrl,selectedAt:new Date().toISOString(),selectedBy:user.username,expiresAt};
    // Archive previous POTW to hall
    if(potw?.username){
      const newHall=[{...potw,archivedAt:new Date().toISOString()},...hall].slice(0,20);
      setHall(newHall);await DB.setPOTWHall(newHall);
    }
    await DB.setPOTW(entry);setPotw(entry);
    await DB.pushNotif({type:"event",title:"🏆 PLAYER OF THE WEEK!",body:`${form.username} has been named Player of the Week!`});
    setForm({username:"",reason:"",screenshotUrl:""});
    toast(`${form.username} named Player of the Week!`,"var(--amber)","👑");
  };

  const uploadScreenshot=async(e)=>{
    const file=e.target.files?.[0];if(!file)return;
    setUploading(true);
    try{const url=await CLOUDINARY.upload(file,"nexsci/potw");setForm(f=>({...f,screenshotUrl:url}));toast("Screenshot uploaded!","var(--green)","📸");}
    catch{toast("Upload failed.","var(--red)","❌");}
    setUploading(false);
  };

  const isExpired=potw&&potw.expiresAt&&new Date(potw.expiresAt)<new Date();

  return(
    <Panel title="PLAYER OF THE WEEK" subtitle="👑 WEEKLY HONOUR · HALL OF FAME" color="var(--amber)" onClose={onClose}>
      {loading?<div className="mono" style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}>LOADING...</div>:(
        <div style={{maxHeight:"72vh",overflowY:"auto"}}>
          {/* Current POTW */}
          {potw&&!isExpired?(
            <div className="potw-card" style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
                <div style={{position:"relative"}}>
                  <MCAvatar username={potw.username} size={72}/>
                  <div className="potw-crown" style={{position:"absolute",top:-24,left:"50%",transform:"translateX(-50%)",fontSize:28}}>👑</div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:3,marginBottom:4}}>THIS WEEK'S CHAMPION</div>
                  <div className="orb" style={{fontSize:18,color:"#fff",letterSpacing:2,marginBottom:6}}>{potw.username}</div>
                  <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.7,marginBottom:8,fontStyle:"italic"}}>"{potw.reason}"</div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>Selected by {potw.selectedBy} · Expires {new Date(potw.expiresAt).toLocaleDateString()}</div>
                </div>
              </div>
              {potw.screenshotUrl&&(
                <div style={{marginTop:14,borderRadius:8,overflow:"hidden",border:"1px solid rgba(251,191,36,.2)"}}>
                  <img src={potw.screenshotUrl} alt="screenshot" style={{width:"100%",maxHeight:200,objectFit:"cover",display:"block"}}/>
                </div>
              )}
            </div>
          ):(
            <div style={{textAlign:"center",padding:"30px 0 20px"}}>
              <div style={{fontSize:40,marginBottom:8}}>🏆</div>
              <div className="orb" style={{fontSize:10,color:"var(--amber)",letterSpacing:2}}>NO CURRENT POTW</div>
              <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:4}}>Admin selects Player of the Week</div>
            </div>
          )}

          {/* Admin form */}
          {user?.isAdmin&&(
            <div style={{background:"rgba(251,191,36,.04)",border:"1px solid rgba(251,191,36,.2)",borderRadius:10,padding:14,marginBottom:20}}>
              <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:10}}>SELECT PLAYER OF THE WEEK</div>
              <div style={{display:"grid",gap:9}}>
                <div><label className="si-label">PLAYER</label>
                  <select className="si" value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))}>
                    <option value="">— Select player —</option>
                    {users.map(u=><option key={u.username} value={u.username}>{u.username}</option>)}
                  </select>
                </div>
                <div><label className="si-label">REASON</label><input className="si" value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} placeholder="Why are they the player of the week?"/></div>
                <div>
                  <label className="si-label">SCREENSHOT (OPTIONAL)</label>
                  <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={uploadScreenshot}/>
                  <div style={{display:"flex",gap:8}}>
                    <input className="si" value={form.screenshotUrl} onChange={e=>setForm(f=>({...f,screenshotUrl:e.target.value}))} placeholder="Image URL or upload..." style={{flex:1}}/>
                    <button className="neon-btn" onClick={()=>fileRef.current?.click()} disabled={uploading} style={{fontSize:8,padding:"8px 12px",borderColor:"var(--blue)",color:"var(--blue)",flexShrink:0}}>{uploading?"...":"📷 UPLOAD"}</button>
                  </div>
                </div>
                <button className="neon-btn" onClick={selectPOTW} disabled={!form.username} style={{borderColor:"var(--amber)",color:"var(--amber)",fontSize:9}}>👑 SET PLAYER OF THE WEEK</button>
              </div>
            </div>
          )}

          {/* Hall of Fame */}
          {hall.length>0&&(
            <div>
              <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:12}}>🏛️ HALL OF FAME</div>
              <div style={{display:"grid",gap:8}}>
                {hall.map((h,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",border:"1px solid rgba(251,191,36,.15)",borderRadius:8,background:"rgba(20,15,0,.5)"}}>
                    <span className="orb" style={{fontSize:14,color:"var(--amber)",flexShrink:0}}>{i+1}.</span>
                    <MCAvatar username={h.username} size={34}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div className="orb" style={{fontSize:10,color:"var(--text)",letterSpacing:1}}>{h.username}</div>
                      <div className="mono" style={{fontSize:8,color:"var(--dim)",lineHeight:1.5,marginTop:2}}>{h.reason?.slice(0,60)}{h.reason?.length>60?"...":""}</div>
                    </div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)",flexShrink:0}}>{h.selectedAt?new Date(h.selectedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"2-digit"}):""}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v7.0 FEATURE 8: AUTO-CLEAR SYSTEM (admin tab — injected into admin panel)
// ═══════════════════════════════════════════════════════════════════════════════
function AutoClearTab({user,toast}){
  const[config,setConfig]=useState({chatDays:7,suggDays:30,potwCheck:true,tickerMax:40,banLogDays:180});
  const[running,setRunning]=useState(false);
  const[results,setResults]=useState(null);

  const runCleanup=async()=>{
    setRunning(true);setResults(null);
    const log=[];
    try{
      // 1. Clear old chat messages
      for(const ch of["global","alliance"]){
        const msgs=await DB.getMessages(ch);
        const cutoff=Date.now()-config.chatDays*86400000;
        const fresh=msgs.filter(m=>new Date(m.ts||0).getTime()>cutoff);
        if(fresh.length<msgs.length){await DB.setMessages(ch,fresh);log.push(`🗑 Chat [${ch}]: removed ${msgs.length-fresh.length} old messages`);}
      }
      // 2. Auto-archive completed suggestions
      const sugs=await DB.getSuggestions();
      const sugCutoff=Date.now()-config.suggDays*86400000;
      const activeSugs=sugs.filter(s=>s.status!=="completed"||(new Date(s.ts||0).getTime()>sugCutoff));
      if(activeSugs.length<sugs.length){await DB.setSuggestions(activeSugs);log.push(`✅ Suggestions: archived ${sugs.length-activeSugs.length} completed`);}
      // 3. Expire POTW
      if(config.potwCheck){
        const p=await DB.getPOTW();
        if(p&&p.expiresAt&&new Date(p.expiresAt)<new Date()){
          await DB.setPOTW(null);log.push("👑 POTW: expired entry cleared");
        }else log.push("👑 POTW: no expired entry found");
      }
      // 4. Trim ticker (notifs)
      const notifs=await DB.getNotifs();
      if(notifs.length>config.tickerMax){
        await DB.setNotifs?.(notifs.slice(0,config.tickerMax));
        log.push(`📡 Ticker: trimmed to ${config.tickerMax} items`);
      }
      // 5. Trim ban log
      const bans=await DB.getBanLog();
      const banCutoff=Date.now()-config.banLogDays*86400000;
      const freshBans=bans.filter(b=>b.type==="permban"||(new Date(b.ts||0).getTime()>banCutoff));
      if(freshBans.length<bans.length){await DB.setBanLog(freshBans);log.push(`🔨 Ban Log: removed ${bans.length-freshBans.length} old entries`);}

      await DB.pushAdminLog({action:"AUTO-CLEAR RUN",by:user.username,detail:log.join(" | ").slice(0,120)});
      setResults({success:true,log});toast("Cleanup complete!","var(--green)","✅");
    }catch(e){setResults({success:false,log:[`Error: ${e.message}`]});toast("Cleanup encountered an error.","var(--red)","❌");}
    setRunning(false);
  };

  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--red)",letterSpacing:2,marginBottom:14}}>🧹 AUTO-CLEAR SYSTEM — ADMIN CLEANUP</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        {[["chatDays","Chat Message Age (days)","Keep messages newer than X days"],["suggDays","Suggestion Archive Age (days)","Auto-archive completed suggestions after X days"],["tickerMax","Max Ticker Notifications","Trim ticker to this count"],["banLogDays","Ban Log Retention (days)","Keep ban records for X days (perm bans never deleted)"]].map(([k,label,desc])=>(
          <div key={k}>
            <label className="si-label">{label}</label>
            <input className="si" type="number" min="1" value={config[k]} onChange={e=>setConfig(c=>({...c,[k]:Number(e.target.value)}))}/>
            <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:3}}>{desc}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
          <input type="checkbox" checked={config.potwCheck} onChange={e=>setConfig(c=>({...c,potwCheck:e.target.checked}))}/>
          <span className="mono" style={{fontSize:9,color:"var(--text)"}}>Auto-expire POTW when past expiry date</span>
        </label>
      </div>
      <button className="neon-btn" onClick={runCleanup} disabled={running} style={{borderColor:"var(--red)",color:"var(--red)",marginBottom:14}}>
        {running?"🧹 CLEANING...":"🧹 RUN CLEANUP NOW"}
      </button>
      {results&&(
        <div style={{background:results.success?"rgba(57,255,20,.05)":"rgba(255,68,68,.05)",border:`1px solid ${results.success?"rgba(57,255,20,.2)":"rgba(255,68,68,.2)"}`,borderRadius:8,padding:12}}>
          <div className="orb" style={{fontSize:8,color:results.success?"var(--green)":"var(--red)",letterSpacing:2,marginBottom:8}}>{results.success?"✅ CLEANUP COMPLETE":"❌ CLEANUP ERROR"}</div>
          {results.log.map((l,i)=><div key={i} className="mono" style={{fontSize:9,color:"var(--text)",lineHeight:1.8}}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v7.0 FEATURE 9: ALLIANCE / KINGDOM SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
const ALLIANCE_COLORS=["#00f5ff","#b44dff","#ff4444","#39ff14","#fbbf24","#f97316","#3b82f6","#ff69b4","#00ff7f","#ff1493"];

function AlliancePanel({onClose,user}){
  const toast=useToast();
  const[alliances,setAlliances]=useState([]);
  const[loading,setLoading]=useState(true);
  const[view,setView]=useState("list"); // list | create | detail
  const[selected,setSelected]=useState(null);
  const[form,setForm]=useState({name:"",tag:"",desc:"",color:"#00f5ff"});
  const[creating,setCreating]=useState(false);
  const[users,setUsers]=useState([]);
  const[playerStatuses,setPlayerStatuses]=useState({});

  useEffect(()=>{
    Promise.all([DB.getAlliances(),DB.getUsers(),DB.getPlayerStatus()]).then(([a,u,ps])=>{
      setAlliances(a);setUsers(u.filter(x=>!x.isAdmin));setPlayerStatuses(ps);setLoading(false);
    });
  },[]);

  const myAlliance=user&&alliances.find(a=>(a.members||[]).includes(user.username));
  const createAlliance=async()=>{
    if(!user||!form.name.trim()||!form.tag.trim())return;
    if(myAlliance){toast("Leave your current alliance first.","var(--amber)","⚠️");return;}
    const tag=form.tag.trim().toUpperCase().slice(0,5);
    if(alliances.find(a=>a.tag===tag)){toast("Tag already in use!","var(--red)","❌");return;}
    setCreating(true);
    const newAlliance={id:Date.now(),name:form.name.trim(),tag,desc:form.desc.trim(),color:form.color,leader:user.username,members:[user.username],warRecord:{wins:0,losses:0,draws:0},createdAt:new Date().toISOString(),hof:[]};
    const updated=[...alliances,newAlliance];
    setAlliances(updated);await DB.setAlliances(updated);
    await DB.pushNotif({type:"system",title:`ALLIANCE FORMED: [${tag}]`,body:`${user.username} founded "${form.name}"`});
    setForm({name:"",tag:"",desc:"",color:"#00f5ff"});setCreating(false);setView("list");
    toast(`Alliance [${tag}] created!`,"var(--cyan)","⚔️");
  };

  const joinAlliance=async(id)=>{
    if(!user||myAlliance)return;
    const updated=alliances.map(a=>a.id===id?{...a,members:[...(a.members||[]),user.username]}:a);
    setAlliances(updated);await DB.setAlliances(updated);
    toast("Joined alliance!","var(--green)","✅");
  };

  const leaveAlliance=async()=>{
    if(!user||!myAlliance)return;
    if(myAlliance.leader===user.username&&(myAlliance.members||[]).length>1){toast("Transfer leadership before leaving.","var(--amber)","⚠️");return;}
    const updated=alliances.map(a=>a.id===myAlliance.id
      ?{...a,members:(a.members||[]).filter(m=>m!==user.username)}
      :a).filter(a=>(a.members||[]).length>0);
    setAlliances(updated);await DB.setAlliances(updated);toast("Left alliance.","var(--dim)","👋");
  };

  const disbandAlliance=async(id)=>{
    if(!user?.isAdmin)return;
    const updated=alliances.filter(a=>a.id!==id);
    setAlliances(updated);await DB.setAlliances(updated);
    await DB.pushAdminLog({action:`DISBANDED ALLIANCE ${alliances.find(a=>a.id===id)?.name}`,by:user.username});
    toast("Alliance disbanded.","var(--red)","🗑");setView("list");
  };

  const promoteToLeader=async(allianceId,newLeader)=>{
    if(!user)return;
    const a=alliances.find(x=>x.id===allianceId);
    if(a&&a.leader!==user.username&&!user.isAdmin)return;
    const updated=alliances.map(x=>x.id===allianceId?{...x,leader:newLeader}:x);
    setAlliances(updated);await DB.setAlliances(updated);toast(`${newLeader} is now leader!`,"var(--amber)","👑");
  };

  if(loading)return<Panel title="ALLIANCES" subtitle="KINGDOMS · FACTIONS · CLANS" color="var(--cyan)" onClose={onClose} wide><div className="mono" style={{textAlign:"center",padding:"40px",color:"var(--dim)"}}>LOADING...</div></Panel>;

  const detailAlliance=selected&&alliances.find(a=>a.id===selected);

  return(
    <Panel title="ALLIANCES" subtitle="KINGDOMS · FACTIONS · CLANS" color="var(--cyan)" onClose={onClose} wide>
      {/* Nav */}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        {[{id:"list",l:"⚔️ ALL ALLIANCES"},{id:"create",l:"➕ CREATE"},{id:"hof",l:"🏛️ HALL OF FAME"}].map(t=>(
          <button key={t.id} onClick={()=>{setView(t.id);setSelected(null);}} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 11px",borderRadius:4,cursor:"pointer",background:view===t.id?"rgba(0,245,255,.15)":"transparent",border:`1px solid ${view===t.id?"var(--cyan)":"rgba(0,245,255,.18)"}`,color:view===t.id?"var(--cyan)":"var(--dim)"}}>{t.l}</button>
        ))}
        {myAlliance&&<button onClick={()=>{setSelected(myAlliance.id);setView("detail");}} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 11px",borderRadius:4,cursor:"pointer",background:"rgba(0,245,255,.12)",border:"1px solid var(--cyan)",color:"var(--cyan)"}}>MY ALLIANCE [{myAlliance.tag}]</button>}
      </div>

      <div style={{maxHeight:"64vh",overflowY:"auto"}}>

        {/* LIST */}
        {view==="list"&&(
          <div>
            <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:12}}>⚔️ ALL ALLIANCES · {alliances.length}</div>
            {alliances.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}><div style={{fontSize:32,marginBottom:8}}>⚔️</div><div className="mono" style={{fontSize:10}}>No alliances yet. Create the first one!</div></div>}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
              {alliances.map(a=>{
                const isLeader=user&&a.leader===user.username;
                const isMember=user&&(a.members||[]).includes(user.username);
                return(
                  <div key={a.id} className="alliance-card" style={{borderColor:`${a.color}33`,background:`${a.color}06`}} onClick={()=>{setSelected(a.id);setView("detail");}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                      <div style={{width:44,height:44,borderRadius:8,background:`${a.color}22`,border:`2px solid ${a.color}55`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span className="orb" style={{fontSize:9,color:a.color,letterSpacing:1}}>{a.tag}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div className="orb" style={{fontSize:11,color:"#fff",letterSpacing:1}}>{a.name}</div>
                        <span className="alliance-tag" style={{color:a.color,borderColor:`${a.color}44`,background:`${a.color}12`,marginTop:3}}>[{a.tag}]</span>
                        {isMember&&<span style={{fontFamily:"Orbitron",fontSize:6,letterSpacing:1,padding:"1px 5px",borderRadius:2,background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",marginLeft:5}}>MEMBER</span>}
                      </div>
                    </div>
                    {a.desc&&<div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.6,marginBottom:8}}>{a.desc}</div>}
                    <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                      <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>👥 {(a.members||[]).length} members</span>
                      <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>🏆 {(a.warRecord||{}).wins||0}W {(a.warRecord||{}).losses||0}L</span>
                      <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>👑 {a.leader}</span>
                    </div>
                    {user&&!isMember&&!myAlliance&&(
                      <button className="neon-btn" onClick={e=>{e.stopPropagation();joinAlliance(a.id);}} style={{fontSize:7,padding:"6px 12px",marginTop:10,borderColor:a.color,color:a.color}}>JOIN →</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DETAIL */}
        {view==="detail"&&detailAlliance&&(
          <div>
            <button onClick={()=>setView("list")} style={{background:"none",border:"none",color:"var(--dim)",cursor:"pointer",fontFamily:"Orbitron",fontSize:8,letterSpacing:1,marginBottom:14}}>← BACK</button>
            <div style={{background:`${detailAlliance.color}08`,border:`1px solid ${detailAlliance.color}33`,borderRadius:12,padding:"18px 20px",marginBottom:18}}>
              <div style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
                <div style={{width:72,height:72,borderRadius:12,background:`${detailAlliance.color}20`,border:`2px solid ${detailAlliance.color}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span className="orb" style={{fontSize:14,color:detailAlliance.color}}>{detailAlliance.tag}</span>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="orb" style={{fontSize:18,color:"#fff",letterSpacing:2,marginBottom:4}}>{detailAlliance.name}</div>
                  {detailAlliance.desc&&<div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.6,marginBottom:6}}>{detailAlliance.desc}</div>}
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    {[{l:"MEMBERS",v:(detailAlliance.members?.length||0).toString(),c:"var(--cyan)"},{l:"WINS",v:(detailAlliance.warRecord?.wins||0).toString(),c:"var(--green)"},{l:"LOSSES",v:(detailAlliance.warRecord?.losses||0).toString(),c:"var(--red)"},{l:"DRAWS",v:(detailAlliance.warRecord?.draws||0).toString(),c:"var(--dim)"}].map((s,i)=>s&&(
                      <div key={i} style={{textAlign:"center"}}>
                        <div className="orb" style={{fontSize:14,color:s.c}}>{i===0?(detailAlliance.members?.length||0):i===1?(detailAlliance.warRecord?.wins||0):i===2?(detailAlliance.warRecord?.losses||0):(detailAlliance.warRecord?.draws||0)}</div>
                        <div className="mono" style={{fontSize:7,color:"var(--dim)",letterSpacing:1}}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Members list */}
            <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:10}}>👥 MEMBERS</div>
            <div style={{border:"1px solid rgba(0,245,255,.12)",borderRadius:8,overflow:"hidden",marginBottom:16}}>
              {(detailAlliance.members||[]).map(m=>{
                const ps=playerStatuses[m]||{};
                const isLeader=detailAlliance.leader===m;
                return(
                  <div key={m} className="alliance-member-row" style={{borderBottom:"1px solid rgba(0,245,255,.06)"}}>
                    <MCAvatar username={m} size={30}/>
                    <div style={{flex:1}}>
                      <span className="mono" style={{fontSize:10,color:"var(--text)"}}>{m}</span>
                      {isLeader&&<span style={{fontFamily:"Orbitron",fontSize:6,letterSpacing:1,padding:"1px 5px",borderRadius:2,background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.3)",color:"var(--amber)",marginLeft:7}}>👑 LEADER</span>}
                    </div>
                    <span className="mono" style={{fontSize:8,color:SC[ps.status]||"var(--dim)"}}>{STATUS_EMOJI[ps.status]||"⚫"} {ps.status||"offline"}</span>
                    {user&&(user.username===detailAlliance.leader||user.isAdmin)&&m!==detailAlliance.leader&&(
                      <button onClick={()=>promoteToLeader(detailAlliance.id,m)} style={{background:"none",border:"1px solid rgba(251,191,36,.3)",borderRadius:4,color:"var(--amber)",cursor:"pointer",padding:"2px 7px",fontFamily:"Orbitron",fontSize:6}}>PROMOTE</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {user&&(detailAlliance.members||[]).includes(user.username)&&(
                <button className="neon-btn" onClick={leaveAlliance} style={{fontSize:8,borderColor:"var(--amber)",color:"var(--amber)"}}>LEAVE ALLIANCE</button>
              )}
              {user?.isAdmin&&(
                <button className="neon-btn" onClick={()=>disbandAlliance(detailAlliance.id)} style={{fontSize:8,borderColor:"var(--red)",color:"var(--red)"}}>DISBAND</button>
              )}
            </div>
          </div>
        )}

        {/* CREATE */}
        {view==="create"&&(
          <div style={{maxWidth:500}}>
            <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:14}}>➕ FOUND A NEW ALLIANCE</div>
            {myAlliance&&<div className="mono" style={{color:"var(--amber)",fontSize:10,marginBottom:12}}>⚠ You must leave [{myAlliance.tag}] before creating a new alliance.</div>}
            {!user&&<div className="mono" style={{color:"var(--dim)",fontSize:10,marginBottom:12}}>🔐 Log in to create an alliance.</div>}
            <div style={{display:"grid",gap:10}}>
              <div><label className="si-label">ALLIANCE NAME</label><input className="si" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Iron Wolves"/></div>
              <div><label className="si-label">TAG (max 5 chars, auto uppercase)</label><input className="si" value={form.tag} onChange={e=>setForm(f=>({...f,tag:e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,5)}))} placeholder="WOLF"/></div>
              <div><label className="si-label">DESCRIPTION</label><textarea className="si" rows={2} value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="What does your alliance stand for?"/></div>
              <div>
                <label className="si-label">ALLIANCE COLOR</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:4}}>
                  {ALLIANCE_COLORS.map(c=>(
                    <div key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{width:28,height:28,borderRadius:6,background:c,cursor:"pointer",border:form.color===c?"3px solid #fff":"3px solid transparent",boxShadow:form.color===c?`0 0 10px ${c}`:""}}/>
                  ))}
                </div>
              </div>
              <div style={{padding:"10px 14px",background:`${form.color}12`,border:`1px solid ${form.color}44`,borderRadius:8}}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <div style={{width:40,height:40,borderRadius:7,background:`${form.color}25`,border:`2px solid ${form.color}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span className="orb" style={{fontSize:8,color:form.color}}>{form.tag||"TAG"}</span>
                  </div>
                  <div>
                    <div className="orb" style={{fontSize:11,color:"#fff"}}>{form.name||"Alliance Name"}</div>
                    <span className="alliance-tag" style={{color:form.color,borderColor:`${form.color}44`,background:`${form.color}12`}}>[{form.tag||"TAG"}]</span>
                  </div>
                </div>
              </div>
              <button className="neon-btn" onClick={createAlliance} disabled={creating||!form.name.trim()||!form.tag.trim()||!user||!!myAlliance} style={{borderColor:"var(--cyan)",color:"var(--cyan)"}}>{creating?"CREATING...":"⟩ FOUND ALLIANCE ⟨"}</button>
            </div>
          </div>
        )}

        {/* HOF */}
        {view==="hof"&&(
          <div>
            <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:14}}>🏛️ ALLIANCE HALL OF FAME</div>
            <div style={{display:"grid",gap:10}}>
              {alliances.sort((a,b)=>(b.warRecord?.wins||0)-(a.warRecord?.wins||0)).slice(0,10).map((a,i)=>(
                <div key={a.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",border:`1px solid ${a.color}33`,borderRadius:8,background:`${a.color}06`}}>
                  <span className="orb" style={{fontSize:14,color:"var(--amber)",flexShrink:0}}>#{i+1}</span>
                  <div style={{width:38,height:38,borderRadius:7,background:`${a.color}20`,border:`1px solid ${a.color}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span className="orb" style={{fontSize:8,color:a.color}}>{a.tag}</span>
                  </div>
                  <div style={{flex:1}}>
                    <div className="orb" style={{fontSize:10,color:"#fff"}}>{a.name}</div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:2}}>👥 {(a.members||[]).length} members · 👑 {a.leader}</div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div className="orb" style={{fontSize:12,color:"var(--green)"}}>{a.warRecord?.wins||0}W</div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{a.warRecord?.losses||0}L {a.warRecord?.draws||0}D</div>
                  </div>
                </div>
              ))}
              {alliances.length===0&&<div style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>🏛️</div><div className="mono" style={{fontSize:10}}>No alliances formed yet.</div></div>}
            </div>
          </div>
        )}

      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v7.0 FEATURE 10: SERVER BULLETIN
// ═══════════════════════════════════════════════════════════════════════════════
const BULLETIN_CATS=["GENERAL","EVENT","RULE CHANGE","MAINTENANCE","WAR","ECONOMY","ALERT"];
const BULLETIN_COLORS={GENERAL:"var(--cyan)",EVENT:"var(--purple)",["RULE CHANGE"]:"var(--amber)",MAINTENANCE:"var(--blue)",WAR:"var(--red)",ECONOMY:"var(--green)",ALERT:"var(--red)"};

function BulletinPanel({onClose,user}){
  const toast=useToast();
  const[bulletins,setBulletins]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({title:"",body:"",category:"GENERAL",expiresIn:"",pinned:false});
  const[posting,setPosting]=useState(false);
  const[filter,setFilter]=useState("ALL");

  useEffect(()=>{
    DB.getBulletins().then(b=>{
      // Auto-filter expired
      const now=Date.now();
      const active=b.filter(x=>!x.expiresAt||new Date(x.expiresAt).getTime()>now);
      setBulletins(active);setLoading(false);
    });
    const t=setInterval(()=>DB.getBulletins().then(b=>{
      const now=Date.now();
      setBulletins(b.filter(x=>!x.expiresAt||new Date(x.expiresAt).getTime()>now));
    }),15000);
    return()=>clearInterval(t);
  },[]);

  const post=async()=>{
    if(!user?.isAdmin||!form.title.trim()||!form.body.trim())return;
    setPosting(true);
    const expiresAt=form.expiresIn?new Date(Date.now()+Number(form.expiresIn)*3600000).toISOString():null;
    const entry={id:Date.now(),title:form.title.trim(),body:form.body.trim(),category:form.category,pinned:form.pinned,expiresAt,postedBy:user.username,postedAt:new Date().toISOString()};
    const updated=[entry,...bulletins];
    setBulletins(updated);await DB.setBulletins(updated);
    await DB.pushNotif({type:"system",title:`BULLETIN: ${form.title.toUpperCase()}`,body:form.body.slice(0,80)});
    await DB.pushAdminLog({action:`POSTED BULLETIN: ${form.title}`,by:user.username});
    setForm({title:"",body:"",category:"GENERAL",expiresIn:"",pinned:false});setPosting(false);
    toast("Bulletin posted!","var(--cyan)","📌");
  };

  const deleteBulletin=async(id)=>{
    if(!user?.isAdmin)return;
    const updated=bulletins.filter(b=>b.id!==id);
    setBulletins(updated);await DB.setBulletins(updated);
    toast("Bulletin removed.","var(--dim)","🗑");
  };

  const pinned=bulletins.filter(b=>b.pinned).sort((a,b)=>new Date(b.postedAt)-new Date(a.postedAt));
  const regular=bulletins.filter(b=>!b.pinned).sort((a,b)=>new Date(b.postedAt)-new Date(a.postedAt));
  const filtered=filter==="ALL"?[...pinned,...regular]:[...bulletins.filter(b=>b.category===filter)].sort((a,b)=>new Date(b.postedAt)-new Date(a.postedAt));

  return(
    <Panel title="SERVER BULLETIN" subtitle="ANNOUNCEMENTS · NEWS · ALERTS" color="var(--blue)" onClose={onClose} wide>
      {user?.isAdmin&&(
        <div style={{background:"rgba(59,130,246,.05)",border:"1px solid rgba(59,130,246,.2)",borderRadius:10,padding:14,marginBottom:16}}>
          <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:10}}>📌 POST NEW BULLETIN</div>
          <div style={{display:"grid",gap:9}}>
            <div style={{display:"flex",gap:8}}><div style={{flex:1}}><label className="si-label">TITLE</label><input className="si" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Bulletin title..."/></div><div style={{width:130}}><label className="si-label">CATEGORY</label><select className="si" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{BULLETIN_CATS.map(c=><option key={c}>{c}</option>)}</select></div></div>
            <div><label className="si-label">BODY</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} placeholder="Full bulletin text..."/></div>
            <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
              <div style={{width:160}}><label className="si-label">EXPIRES IN (hours, blank = never)</label><input className="si" type="number" min="1" value={form.expiresIn} onChange={e=>setForm(f=>({...f,expiresIn:e.target.value}))} placeholder="e.g. 48"/></div>
              <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",paddingBottom:3}}>
                <input type="checkbox" checked={form.pinned} onChange={e=>setForm(f=>({...f,pinned:e.target.checked}))}/>
                <span className="mono" style={{fontSize:9,color:"var(--text)"}}>📌 Pin to top</span>
              </label>
              <button className="neon-btn" onClick={post} disabled={posting||!form.title.trim()||!form.body.trim()} style={{fontSize:8,borderColor:"var(--blue)",color:"var(--blue)",flexShrink:0}}>{posting?"POSTING...":"POST →"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter row */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
        {["ALL",...BULLETIN_CATS].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"4px 9px",borderRadius:4,cursor:"pointer",background:filter===f?`${BULLETIN_COLORS[f]||"rgba(0,245,255,.15)"}18`:"transparent",border:`1px solid ${filter===f?BULLETIN_COLORS[f]||"var(--cyan)":"rgba(0,245,255,.12)"}`,color:filter===f?BULLETIN_COLORS[f]||"var(--cyan)":"var(--dim)"}}>{f}</button>
        ))}
      </div>

      {loading?<div className="mono" style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}>LOADING...</div>:(
        filtered.length===0?<div style={{textAlign:"center",padding:"40px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>📋</div><div className="mono" style={{fontSize:10}}>No bulletins posted yet.</div></div>:(
          <div style={{display:"grid",gap:10,maxHeight:"56vh",overflowY:"auto"}}>
            {filtered.map(b=>{
              const col=BULLETIN_COLORS[b.category]||"var(--cyan)";
              return(
                <div key={b.id} className="bulletin-card" style={{borderColor:`${col}33`,background:`${col}05`}}>
                  <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:8}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                        {b.pinned&&<span style={{fontSize:12}}>📌</span>}
                        <div className="orb" style={{fontSize:11,color:"#fff",letterSpacing:1}}>{b.title}</div>
                        <span className="bulletin-cat" style={{background:`${col}15`,border:`1px solid ${col}44`,color:col}}>{b.category}</span>
                      </div>
                      <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.7,whiteSpace:"pre-line"}}>{b.body}</div>
                    </div>
                    {user?.isAdmin&&<button onClick={()=>deleteBulletin(b.id)} style={{background:"none",border:"none",color:"rgba(255,68,68,.5)",cursor:"pointer",fontSize:16,flexShrink:0}}>×</button>}
                  </div>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>By {b.postedBy} · {new Date(b.postedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>
                    {b.expiresAt&&<span className="mono" style={{fontSize:8,color:"var(--amber)"}}>⏱ Expires {new Date(b.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v7.0 FEATURE 11: BAN / WARNING LOG
// ═══════════════════════════════════════════════════════════════════════════════
const BAN_TYPES={warn:{label:"WARNING",color:"var(--amber)",icon:"⚠️"},tempban:{label:"TEMP BAN",color:"var(--orange)",icon:"⏸️"},permban:{label:"PERM BAN",color:"var(--red)",icon:"🔨"}};

function BanLogPanel({onClose,user}){
  const toast=useToast();
  const[banLog,setBanLog]=useState([]);
  const[loading,setLoading]=useState(true);
  const[users,setUsers]=useState([]);
  const[form,setForm]=useState({username:"",type:"warn",reason:"",duration:""});
  const[appeal,setAppeal]=useState({id:null,text:""});
  const[appealSent,setAppealSent]=useState({});
  const[filter,setFilter]=useState("all");

  useEffect(()=>{
    Promise.all([DB.getBanLog(),DB.getUsers()]).then(([b,u])=>{
      setBanLog(b);setUsers(u.filter(x=>!x.isAdmin));setLoading(false);
    });
  },[]);

  const addEntry=async()=>{
    if(!user?.isAdmin||!form.username.trim()||!form.reason.trim())return;
    const entry={username:form.username,type:form.type,reason:form.reason.trim(),duration:form.duration.trim()||null,issuedBy:user.username,status:"active",appeals:[]};
    const updated=await DB.getBanLog();
    const newLog=[{...entry,id:Date.now(),ts:new Date().toISOString()},...updated];
    setBanLog(newLog);await DB.setBanLog(newLog);
    await DB.pushNotif({type:"admin",title:`${BAN_TYPES[form.type].label}: ${form.username}`,body:form.reason});
    await DB.pushAdminLog({action:`ISSUED ${form.type.toUpperCase()} TO ${form.username}`,by:user.username,detail:form.reason.slice(0,60)});
    setForm({username:"",type:"warn",reason:"",duration:""});
    toast(`${BAN_TYPES[form.type].label} issued!`,"var(--orange)","⚠️");
  };

  const revokeEntry=async(id)=>{
    if(!user?.isAdmin)return;
    const updated=banLog.map(b=>b.id===id?{...b,status:"revoked",revokedBy:user.username,revokedAt:new Date().toISOString()}:b);
    setBanLog(updated);await DB.setBanLog(updated);
    await DB.pushAdminLog({action:`REVOKED BAN/WARN #${id}`,by:user.username});
    toast("Entry revoked.","var(--green)","✅");
  };

  const submitAppeal=async(banId)=>{
    if(!user||!appeal.text.trim())return;
    const updated=banLog.map(b=>b.id===banId?{...b,appeals:[...(b.appeals||[]),{username:user.username,text:appeal.text.trim(),ts:new Date().toISOString(),status:"pending"}]}:b);
    setBanLog(updated);await DB.setBanLog(updated);
    await DB.pushNotif({type:"admin",title:"BAN APPEAL SUBMITTED",body:`${user.username} appealed ban #${banId}: ${appeal.text.slice(0,60)}`});
    setAppeal({id:null,text:""});setAppealSent(s=>({...s,[banId]:true}));
    toast("Appeal submitted!","var(--cyan)","📝");
  };

  const respondToAppeal=async(banId,appealIdx,status)=>{
    if(!user?.isAdmin)return;
    const updated=banLog.map(b=>b.id===banId?{...b,appeals:(b.appeals||[]).map((a,i)=>i===appealIdx?{...a,status}:a),status:status==="approved"?"revoked":b.status}:b);
    setBanLog(updated);await DB.setBanLog(updated);
    toast(`Appeal ${status}!`,status==="approved"?"var(--green)":"var(--red)","✅");
  };

  // Player-only view: their own records
  const myEntries=user&&!user.isAdmin?banLog.filter(b=>b.username===user.username):[];
  const allFiltered=filter==="all"?banLog:banLog.filter(b=>b.type===filter);

  return(
    <Panel title="BAN & WARNING LOG" subtitle="MODERATION · APPEALS · RECORDS" color="var(--red)" onClose={onClose} wide>

      {/* Admin: issue entry */}
      {user?.isAdmin&&(
        <div style={{background:"rgba(255,68,68,.05)",border:"1px solid rgba(255,68,68,.2)",borderRadius:10,padding:14,marginBottom:16}}>
          <div className="orb" style={{fontSize:8,color:"var(--red)",letterSpacing:2,marginBottom:10}}>🔨 ISSUE WARNING / BAN</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
            <div><label className="si-label">PLAYER</label>
              <select className="si" value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))}>
                <option value="">— Select player —</option>
                {users.map(u=><option key={u.username}>{u.username}</option>)}
              </select>
            </div>
            <div><label className="si-label">TYPE</label>
              <select className="si" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                {Object.entries(BAN_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div><label className="si-label">REASON</label><input className="si" value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))} placeholder="Reason for action..."/></div>
            <div><label className="si-label">DURATION (for temp ban, e.g. "3 days")</label><input className="si" value={form.duration} onChange={e=>setForm(f=>({...f,duration:e.target.value}))} placeholder="Leave blank for permanent"/></div>
          </div>
          <button className="neon-btn" onClick={addEntry} disabled={!form.username||!form.reason.trim()} style={{marginTop:10,fontSize:8,borderColor:"var(--red)",color:"var(--red)"}}>⟩ ISSUE ACTION ⟨</button>
        </div>
      )}

      {/* Player: view own records */}
      {user&&!user.isAdmin&&myEntries.length>0&&(
        <div style={{marginBottom:16}}>
          <div className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:2,marginBottom:10}}>⚠️ YOUR RECORDS</div>
          {myEntries.map(b=>{
            const T=BAN_TYPES[b.type]||BAN_TYPES.warn;
            const hasAppealed=appealSent[b.id]||(b.appeals||[]).some(a=>a.username===user.username);
            return(
              <div key={b.id} className={`ban-entry ban-type-${b.type}`} style={{opacity:b.status==="revoked"?0.5:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:14}}>{T.icon}</span>
                  <span className="orb" style={{fontSize:9,color:T.color,letterSpacing:1}}>{T.label}</span>
                  <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>· {new Date(b.ts).toLocaleDateString()}</span>
                  {b.duration&&<span className="mono" style={{fontSize:8,color:"var(--amber)"}}>· {b.duration}</span>}
                  {b.status==="revoked"&&<span className="mono" style={{fontSize:8,color:"var(--green)"}}>✅ REVOKED</span>}
                </div>
                <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.6,marginBottom:6}}>{b.reason}</div>
                {b.status!=="revoked"&&!hasAppealed&&(
                  appeal.id===b.id?(
                    <div className="appeal-form">
                      <div className="orb" style={{fontSize:7,color:"var(--cyan)",letterSpacing:2,marginBottom:6}}>SUBMIT APPEAL</div>
                      <textarea className="si" rows={2} value={appeal.text} onChange={e=>setAppeal(a=>({...a,text:e.target.value}))} placeholder="Explain your case..." style={{marginBottom:8}}/>
                      <div style={{display:"flex",gap:7}}>
                        <button className="neon-btn" onClick={()=>submitAppeal(b.id)} disabled={!appeal.text.trim()} style={{fontSize:7,padding:"6px 12px",borderColor:"var(--cyan)",color:"var(--cyan)"}}>SUBMIT</button>
                        <button onClick={()=>setAppeal({id:null,text:""})} style={{background:"none",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"5px 10px",cursor:"pointer",fontFamily:"Orbitron",fontSize:7}}>CANCEL</button>
                      </div>
                    </div>
                  ):(
                    <button onClick={()=>setAppeal({id:b.id,text:""})} style={{background:"rgba(0,245,255,.06)",border:"1px solid rgba(0,245,255,.2)",borderRadius:4,color:"var(--cyan)",cursor:"pointer",padding:"5px 12px",fontFamily:"Orbitron",fontSize:7,letterSpacing:1}}>📝 SUBMIT APPEAL</button>
                  )
                )}
                {hasAppealed&&<div className="mono" style={{fontSize:8,color:"var(--dim)"}}>📝 Appeal submitted — awaiting review</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Admin: full log */}
      {user?.isAdmin&&(
        <div>
          <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
            <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>FILTER:</span>
            {["all",...Object.keys(BAN_TYPES)].map(f=>(
              <button key={f} onClick={()=>setFilter(f)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"4px 9px",borderRadius:4,cursor:"pointer",background:filter===f?"rgba(255,68,68,.15)":"transparent",border:`1px solid ${filter===f?"var(--red)":"rgba(255,68,68,.2)"}`,color:filter===f?"var(--red)":"var(--dim)"}}>{f.toUpperCase()}</button>
            ))}
            <span className="mono" style={{fontSize:9,color:"var(--dim)",marginLeft:"auto"}}>{allFiltered.length} records</span>
          </div>
          {loading?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"20px"}}>LOADING...</div>:(
            allFiltered.length===0?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"20px"}}>No records found.</div>:(
              <div style={{display:"grid",gap:8,maxHeight:"52vh",overflowY:"auto"}}>
                {allFiltered.map(b=>{
                  const T=BAN_TYPES[b.type]||BAN_TYPES.warn;
                  return(
                    <div key={b.id} className={`ban-entry ban-type-${b.type}`} style={{opacity:b.status==="revoked"?0.5:1}}>
                      <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                        <span style={{fontSize:16,flexShrink:0}}>{T.icon}</span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4,alignItems:"center"}}>
                            <span className="orb" style={{fontSize:10,color:"var(--text)"}}>{b.username}</span>
                            <span className="mono" style={{fontSize:8,color:T.color,padding:"1px 6px",border:`1px solid ${T.color}44`,borderRadius:3}}>{T.label}</span>
                            {b.duration&&<span className="mono" style={{fontSize:8,color:"var(--amber)"}}>⏱ {b.duration}</span>}
                            {b.status==="revoked"&&<span className="mono" style={{fontSize:8,color:"var(--green)"}}>✅ REVOKED</span>}
                            <span className="mono" style={{fontSize:7,color:"var(--dim)",marginLeft:"auto"}}>{new Date(b.ts).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"2-digit"})} · by {b.issuedBy}</span>
                          </div>
                          <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.6,marginBottom:6}}>{b.reason}</div>
                          {/* Appeals */}
                          {(b.appeals||[]).map((a,i)=>(
                            <div key={i} className="mod-comment" style={{marginBottom:6}}>
                              <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:3}}>
                                <span className="mono" style={{fontSize:8,color:"var(--cyan)"}}>{a.username}</span>
                                <span className="mono" style={{fontSize:7,color:"var(--dim)"}}>{new Date(a.ts).toLocaleDateString()}</span>
                                <span className="mono" style={{fontSize:7,color:a.status==="approved"?"var(--green)":a.status==="rejected"?"var(--red)":"var(--amber)",marginLeft:"auto"}}>{a.status?.toUpperCase()||"PENDING"}</span>
                              </div>
                              <div className="mono" style={{fontSize:9,color:"var(--text)",lineHeight:1.5}}>{a.text}</div>
                              {a.status==="pending"&&(
                                <div style={{display:"flex",gap:6,marginTop:5}}>
                                  <button onClick={()=>respondToAppeal(b.id,i,"approved")} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:3,padding:"2px 8px",cursor:"pointer",fontFamily:"Orbitron",fontSize:7}}>APPROVE</button>
                                  <button onClick={()=>respondToAppeal(b.id,i,"rejected")} style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:3,padding:"2px 8px",cursor:"pointer",fontFamily:"Orbitron",fontSize:7}}>REJECT</button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {b.status==="active"&&user?.isAdmin&&(
                          <button onClick={()=>revokeEntry(b.id)} style={{background:"rgba(57,255,20,.08)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontFamily:"Orbitron",fontSize:7,flexShrink:0}}>REVOKE</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}

      {!user&&<div className="mono" style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}>🔐 Log in to view your records</div>}
      {user&&!user.isAdmin&&myEntries.length===0&&<div style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>✅</div><div className="mono" style={{fontSize:10}}>No warnings or bans on your account. Keep it up!</div></div>}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v7.0 FEATURE 12: SCHEDULED ANNOUNCEMENTS ADMIN TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ScheduledAnnsTab({user,toast}){
  const[queue,setQueue]=useState([]);
  const[form,setForm]=useState({title:"",body:"",type:"system",publishAt:""});
  const[saving,setSaving]=useState(false);

  useEffect(()=>{
    DB.getScheduledAnns().then(setQueue);
    // Auto-check every 60 sec
    const check=async()=>{
      const anns=await DB.getScheduledAnns();
      const now=new Date();
      const toPublish=anns.filter(a=>a.status==="scheduled"&&new Date(a.publishAt)<=now);
      if(toPublish.length){
        for(const a of toPublish){
          await DB.pushNotif({type:a.type,title:a.title.toUpperCase(),body:a.body});
          fireBrowserNotif(a.title,a.body);
        }
        const updated=anns.map(a=>toPublish.find(p=>p.id===a.id)?{...a,status:"published",publishedAt:new Date().toISOString()}:a);
        await DB.setScheduledAnns(updated);
        setQueue(updated);
      }else setQueue(anns);
    };
    check();
    const t=setInterval(check,60000);
    return()=>clearInterval(t);
  },[]);

  const schedule=async()=>{
    if(!form.title.trim()||!form.body.trim()||!form.publishAt)return;
    setSaving(true);
    const entry={id:Date.now(),title:form.title.trim(),body:form.body.trim(),type:form.type,publishAt:new Date(form.publishAt).toISOString(),status:"scheduled",scheduledBy:user.username};
    const updated=[...queue,entry];
    setQueue(updated);await DB.setScheduledAnns(updated);
    await DB.pushAdminLog({action:`SCHEDULED ANNOUNCEMENT: ${form.title}`,by:user.username,detail:`publishes ${form.publishAt}`});
    setForm({title:"",body:"",type:"system",publishAt:""});setSaving(false);
    toast("Announcement scheduled!","var(--purple)","⏰");
  };

  const cancelAnn=async(id)=>{
    const updated=queue.map(a=>a.id===id?{...a,status:"cancelled"}:a);
    setQueue(updated);await DB.setScheduledAnns(updated);toast("Cancelled.","var(--dim)","×");
  };

  const STATUS_COLORS={scheduled:"var(--cyan)",published:"var(--green)",cancelled:"var(--red)"};
  return(
    <div>
      <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:14}}>⏰ SCHEDULED ANNOUNCEMENTS</div>
      <div className="mono" style={{fontSize:9,color:"var(--dim)",marginBottom:12,lineHeight:1.7}}>Queue announcements to publish at a specific date/time. Checked every 60 seconds. Publishes as a notification to all users.</div>
      <div style={{display:"grid",gap:9,marginBottom:16,maxWidth:500}}>
        <div><label className="si-label">TITLE</label><input className="si" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Announcement title..."/></div>
        <div><label className="si-label">BODY</label><textarea className="si" rows={2} style={{resize:"vertical"}} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))} placeholder="Message body..."/></div>
        <div style={{display:"flex",gap:8}}>
          <div style={{flex:1}}><label className="si-label">TYPE</label><select className="si" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>{["system","server","war","admin","event"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div style={{flex:1}}><label className="si-label">PUBLISH DATE & TIME</label><input className="si" type="datetime-local" value={form.publishAt} onChange={e=>setForm(f=>({...f,publishAt:e.target.value}))}/></div>
        </div>
        <button className="neon-btn" onClick={schedule} disabled={saving||!form.title.trim()||!form.body.trim()||!form.publishAt} style={{borderColor:"var(--purple)",color:"var(--purple)",fontSize:9}}>{saving?"SAVING...":"⟩ SCHEDULE ANNOUNCEMENT ⟨"}</button>
      </div>

      <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:8}}>QUEUE · {queue.length} ENTRIES</div>
      {queue.length===0?<div className="mono" style={{color:"var(--dim)"}}>Queue is empty.</div>:(
        <div style={{border:"1px solid rgba(0,245,255,.12)",borderRadius:8,overflow:"hidden"}}>
          {queue.sort((a,b)=>new Date(a.publishAt)-new Date(b.publishAt)).map(a=>(
            <div key={a.id} className="sched-ann-row">
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  <span className="mono" style={{fontSize:10,color:"var(--text)"}}>{a.title}</span>
                  <span className="mono" style={{fontSize:7,color:STATUS_COLORS[a.status]||"var(--dim)",padding:"1px 5px",border:`1px solid ${STATUS_COLORS[a.status]||"rgba(0,245,255,.2)"}44`,borderRadius:3}}>{a.status?.toUpperCase()}</span>
                </div>
                <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:2}}>⏰ {new Date(a.publishAt).toLocaleString()} · by {a.scheduledBy}</div>
              </div>
              {a.status==="scheduled"&&<button onClick={()=>cancelAnn(a.id)} style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontFamily:"Orbitron",fontSize:7,flexShrink:0}}>CANCEL</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  v7.0 FEATURE 13: MOD REVIEW CENTER
// ═══════════════════════════════════════════════════════════════════════════════
function ModReviewPanel({onClose,user}){
  const toast=useToast();
  const[reviews,setReviews]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({modName:"",version:"",link:"",desc:"",category:"client",reporter:""});
  const[view,setView]=useState("list"); // list | submit | illegal
  const[commentInputs,setCommentInputs]=useState({});
  const[submitting,setSubmitting]=useState(false);
  const[illegalForm,setIllegalForm]=useState({modName:"",reason:"",reporter:""});

  useEffect(()=>{DB.getModReviews().then(r=>{setReviews(r);setLoading(false);});},[]);

  const submit=async()=>{
    if(!form.modName.trim()||!form.desc.trim())return;
    setSubmitting(true);
    const entry={id:Date.now(),modName:form.modName.trim(),version:form.version.trim(),link:form.link.trim(),desc:form.desc.trim(),category:form.category,submittedBy:user?user.username:form.reporter||"Anonymous",status:"pending",comments:[],ts:new Date().toISOString(),illegal:false};
    const updated=[entry,...reviews];
    setReviews(updated);await DB.setModReviews(updated);
    setForm({modName:"",version:"",link:"",desc:"",category:"client",reporter:""});setSubmitting(false);setView("list");
    toast("Mod submitted for review!","var(--purple)","✅");
  };

  const reportIllegal=async()=>{
    if(!illegalForm.modName.trim())return;
    const entry={id:Date.now(),modName:illegalForm.modName.trim(),desc:illegalForm.reason.trim()||"Reported as illegal/cheating mod",category:"illegal",submittedBy:user?user.username:illegalForm.reporter||"Anonymous",status:"testing",comments:[],ts:new Date().toISOString(),illegal:true};
    const updated=[entry,...reviews];
    setReviews(updated);await DB.setModReviews(updated);
    await DB.pushNotif({type:"admin",title:"ILLEGAL MOD REPORT",body:`${entry.submittedBy} reported: ${illegalForm.modName}`});
    setIllegalForm({modName:"",reason:"",reporter:""});setView("list");
    toast("Illegal mod reported!","var(--red)","🚫");
  };

  const setStatus=async(id,status)=>{
    if(!user?.isAdmin)return;
    const updated=reviews.map(r=>r.id===id?{...r,status,reviewedBy:user.username,reviewedAt:new Date().toISOString()}:r);
    setReviews(updated);await DB.setModReviews(updated);
    await DB.pushAdminLog({action:`MOD ${status.toUpperCase()}: ${reviews.find(r=>r.id===id)?.modName}`,by:user.username});
    toast(`Mod marked ${status}!`,status==="approved"?"var(--green)":status==="rejected"?"var(--red)":"var(--amber)","✅");
  };

  const addComment=async(id)=>{
    const text=commentInputs[id]?.trim();
    if(!text||!user)return;
    const updated=reviews.map(r=>r.id===id?{...r,comments:[...(r.comments||[]),{username:user.username,text,ts:new Date().toISOString(),isAdmin:!!user.isAdmin}]}:r);
    setReviews(updated);await DB.setModReviews(updated);
    setCommentInputs(c=>({...c,[id]:""}));
    toast("Comment added!","var(--dim)","💬");
  };

  const CATS={client:"🖥 Client",optimization:"⚡ Optimization",utility:"🔧 Utility",cosmetic:"🎨 Cosmetic",illegal:"🚫 Illegal"};
  const STATUS_INFO={pending:{color:"var(--dim)",label:"PENDING REVIEW"},approved:{color:"var(--green)",label:"APPROVED"},rejected:{color:"var(--red)",label:"REJECTED"},testing:{color:"var(--amber)",label:"IN TESTING"}};

  const approvedMods=reviews.filter(r=>r.status==="approved"&&!r.illegal);
  const illegalMods=reviews.filter(r=>r.illegal||r.category==="illegal");
  const pendingMods=reviews.filter(r=>r.status==="pending");
  const testingMods=reviews.filter(r=>r.status==="testing"&&!r.illegal);

  return(
    <Panel title="MOD REVIEW CENTER" subtitle="SUBMIT · REVIEW · ILLEGAL REPORTS" color="var(--purple)" onClose={onClose} wide>
      {/* Nav */}
      <div style={{display:"flex",gap:7,marginBottom:16,flexWrap:"wrap"}}>
        {[{id:"list",l:"📋 ALL MODS"},{id:"approved",l:`✅ APPROVED (${approvedMods.length})`},{id:"submit",l:"➕ SUBMIT MOD"},{id:"illegal",l:`🚫 ILLEGAL REPORTS (${illegalMods.length})`}].map(t=>(
          <button key={t.id} onClick={()=>setView(t.id)} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:1,padding:"5px 10px",borderRadius:4,cursor:"pointer",background:view===t.id?"rgba(180,77,255,.2)":"transparent",border:`1px solid ${view===t.id?"var(--purple)":"rgba(180,77,255,.18)"}`,color:view===t.id?"var(--purple)":"var(--dim)"}}>{t.l}</button>
        ))}
      </div>

      <div style={{maxHeight:"62vh",overflowY:"auto"}}>

        {/* LIST */}
        {view==="list"&&(
          <div>
            {loading?<div className="mono" style={{textAlign:"center",padding:"30px",color:"var(--dim)"}}>LOADING...</div>:(
              reviews.filter(r=>!r.illegal&&r.category!=="illegal").length===0?<div style={{textAlign:"center",padding:"30px 0",color:"var(--dim)"}}><div style={{fontSize:28,marginBottom:8}}>🔧</div><div className="mono" style={{fontSize:10}}>No mods submitted yet.</div></div>:(
                <div style={{display:"grid",gap:10}}>
                  {reviews.filter(r=>!r.illegal&&r.category!=="illegal").sort((a,b)=>new Date(b.ts)-new Date(a.ts)).map(r=>{
                    const si=STATUS_INFO[r.status]||STATUS_INFO.pending;
                    return(
                      <div key={r.id} className="mod-card">
                        <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:5}}>
                              <div className="orb" style={{fontSize:11,color:"var(--text)",letterSpacing:1}}>{r.modName}</div>
                              {r.version&&<span className="mono" style={{fontSize:8,color:"var(--dim)"}}>v{r.version}</span>}
                              <span className="mono" style={{fontSize:7,color:si.color,padding:"1px 6px",border:`1px solid ${si.color}44`,borderRadius:3,marginLeft:"auto"}}>{si.label}</span>
                            </div>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
                              <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>{CATS[r.category]||r.category}</span>
                              <span className="mono" style={{fontSize:8,color:"var(--dim)"}}>By {r.submittedBy}</span>
                              {r.link&&<a href={r.link} target="_blank" rel="noopener noreferrer" style={{fontFamily:"Share Tech Mono",fontSize:8,color:"var(--blue)"}}>🔗 LINK</a>}
                            </div>
                            <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.6,marginBottom:8}}>{r.desc}</div>
                            {/* Comments */}
                            {(r.comments||[]).map((c,i)=>(
                              <div key={i} className="mod-comment">
                                <div style={{display:"flex",gap:8,marginBottom:3}}>
                                  <span className="mono" style={{fontSize:8,color:c.isAdmin?"var(--orange)":"var(--cyan)"}}>{c.isAdmin?"🛠 "+c.username:c.username}</span>
                                  <span className="mono" style={{fontSize:7,color:"var(--dim)"}}>{new Date(c.ts).toLocaleDateString()}</span>
                                </div>
                                <div className="mono" style={{fontSize:9,color:"var(--text)",lineHeight:1.5}}>{c.text}</div>
                              </div>
                            ))}
                            {/* Comment input */}
                            {user&&(
                              <div style={{display:"flex",gap:7,marginTop:8}}>
                                <input className="si" value={commentInputs[r.id]||""} onChange={e=>setCommentInputs(c=>({...c,[r.id]:e.target.value}))} placeholder="Add comment..." style={{flex:1,padding:"6px 10px",fontSize:11}} onKeyDown={e=>e.key==="Enter"&&addComment(r.id)}/>
                                <button onClick={()=>addComment(r.id)} style={{background:"rgba(0,245,255,.08)",border:"1px solid rgba(0,245,255,.25)",borderRadius:4,color:"var(--cyan)",cursor:"pointer",padding:"5px 10px",fontFamily:"Orbitron",fontSize:7}}>SEND</button>
                              </div>
                            )}
                          </div>
                          {/* Admin actions */}
                          {user?.isAdmin&&(
                            <div style={{display:"flex",flexDirection:"column",gap:5,flexShrink:0}}>
                              {r.status!=="approved"&&<button onClick={()=>setStatus(r.id,"approved")} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontFamily:"Orbitron",fontSize:6}}>APPROVE</button>}
                              {r.status!=="testing"&&<button onClick={()=>setStatus(r.id,"testing")} style={{background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.3)",color:"var(--amber)",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontFamily:"Orbitron",fontSize:6}}>TESTING</button>}
                              {r.status!=="rejected"&&<button onClick={()=>setStatus(r.id,"rejected")} style={{background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontFamily:"Orbitron",fontSize:6}}>REJECT</button>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        )}

        {/* APPROVED LIST */}
        {view==="approved"&&(
          <div>
            <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:2,marginBottom:12}}>✅ APPROVED & SAFE MODS · {approvedMods.length}</div>
            {approvedMods.length===0?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"20px"}}>No approved mods yet.</div>:(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
                {approvedMods.map(r=>(
                  <div key={r.id} style={{border:"1px solid rgba(57,255,20,.3)",borderRadius:8,padding:"12px 14px",background:"rgba(57,255,20,.04)"}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5}}>
                      <span style={{fontSize:16}}>✅</span>
                      <div>
                        <div className="orb" style={{fontSize:9,color:"var(--text)"}}>{r.modName} {r.version&&`v${r.version}`}</div>
                        <div className="mono" style={{fontSize:7,color:"var(--dim)"}}>{CATS[r.category]||r.category}</div>
                      </div>
                    </div>
                    <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.5,marginBottom:6}}>{r.desc}</div>
                    {r.link&&<a href={r.link} target="_blank" rel="noopener noreferrer" style={{fontFamily:"Share Tech Mono",fontSize:8,color:"var(--blue)"}}>🔗 Download</a>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUBMIT */}
        {view==="submit"&&(
          <div style={{maxWidth:500}}>
            <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:12}}>➕ SUBMIT MOD FOR REVIEW</div>
            <div style={{display:"grid",gap:9}}>
              <div style={{display:"flex",gap:8}}><div style={{flex:2}}><label className="si-label">MOD NAME</label><input className="si" value={form.modName} onChange={e=>setForm(f=>({...f,modName:e.target.value}))} placeholder="e.g. Sodium"/></div><div style={{flex:1}}><label className="si-label">VERSION</label><input className="si" value={form.version} onChange={e=>setForm(f=>({...f,version:e.target.value}))} placeholder="e.g. 0.5.3"/></div></div>
              <div><label className="si-label">DOWNLOAD LINK (optional)</label><input className="si" value={form.link} onChange={e=>setForm(f=>({...f,link:e.target.value}))} placeholder="https://modrinth.com/..."/></div>
              <div><label className="si-label">CATEGORY</label><select className="si" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{Object.entries(CATS).filter(([k])=>k!=="illegal").map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
              <div><label className="si-label">DESCRIPTION / WHY IT'S USEFUL</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={form.desc} onChange={e=>setForm(f=>({...f,desc:e.target.value}))} placeholder="What does this mod do? Why should it be allowed?"/></div>
              {!user&&<div><label className="si-label">YOUR NAME (or leave blank for anonymous)</label><input className="si" value={form.reporter} onChange={e=>setForm(f=>({...f,reporter:e.target.value}))}/></div>}
              <button className="neon-btn" onClick={submit} disabled={submitting||!form.modName.trim()||!form.desc.trim()} style={{borderColor:"var(--purple)",color:"var(--purple)"}}>{submitting?"SUBMITTING...":"⟩ SUBMIT FOR REVIEW ⟨"}</button>
            </div>
          </div>
        )}

        {/* ILLEGAL REPORTS */}
        {view==="illegal"&&(
          <div>
            <div style={{background:"rgba(255,68,68,.06)",border:"1px solid rgba(255,68,68,.2)",borderRadius:8,padding:14,marginBottom:14}}>
              <div className="orb" style={{fontSize:8,color:"var(--red)",letterSpacing:2,marginBottom:10}}>🚫 REPORT ILLEGAL / CHEATING MOD</div>
              <div style={{display:"grid",gap:8}}>
                <div><label className="si-label">MOD NAME</label><input className="si" value={illegalForm.modName} onChange={e=>setIllegalForm(f=>({...f,modName:e.target.value}))} placeholder="e.g. Kill Aura Plus"/></div>
                <div><label className="si-label">WHY IS IT ILLEGAL?</label><textarea className="si" rows={2} value={illegalForm.reason} onChange={e=>setIllegalForm(f=>({...f,reason:e.target.value}))} placeholder="Explain the advantage it gives..."/></div>
                {!user&&<div><label className="si-label">YOUR NAME (optional)</label><input className="si" value={illegalForm.reporter} onChange={e=>setIllegalForm(f=>({...f,reporter:e.target.value}))}/></div>}
                <button className="neon-btn" onClick={reportIllegal} disabled={!illegalForm.modName.trim()} style={{fontSize:8,borderColor:"var(--red)",color:"var(--red)"}}>🚫 REPORT</button>
              </div>
            </div>
            <div className="orb" style={{fontSize:8,color:"var(--red)",letterSpacing:2,marginBottom:10}}>REPORTED ILLEGAL MODS · {illegalMods.length}</div>
            {illegalMods.length===0?<div className="mono" style={{color:"var(--dim)",textAlign:"center",padding:"20px"}}>No illegal mods reported.</div>:(
              <div style={{display:"grid",gap:8}}>
                {illegalMods.map(r=>(
                  <div key={r.id} style={{border:"1px solid rgba(255,68,68,.3)",borderRadius:8,padding:"10px 14px",background:"rgba(255,68,68,.04)"}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:5}}>
                      <span style={{fontSize:14}}>🚫</span>
                      <div className="orb" style={{fontSize:10,color:"var(--red)"}}>{r.modName}</div>
                      <span className="mono" style={{fontSize:7,color:"var(--dim)",marginLeft:"auto"}}>Reported by {r.submittedBy}</span>
                    </div>
                    {r.desc&&<div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.5}}>{r.desc}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSOLE PANEL — Real logs when bridge live, empty when offline
// ═══════════════════════════════════════════════════════════════════════════════
function ConsoleFeed({ logs }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);
  const typeColor = { log:"rgba(0,245,255,.8)", system:"rgba(180,77,255,.9)", command:"rgba(57,255,20,.95)", error:"rgba(255,68,68,.95)", warn:"rgba(251,191,36,.9)" };
  const stamp = (iso) => { const d=new Date(iso); return `[${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}]`; };
  return (
    <div ref={scrollRef} className="console-wrap" style={{ height: 340, overflowY: "auto" }}>
      <div style={{ padding: "8px 0" }}>
        {logs.map((l, i) => (
          <div key={l.id || i} className="console-log">
            <span style={{ color: "rgba(0,245,255,.25)", marginRight: 8 }}>{stamp(l.ts)}</span>
            <span style={{ color: typeColor[l.type] || typeColor.log }}>{l.message}</span>
          </div>
        ))}
        <div className="console-log">
          <span style={{ color:"rgba(57,255,20,.8)" }}>{">"}</span><span className="console-cursor"/>
        </div>
      </div>
    </div>
  );
}

function ConsolePanel({ onClose, user }) {
  const toast = useToast();
  const { bridge, isLive, loading: bridgeLoading } = useBridgeStatus();
  const [logs, setLogs]       = useState([]);
  const [input, setInput]     = useState("");
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  const loadLogs = useCallback(async () => {
    const saved = await DB.getConsoleLogs();
    setLogs([...saved].reverse().slice(0, 300));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLogs();
    // Poll Firestore every 3s — the daemon pushes logs here in real time
    const t = setInterval(loadLogs, 3000);
    return () => clearInterval(t);
  }, [loadLogs]);

  const sendCommand = async () => {
    const cmd = input.trim();
    if (!cmd || !user?.isAdmin) return;
    setSending(true);
    setCmdHistory(h => [cmd, ...h].slice(0, 50));
    setHistIdx(-1);

    if (isLive && bridge) {
      // Real execution via bridge HTTP API
      const url = (await DB.getServer())?.bridgeUrl;
      try {
        const res = await fetch(`${url}/console/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: cmd, sentBy: user.username }),
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(await res.text());
        await DB.pushConsoleLog({ type: "command", message: `> ${cmd}`, source: "bridge", sentBy: user.username });
        toast("Command sent to server.", "var(--green)", "▶");
      } catch (e) {
        toast("Bridge error: " + e.message, "var(--red)", "⚠");
        await DB.pushConsoleLog({ type: "error", message: `[Bridge Error] ${e.message}`, source: "bridge" });
      }
    } else {
      // Bridge offline — log command as pending, daemon will process when it reconnects
      await DB.pushConsoleLog({ type: "command", message: `> ${cmd}`, source: "queued", sentBy: user.username });
      toast("Bridge offline — command queued in log.", "var(--amber)", "⏳");
    }
    setInput("");
    await loadLogs();
    setSending(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter") { sendCommand(); return; }
    if (e.key === "ArrowUp") { const i=Math.min(histIdx+1,cmdHistory.length-1); setHistIdx(i); setInput(cmdHistory[i]||""); }
    if (e.key === "ArrowDown") { const i=Math.max(histIdx-1,-1); setHistIdx(i); setInput(i<0?"":cmdHistory[i]||""); }
  };

  const clearLogs = async () => { await DB.setConsoleLogs([]); setLogs([]); toast("Console cleared.", "var(--dim)", "🗑"); };

  return (
    <Panel title="SERVER CONSOLE" subtitle={isLive ? "BRIDGE LIVE · REAL EXECUTION" : "BRIDGE OFFLINE · READ ONLY"} color="var(--green)" onClose={onClose} wide>
      <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
        <BridgeBadge bridge={bridge} isLive={isLive} loading={bridgeLoading} />

        {loading
          ? <div style={{ height:340, display:"flex", alignItems:"center", justifyContent:"center" }}><div className="mono" style={{ color:"var(--dim)" }}>LOADING...</div></div>
          : logs.length === 0
            ? <div className="console-wrap" style={{ height:340, display:"flex", alignItems:"center", justifyContent:"center" }}>
                <div style={{ textAlign:"center" }}>
                  <div className="mono" style={{ color:"rgba(0,245,255,.2)", fontSize:11 }}>No console logs yet.</div>
                  <div className="mono" style={{ color:"rgba(0,245,255,.12)", fontSize:9, marginTop:6 }}>Logs appear here once the bridge daemon is running.</div>
                </div>
              </div>
            : <ConsoleFeed logs={logs} />
        }

        <div className="console-input-wrap" style={{ marginTop:8 }} onClick={() => inputRef.current?.focus()}>
          <span className="console-prefix">{">"}</span>
          <input ref={inputRef} className="console-input" value={input}
            onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder={!user?.isAdmin ? "Admin only" : isLive ? "Type server command..." : "Bridge offline — command will be queued"}
            disabled={!user?.isAdmin || sending}
            autoComplete="off" spellCheck="false" />
          <button onClick={sendCommand} disabled={!user?.isAdmin || !input.trim() || sending}
            style={{ background:isLive?"rgba(57,255,20,.15)":"rgba(251,191,36,.1)", border:`1px solid ${isLive?"rgba(57,255,20,.4)":"rgba(251,191,36,.3)"}`, borderRadius:5, color:isLive?"var(--green)":"var(--amber)", cursor:"pointer", padding:"5px 14px", fontFamily:"Orbitron", fontSize:8, letterSpacing:1, transition:"all .2s", flexShrink:0 }}>
            {sending ? "..." : isLive ? "SEND" : "QUEUE"}
          </button>
        </div>
        {!user?.isAdmin && <div className="mono" style={{ fontSize:9, color:"rgba(255,165,0,.6)", textAlign:"center", marginTop:8 }}>Admin login required to send commands.</div>}

        <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap", alignItems:"center" }}>
          {user?.isAdmin && <button onClick={clearLogs} className="neon-btn" style={{ fontSize:8, padding:"6px 14px", borderColor:"var(--red)", color:"var(--red)" }}>🗑 CLEAR</button>}
          <div className="mono" style={{ fontSize:9, color:"var(--dim)" }}>{logs.length} entries · ↑↓ history · Enter to send</div>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  JAR CONTROL PANEL — Real start/stop when bridge live
// ═══════════════════════════════════════════════════════════════════════════════
const JAR_OPTIONS = [
  { id:"paper",   label:"Paper",   icon:"📄", desc:"High-performance Spigot fork. Recommended.", compat:"1.8–1.20.4" },
  { id:"spigot",  label:"Spigot",  icon:"🧲", desc:"Plugin-compatible Bukkit fork. Stable.",       compat:"1.8–1.20.4" },
  { id:"vanilla", label:"Vanilla", icon:"🌿", desc:"Official Mojang server. No plugins.",          compat:"Any"        },
  { id:"fabric",  label:"Fabric",  icon:"🧵", desc:"Lightweight mod loader.",                      compat:"1.14+"      },
  { id:"forge",   label:"Forge",   icon:"🔩", desc:"Full modpack support. High RAM usage.",        compat:"1.1–1.20.1" },
  { id:"purpur",  label:"Purpur",  icon:"🟣", desc:"Paper fork with extra config options.",        compat:"1.16+"      },
];
const VERSION_OPTIONS = ["1.20.4","1.20.1","1.19.4","1.18.2","1.17.1","1.16.5","1.12.2","1.8.9"];
const STATE_META = {
  stopped:  { label:"STOPPED",  color:"var(--red)",    icon:"⬛", glow:false },
  starting: { label:"STARTING", color:"var(--amber)",  icon:"🟡", glow:false },
  running:  { label:"RUNNING",  color:"var(--green)",  icon:"🟢", glow:true  },
  stopping: { label:"STOPPING", color:"var(--orange)", icon:"🟠", glow:false },
};

function JarControlPanel({ onClose, user }) {
  const toast = useToast();
  const { bridge, isLive, loading: bridgeLoading } = useBridgeStatus();
  const [config, setConfig] = useState(SERVER_CONFIG_DEFAULT);
  const [saving, setSaving] = useState(false);

  // ── Live Builds state (JAR Automated Control) ────────────────────────────
  const [liveBuilds,    setLiveBuilds]    = useState(null);
  const [buildsLoading, setBuildsLoading] = useState(false);
  const [buildsError,   setBuildsError]   = useState(null);
  const [selProvider,   setSelProvider]   = useState("Paper");
  const [selVersion,    setSelVersion]    = useState(null);
  const [selBuild,      setSelBuild]      = useState(null);
  const [applying,      setApplying]      = useState(false);

  // serverState: from bridge if live, else from Firestore config
  const serverState = isLive ? (bridge.serverState || "stopped") : (config.serverState || "stopped");
  const sm = STATE_META[serverState] || STATE_META.stopped;

  useEffect(() => {
    DB.getServerConfig().then(c => setConfig(c));
  }, []);

  // Fetch live builds when bridge comes online
  useEffect(() => {
    if (isLive) fetchLiveBuilds();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  const fetchLiveBuilds = async () => {
    const srv = await DB.getServer();
    const url = srv?.bridgeUrl;
    if (!url) return;
    setBuildsLoading(true);
    setBuildsError(null);
    try {
      const res = await fetch(`${url}/jar/versions`, {
        headers: { "X-API-Key": srv.bridgeApiKey || process.env.REACT_APP_BRIDGE_KEY || "" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLiveBuilds(data.versions || null);
      const builds = (data.versions || {})[selProvider] || [];
      if (builds.length) { setSelVersion(builds[0].version); setSelBuild(builds[0].build); }
    } catch (e) {
      setBuildsError(e.message);
    } finally {
      setBuildsLoading(false);
    }
  };

  const applyJar = async () => {
    if (!user?.isAdmin || !isLive || applying || !selVersion || !selBuild) return;
    const srv = await DB.getServer();
    const url = srv?.bridgeUrl;
    if (!url) { toast("No Bridge URL configured.", "var(--red)", "⚠"); return; }
    setApplying(true);
    try {
      const res = await fetch(`${url}/jar/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": srv.bridgeApiKey || "",
          "X-Is-Admin": "true",
        },
        body: JSON.stringify({ provider: selProvider, version: selVersion, build: selBuild }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Unknown error");
      toast(`Switching to ${selProvider} ${selVersion} #${selBuild} — server restarting…`, "var(--cyan)", "🔩");
      await DB.pushConsoleLog({ type:"system", message:`[JAR] Applied ${selProvider} ${selVersion} build ${selBuild} by ${user.username}`, source:"bridge" });
    } catch (e) {
      toast("Apply failed: " + e.message, "var(--red)", "⚠");
    } finally {
      setApplying(false);
    }
  };

  const onProviderChange = (prov) => {
    setSelProvider(prov);
    const builds = (liveBuilds || {})[prov] || [];
    if (builds.length) { setSelVersion(builds[0].version); setSelBuild(builds[0].build); }
    else { setSelVersion(null); setSelBuild(null); }
  };

  const providerBuilds = (liveBuilds || {})[selProvider] || [];

  const saveConfig = async (patch) => {
    const updated = { ...config, ...patch };
    setConfig(updated);
    setSaving(true);
    await DB.setServerConfig(updated);
    setSaving(false);
  };

  const doAction = async (action) => {
    if (!user?.isAdmin) return;
    if (!isLive) { toast("Bridge offline — cannot send server commands.", "var(--red)", "⚠"); return; }
    const srv = await DB.getServer();
    const url = srv?.bridgeUrl;
    if (!url) { toast("No Bridge URL set. Admin → Server → Edit.", "var(--red)", "⚠"); return; }
    try {
      setSaving(true);
      const res = await fetch(`${url}/server/${action}`, { method:"POST", headers:{"Content-Type":"application/json"}, signal:AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(await res.text());
      toast(`Bridge: ${action.toUpperCase()} sent.`, "var(--green)", "✅");
      await DB.pushConsoleLog({ type:"system", message:`[JAR Control] /${action} sent by ${user.username}`, source:"bridge" });
      // Optimistic state update — bridge heartbeat will confirm
      await saveConfig({ serverState: action==="start"?"starting": action==="stop"?"stopping":"starting", lastStarted: action!=="stop"?new Date().toISOString():config.lastStarted, lastStopped: action==="stop"?new Date().toISOString():config.lastStopped });
    } catch(e) {
      toast("Bridge error: "+e.message, "var(--red)", "⚠");
    } finally {
      setSaving(false);
    }
  };

  const selectedJar = JAR_OPTIONS.find(j => j.id === config.jarType) || JAR_OPTIONS[0];

  return (
    <Panel title="JAR CONTROL" subtitle={isLive ? "BRIDGE LIVE · REAL CONTROL" : "BRIDGE OFFLINE · CONFIG ONLY"} color="var(--orange)" onClose={onClose} wide>
      <div style={{ maxHeight:"72vh", overflowY:"auto" }}>
        <BridgeBadge bridge={bridge} isLive={isLive} loading={bridgeLoading} />

        {/* ── Live Builds / Apply JAR ──────────────────────────────────────── */}
        {user?.isAdmin && (
          <div style={{ marginBottom:18, padding:"14px 16px", background:"rgba(0,5,15,.7)", border:"1px solid rgba(0,245,255,.15)", borderRadius:10 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
              <div className="orb" style={{ fontSize:8, color:"var(--cyan)", letterSpacing:2 }}>🔩 LIVE BUILDS — APPLY JAR</div>
              <button onClick={fetchLiveBuilds} disabled={buildsLoading||!isLive}
                style={{ fontSize:9, padding:"4px 10px", background:"rgba(0,245,255,.08)", border:"1px solid rgba(0,245,255,.25)", borderRadius:5, color:isLive?"var(--cyan)":"rgba(0,245,255,.3)", cursor:(buildsLoading||!isLive)?"not-allowed":"pointer", letterSpacing:1, fontFamily:"monospace" }}>
                {buildsLoading ? "⟳ LOADING…" : isLive ? "↻ REFRESH" : "BRIDGE OFFLINE"}
              </button>
            </div>

            {buildsError && (
              <div className="mono" style={{ fontSize:9, color:"var(--red)", marginBottom:10, padding:"6px 10px", background:"rgba(255,68,68,.06)", border:"1px solid rgba(255,68,68,.2)", borderRadius:6 }}>
                ⚠ {buildsError}
              </div>
            )}

            {isLive && !liveBuilds && !buildsLoading && !buildsError && (
              <div className="mono" style={{ fontSize:9, color:"var(--dim)", textAlign:"center", padding:"12px 0" }}>Fetching live builds…</div>
            )}

            {!isLive && (
              <div className="mono" style={{ fontSize:9, color:"var(--amber)", textAlign:"center", padding:"12px 0" }}>Bridge must be online to apply JAR.</div>
            )}

            {isLive && liveBuilds && (<>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:8, marginBottom:14 }}>
                {["Paper","Purpur","Vanilla","Fabric","Spigot"].map(prov => {
                  const builds = (liveBuilds||{})[prov]||[];
                  const isSel  = selProvider===prov;
                  const icons  = { Paper:"📄", Purpur:"🟣", Vanilla:"🌿", Fabric:"🧵", Spigot:"🧲" };
                  return (
                    <div key={prov} className={`jar-card${isSel?" selected":""}`}
                      onClick={() => builds.length && onProviderChange(prov)}
                      style={{ opacity:builds.length?1:0.4, cursor:builds.length?"pointer":"not-allowed" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:16 }}>{icons[prov]}</span>
                        <div className="orb" style={{ fontSize:9, color:isSel?"var(--cyan)":"var(--text)", letterSpacing:1 }}>{prov}</div>
                        {isSel && <span style={{ marginLeft:"auto", color:"var(--cyan)", fontSize:12 }}>✓</span>}
                      </div>
                      <div className="mono" style={{ fontSize:8, color:"var(--dim)" }}>
                        {builds.length?`${builds.length} stable · latest ${builds[0].version}`:"No builds found"}
                      </div>
                      {prov==="Spigot" && <div className="mono" style={{ fontSize:7, color:"var(--amber)", marginTop:4 }}>⚠ No official API</div>}
                    </div>
                  );
                })}
              </div>

              {selProvider !== "Spigot" ? (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:10, alignItems:"flex-end", flexWrap:"wrap" }}>
                  <div>
                    <label className="si-label">VERSION</label>
                    <select className="si" value={selVersion||""} onChange={e => {
                      setSelVersion(e.target.value);
                      const b = providerBuilds.filter(x => x.version===e.target.value);
                      if (b.length) setSelBuild(b[0].build);
                    }}>
                      {[...new Set(providerBuilds.map(b => b.version))].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="si-label">BUILD</label>
                    <select className="si" value={selBuild||""} onChange={e => setSelBuild(e.target.value)}>
                      {providerBuilds.filter(b => b.version===selVersion).map(b => (
                        <option key={b.build} value={b.build}>#{b.build}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={applyJar} disabled={!selVersion||!selBuild||applying} className="srv-ctrl-btn"
                    style={{ padding:"10px 20px",
                      background:applying?"rgba(0,245,255,.03)":"rgba(0,245,255,.12)",
                      border:`1px solid ${applying?"rgba(0,245,255,.1)":"rgba(0,245,255,.4)"}`,
                      color:applying?"rgba(0,245,255,.3)":"var(--cyan)",
                      cursor:applying?"not-allowed":"pointer",
                      minWidth:120, whiteSpace:"nowrap" }}>
                    {applying ? "⟳ SWITCHING…" : "⚡ APPLY JAR"}
                  </button>
                </div>
              ) : (
                <div className="mono" style={{ fontSize:9, color:"var(--amber)", padding:"8px 12px", background:"rgba(251,191,36,.05)", border:"1px solid rgba(251,191,36,.18)", borderRadius:6 }}>
                  ⚠ Spigot has no official download API. Compile the JAR with BuildTools on your VPS and place it in /minecraft/jars/.
                </div>
              )}
            </>)}
          </div>
        )}

        {/* State + controls */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12, marginBottom:18, padding:"12px 16px", background:"rgba(0,5,15,.7)", border:`1px solid ${sm.color}44`, borderRadius:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ position:"relative", width:48, height:48, borderRadius:"50%", border:`2px solid ${sm.color}`, display:"flex", alignItems:"center", justifyContent:"center", background:`${sm.color}12` }}>
              <span style={{ fontSize:20 }}>{sm.icon}</span>
              {sm.glow && <div style={{ position:"absolute", inset:-4, borderRadius:"50%", border:`1px solid ${sm.color}`, animation:"pingPulse 2s ease-out infinite", opacity:0 }}/>}
            </div>
            <div>
              <div className="orb" style={{ fontSize:14, color:sm.color, letterSpacing:3 }}>{sm.label}</div>
              <div className="mono" style={{ fontSize:9, color:"var(--dim)", marginTop:2 }}>
                {selectedJar.icon} {selectedJar.label} · v{isLive?(bridge.jarVersion||config.jarVersion):config.jarVersion}
                {isLive && bridge.tps && <span style={{ color:"var(--green)", marginLeft:8 }}>· {bridge.tps} TPS</span>}
              </div>
            </div>
          </div>
          {user?.isAdmin ? (
            <div style={{ display:"flex", gap:8 }}>
              {[
                { action:"start",   label:"▶ START",    active:serverState==="stopped", color:"var(--green)", bg:"rgba(57,255,20,.15)", bc:"rgba(57,255,20,.5)" },
                { action:"stop",    label:"⬛ STOP",    active:serverState==="running", color:"var(--red)",   bg:"rgba(255,68,68,.15)",  bc:"rgba(255,68,68,.5)" },
                { action:"restart", label:"🔄 RESTART", active:serverState==="running", color:"var(--cyan)",  bg:"rgba(0,245,255,.1)",   bc:"rgba(0,245,255,.35)" },
              ].map(b => (
                <button key={b.action} onClick={() => doAction(b.action)} disabled={!isLive||!b.active||saving}
                  className="srv-ctrl-btn"
                  style={{ padding:"10px 18px",
                    background: (!isLive||!b.active) ? "rgba(255,255,255,.03)" : b.bg,
                    border: `1px solid ${(!isLive||!b.active)?"rgba(255,255,255,.1)":b.bc}`,
                    color: (!isLive||!b.active) ? "rgba(255,255,255,.2)" : b.color,
                    cursor: (!isLive||!b.active) ? "not-allowed" : "pointer",
                  }}>
                  {b.label}
                </button>
              ))}
            </div>
          ) : <div className="mono" style={{ fontSize:8, color:"var(--dim)" }}>ADMIN ONLY</div>}
        </div>

        {!isLive && user?.isAdmin && (
          <div className="mono" style={{ fontSize:9, color:"var(--amber)", marginBottom:14, padding:"8px 12px", background:"rgba(251,191,36,.05)", border:"1px solid rgba(251,191,36,.18)", borderRadius:6 }}>
            ⚠ Bridge offline — start/stop disabled. Config changes will apply when the bridge reconnects.
          </div>
        )}

        {/* JAR selector + config — always editable */}
        {user?.isAdmin && (<>
          <div className="orb" style={{ fontSize:8, color:"var(--orange)", letterSpacing:2, marginBottom:10 }}>⚙️ SERVER SOFTWARE</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:8, marginBottom:16 }}>
            {JAR_OPTIONS.map(j => (
              <div key={j.id} className={`jar-card${config.jarType===j.id?" selected":""}`} onClick={() => saveConfig({ jarType:j.id })}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <span style={{ fontSize:18 }}>{j.icon}</span>
                  <div>
                    <div className="orb" style={{ fontSize:10, color:config.jarType===j.id?"var(--cyan)":"var(--text)", letterSpacing:1 }}>{j.label}</div>
                    <div className="mono" style={{ fontSize:7, color:"var(--dim)" }}>{j.compat}</div>
                  </div>
                  {config.jarType===j.id && <span style={{ marginLeft:"auto", color:"var(--cyan)", fontSize:14 }}>✓</span>}
                </div>
                <div className="mono" style={{ fontSize:9, color:"var(--dim)", lineHeight:1.6 }}>{j.desc}</div>
              </div>
            ))}
          </div>

          <div className="orb" style={{ fontSize:8, color:"var(--orange)", letterSpacing:2, marginBottom:10 }}>🔧 CONFIG</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <label className="si-label">JAR VERSION</label>
              <select className="si" value={config.jarVersion} onChange={e => saveConfig({ jarVersion:e.target.value })}>
                {VERSION_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="si-label">PORT</label>
              <input className="si" value={config.port} onChange={e => saveConfig({ port:e.target.value })} placeholder="25565"/>
            </div>
            <div style={{ gridColumn:"1/-1" }}>
              <label className="si-label">JVM FLAGS</label>
              <input className="si" value={config.customFlags} onChange={e => saveConfig({ customFlags:e.target.value })} placeholder="-Xms2G -Xmx4G"/>
            </div>
          </div>
        </>)}

        {!user?.isAdmin && (
          <div style={{ textAlign:"center", padding:"40px 0" }}>
            <div style={{ fontSize:32, marginBottom:12 }}>🔩</div>
            <div className="mono" style={{ fontSize:11, color:"var(--dim)" }}>JAR configuration is restricted to administrators.</div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIVE SESSION PANEL — Real player list from bridge, empty when offline
// ═══════════════════════════════════════════════════════════════════════════════
function LiveSessionPanel({ onClose, user }) {
  const { bridge, isLive, loading: bridgeLoading } = useBridgeStatus();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState("all");

  const load = useCallback(async () => {
    const saved = await DB.getLiveSessions();
    setSessions(saved);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const relTime = (iso) => {
    if (!iso) return "";
    const m = Math.floor((Date.now()-new Date(iso).getTime())/60000);
    if (m<1) return "just now"; if (m<60) return `${m}m ago`;
    return `${Math.floor(m/60)}h ago`;
  };

  const onlineCount = sessions.filter(s => s.status==="online").length;
  const visible = filter==="all" ? sessions : sessions.filter(s => s.status===filter);

  return (
    <Panel title="LIVE SESSIONS" subtitle={isLive?`${onlineCount} ONLINE · BRIDGE LIVE`:"BRIDGE OFFLINE"} color="var(--green)" onClose={onClose}>
      <div style={{ maxHeight:"70vh", overflowY:"auto" }}>
        <BridgeBadge bridge={bridge} isLive={isLive} loading={bridgeLoading}/>

        {isLive && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ position:"relative", width:8, height:8 }}>
                <div style={{ position:"absolute", inset:0, borderRadius:"50%", background:onlineCount>0?"var(--green)":"var(--dim)" }}/>
                {onlineCount>0 && <div className="ping-ring" style={{ borderColor:"var(--green)" }}/>}
              </div>
              <span className="orb" style={{ fontSize:8, color:"var(--green)", letterSpacing:2 }}>{onlineCount} ONLINE · {sessions.length} TRACKED</span>
            </div>
            {bridge.tps && <span className="mono" style={{ fontSize:8, color:"var(--dim)" }}>TPS: {bridge.tps}</span>}
          </div>
        )}

        <div style={{ display:"flex", gap:6, marginBottom:12 }}>
          {["all","online","offline","afk"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ fontFamily:"Orbitron", fontSize:7, letterSpacing:1, padding:"4px 10px", borderRadius:4, cursor:"pointer",
                background:filter===f?"rgba(57,255,20,.15)":"transparent",
                border:`1px solid ${filter===f?"var(--green)":"rgba(57,255,20,.2)"}`,
                color:filter===f?"var(--green)":"var(--dim)", transition:"all .2s" }}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>

        {loading
          ? <div style={{ textAlign:"center", padding:"40px 0" }}><div className="mono" style={{ color:"var(--dim)" }}>LOADING...</div></div>
          : !isLive
            ? <div style={{ textAlign:"center", padding:"60px 0" }}>
                <div style={{ fontSize:36, marginBottom:12 }}>📡</div>
                <div className="orb" style={{ fontSize:10, color:"var(--dim)", letterSpacing:2, marginBottom:8 }}>BRIDGE OFFLINE</div>
                <div className="mono" style={{ fontSize:10, color:"rgba(0,245,255,.2)" }}>Live session data requires the Oracle bridge daemon.</div>
              </div>
            : visible.length===0
              ? <div style={{ textAlign:"center", padding:"36px 0" }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>👥</div>
                  <div className="mono" style={{ fontSize:11, color:"var(--dim)" }}>No players match this filter.</div>
                </div>
              : <div style={{ background:"rgba(0,5,15,.5)", border:"1px solid rgba(0,245,255,.1)", borderRadius:8, overflow:"hidden", marginBottom:12 }}>
                  {visible.map((s,i) => (
                    <div key={s.username} className="session-row" style={{ animationDelay:`${i*.04}s` }}>
                      <div className={`online-dot ${s.status}`}/>
                      <MCAvatar username={s.username} size={34}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="orb" style={{ fontSize:10, color:"var(--text)" }}>{s.username}</div>
                        <div className="mono" style={{ fontSize:8, color:"var(--dim)", marginTop:1 }}>
                          {s.status==="online"?"🟢 Online":s.status==="afk"?"🟡 AFK":"⚫ Offline"}
                          {s.world && <span style={{ marginLeft:8 }}>· {s.world}</span>}
                          {s.joinedAt && <span style={{ marginLeft:8 }}>· {relTime(s.joinedAt)}</span>}
                        </div>
                      </div>
                      {s.playtime && <div className="mono" style={{ fontSize:8, color:"var(--dim)", flexShrink:0 }}>{s.playtime}h</div>}
                    </div>
                  ))}
                </div>
        }
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMBAT FEED PANEL — Real events from bridge, empty when offline
// ═══════════════════════════════════════════════════════════════════════════════
const COMBAT_ICONS  = { kill:"⚔", death:"💀", pvp:"🗡", assist:"🤝" };
const COMBAT_COLORS = { kill:"var(--green)", death:"var(--red)", pvp:"var(--purple)", assist:"var(--amber)" };
const COMBAT_MSGS = {
  kill:   (a,t,w) => <><span style={{color:"var(--green)"}}>{a}</span> <span style={{color:"rgba(255,255,255,.5)"}}>eliminated</span> <span style={{color:"var(--red)"}}>{t}</span>{w&&<span style={{color:"var(--dim)"}}> with {w}</span>}</>,
  death:  (a,t,w) => <><span style={{color:"var(--red)"}}>{a}</span> <span style={{color:"rgba(255,255,255,.5)"}}>was slain by</span> <span style={{color:"var(--amber)"}}>{t}</span>{w&&<span style={{color:"var(--dim)"}}> using {w}</span>}</>,
  pvp:    (a,t,w) => <><span style={{color:"var(--purple)"}}>{a}</span> <span style={{color:"rgba(255,255,255,.5)"}}>defeated</span> <span style={{color:"var(--cyan)"}}>{t}</span>{w&&<span style={{color:"var(--dim)"}}> [{w}]</span>}</>,
  assist: (a,t)   => <><span style={{color:"var(--amber)"}}>{a}</span> <span style={{color:"rgba(255,255,255,.5)"}}>assisted killing</span> <span style={{color:"var(--dim)"}}>{t}</span></>,
};

function CombatFeedPanel({ onClose, user }) {
  const { bridge, isLive, loading: bridgeLoading } = useBridgeStatus();
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("all");

  const load = useCallback(async () => {
    const saved = await DB.getCombatEvents();
    setEvents(saved);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const relTime = (iso) => {
    if (!iso) return "";
    const m = Math.floor((Date.now()-new Date(iso).getTime())/60000);
    if (m<1) return "just now"; if (m<60) return `${m}m ago`;
    return `${Math.floor(m/60)}h ago`;
  };

  const visible = filter==="all" ? events : events.filter(e => e.type===filter);

  return (
    <Panel title="COMBAT FEED" subtitle={isLive?"BRIDGE LIVE · REAL EVENTS":"BRIDGE OFFLINE"} color="var(--red)" onClose={onClose} wide>
      <div style={{ maxHeight:"72vh", overflowY:"auto" }}>
        <BridgeBadge bridge={bridge} isLive={isLive} loading={bridgeLoading}/>

        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:16 }}>
          {[
            { label:"KILLS",   value:events.filter(e=>e.type==="kill").length,   color:"var(--green)"  },
            { label:"DEATHS",  value:events.filter(e=>e.type==="death").length,  color:"var(--red)"    },
            { label:"PVP",     value:events.filter(e=>e.type==="pvp").length,    color:"var(--purple)" },
            { label:"ASSISTS", value:events.filter(e=>e.type==="assist").length, color:"var(--amber)"  },
          ].map(s => (
            <div key={s.label} style={{ background:`${s.color}0a`, border:`1px solid ${s.color}22`, borderRadius:8, padding:"10px 12px", textAlign:"center" }}>
              <div className="orb" style={{ fontSize:18, color:s.color, marginBottom:2 }}>{s.value}</div>
              <div className="mono" style={{ fontSize:7, color:"var(--dim)", letterSpacing:1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", gap:6, flex:1 }}>
            {["all","kill","death","pvp","assist"].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{ fontFamily:"Orbitron", fontSize:7, letterSpacing:1, padding:"4px 10px", borderRadius:4, cursor:"pointer",
                  background:filter===f?`${COMBAT_COLORS[f]||"var(--cyan)"}22`:"transparent",
                  border:`1px solid ${filter===f?(COMBAT_COLORS[f]||"var(--cyan)"):"rgba(255,68,68,.2)"}`,
                  color:filter===f?(COMBAT_COLORS[f]||"var(--cyan)"):"var(--dim)", transition:"all .2s" }}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {loading
          ? <div style={{ textAlign:"center", padding:"40px 0" }}><div className="mono" style={{ color:"var(--dim)" }}>LOADING...</div></div>
          : !isLive
            ? <div style={{ textAlign:"center", padding:"60px 0" }}>
                <div style={{ fontSize:36, marginBottom:12 }}>⚔️</div>
                <div className="orb" style={{ fontSize:10, color:"var(--dim)", letterSpacing:2, marginBottom:8 }}>BRIDGE OFFLINE</div>
                <div className="mono" style={{ fontSize:10, color:"rgba(255,68,68,.2)" }}>Combat events require the Oracle bridge daemon with the NexSci plugin installed.</div>
              </div>
            : visible.length===0
              ? <div style={{ textAlign:"center", padding:"36px 0" }}>
                  <div style={{ fontSize:32, marginBottom:10 }}>⚔️</div>
                  <div className="mono" style={{ fontSize:11, color:"var(--dim)" }}>No combat events yet.</div>
                </div>
              : <div style={{ marginBottom:14 }}>
                  {visible.map((e,i) => (
                    <div key={e.id||i} className={`combat-entry combat-${e.type||"kill"}`} style={{ animationDelay:`${i*.03}s` }}>
                      <span style={{ fontSize:16, flexShrink:0 }}>{COMBAT_ICONS[e.type]||"⚔"}</span>
                      <div className="mono" style={{ fontSize:10, flex:1, lineHeight:1.6 }}>
                        {COMBAT_MSGS[e.type] ? COMBAT_MSGS[e.type](e.actor,e.target,e.weapon) : <span style={{color:"var(--dim)"}}>{e.actor} → {e.target}</span>}
                      </div>
                      <div className="mono" style={{ fontSize:7, color:"var(--dim)", flexShrink:0 }}>{relTime(e.ts)}</div>
                    </div>
                  ))}
                </div>
        }

        {/* Admin clear */}
        {user?.isAdmin && events.length > 0 && (
          <button className="neon-btn" onClick={async()=>{await DB.setCombatEvents([]);setEvents([]);}}
            style={{ fontSize:8, padding:"6px 14px", borderColor:"var(--dim)", color:"var(--dim)", marginTop:8 }}>
            🗑 CLEAR LOG
          </button>
        )}
      </div>
    </Panel>
  );
}


const PM={server:ServerPanel,players:PlayersPanel,leaderboard:LeaderboardPanel,wars:WarsPanel,seasons:SeasonsPanel,rules:RulesPanel,diag:DiagPanel,admin:AdminPanel,changelog:ChangelogPanel,events:EventsPanel,polls:PollsPanel,trades:TradeBoardPanel,achievements:AchievementsPanel,settings:SettingsPanel,chat:ChatPanel,seasonpass:SeasonPassPanel,cosmetics:CosmeticsPanel,gallery:GalleryPanel,suggestions:SuggestionBoxPanel,potw:POTWPanel,alliances:AlliancePanel,bulletin:BulletinPanel,banlog:BanLogPanel,modreview:ModReviewPanel,console:ConsolePanel,jarcontrol:JarControlPanel,livesessions:LiveSessionPanel,combatfeed:CombatFeedPanel};

function AppInner(){
  const[booting,setBooting]=useState(true);
  const[screen,setScreen]=useState("intro");
  const[openPanel,setOpenPanel]=useState(null);
  const[statusPanel,setStatusPanel]=useState(false);
  const[loginPanel,setLoginPanel]=useState(false);
  const[accountPanel,setAccountPanel]=useState(false);
  const[musicOpen,setMusicOpen]=useState(false);
  const[user,setUser]=useState(null);
  const[serverStatus,setServerStatus]=useState("offline");
  const[ready,setReady]=useState(false);
  const prevSrvStatus=useRef(null);
  const toast=useToast();
  const play=useSound();
  const{settings}=useSettings();

  useEffect(()=>{
    const init=async()=>{
      requestBrowserNotifPerm();
      const session=await DB.getSession();
      if(session)setUser(session);
      const srv=await DB.getServer();
      setServerStatus(srv.status);prevSrvStatus.current=srv.status;setReady(true);
    };
    init();
    const t=setInterval(async()=>{
      const s=await DB.getServer();
      if(s.status!==prevSrvStatus.current){
        prevSrvStatus.current=s.status;setServerStatus(s.status);
        if(s.status==="online"){fireBrowserNotif("🟢 NexSci SMP Online!","Server is now online!");toast("Server is now ONLINE! Go play!","var(--green)","🟢");play("success");}
        else{toast("Server went OFFLINE.","var(--red)","🔴");play("error");}
      }else setServerStatus(s.status);
    },7000);
    return()=>clearInterval(t);
  },[]);

  const handleLogin=u=>{setUser(u);setLoginPanel(false);play("success");};
  const handleLogout=async()=>{await DB.setSession(null);setUser(null);toast("Logged out.","var(--dim)","👋");play("close");};
  const openPanelFn=id=>{
    if(id==="admin"&&!user?.isAdmin)return;
    play("open");setOpenPanel(id);
  };
  const closePanel=()=>{play("close");setOpenPanel(null);};
  const ActivePanel=openPanel?PM[openPanel]:null;

  // Topbar top offset: 44px topbar + 20px ticker if visible = 64px, else 44px
  const topOffset=settings.tickerVisible?"64px":"44px";

  return(
    <>
      <style>{STYLE}</style>
      {booting&&<BootScreen onDone={()=>setBooting(false)}/>}
      {!booting&&(
        <>
          <div className="scanline" style={settings.reducedMotion?{display:"none"}:{}}/>
          <Starfield/>
          <TopBar user={user} serverStatus={serverStatus} onLogout={handleLogout} onSetStatus={()=>{user&&setStatusPanel(true);play("click");}} onOpenLogin={()=>{setLoginPanel(true);play("click");}} onOpenAccount={()=>{user&&setAccountPanel(true);play("click");}} musicOpen={musicOpen} setMusicOpen={v=>{setMusicOpen(v);play("click");}} settings={settings}/>
          <NotifTicker/>
          {musicOpen&&<MusicPlayer onClose={()=>{setMusicOpen(false);play("close");}}/>}
          <div style={{paddingTop:topOffset}}>
            {screen==="intro"&&ready&&<IntroScreen onEnter={()=>{setScreen("hub");play("success");}}/>}
            {screen==="hub"&&<CommandHub onOpen={openPanelFn} user={user}/>}
          </div>
          {ActivePanel&&<ActivePanel onClose={closePanel} user={user} currentUser={user} onLogin={handleLogin}/>}
          {statusPanel&&user&&<MyStatusPanel user={user} onClose={()=>{setStatusPanel(false);play("close");}}/>}
          {loginPanel&&!user&&<LoginPanel onClose={()=>{setLoginPanel(false);play("close");}} onLogin={handleLogin}/>}
          {accountPanel&&user&&<AccountPanel user={user} onClose={()=>{setAccountPanel(false);play("close");}} onLogin={setUser} onLogout={handleLogout}/>}
        </>
      )}
    </>
  );
}

export default function App(){
  return <ToastProvider><SettingsProvider><AppInner/></SettingsProvider></ToastProvider>;
}
