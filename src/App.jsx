import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
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
.pmodal{width:min(94vw,880px);max-height:92vh;overflow-y:auto;animation:panelIn .38s cubic-bezier(.22,1,.36,1);position:relative;}
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
  .pmodal,.pmodal-wide{width:99vw;max-height:96vh;padding:16px!important;}
  .hub-grid{grid-template-columns:1fr 1fr!important;}
  .survey-grid{grid-template-columns:1fr!important;}
  .player-grid{grid-template-columns:1fr!important;}
  .admin-tabs{flex-wrap:wrap!important;}
  .srv-grid{flex-direction:column!important;}
  .war-header{flex-direction:column!important;align-items:flex-start!important;}
  .topbar-right{gap:6px!important;}
  .topbar-center{display:none!important;}
}
@media(max-width:420px){
  .hub-grid{grid-template-columns:1fr!important;}
  .neon-btn{padding:10px 18px!important;font-size:9px!important;}
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const ADMIN_CREDS = { username:"AdminOP", password:"Nether#2024" };

const SERVER_DEFAULT = {
  ip:"play.yourserver.net", port:"25565", version:"1.20.4",
  status:"offline", motd:"NexSci SMP Neural Command Server",
  atLink:"https://aternos.org/", lastChanged:null, changedBy:null,
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
  {icon:"🎮",label:"Version Mismatch",s:"warn",tip:"Server runs 1.20.4. Downgrade via launcher profile settings."},
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

// ═══════════════════════════════════════════════════════════════════════════════
//  MC PING
// ═══════════════════════════════════════════════════════════════════════════════
async function pingMinecraft(ip,port="25565"){
  try{
    const res=await fetch(`https://api.mcsrvstat.us/3/${ip}:${port}`,{signal:AbortSignal.timeout(8000)});
    if(!res.ok)throw new Error();
    const d=await res.json();
    return{reachable:true,online:d.online===true,players:d.players?.online??0,maxPlayers:d.players?.max??20,motd:(d.motd?.clean?.[0]||"").trim(),version:d.version||""};
  }catch{return{reachable:false,online:false,players:0,maxPlayers:20,motd:"",version:""};}
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
  useEffect(()=>{
    const load=async()=>{
      const ns=await DB.getNotifs();
      if(ns.length>prevCount.current&&prevCount.current>0){setRinging(true);setTimeout(()=>setRinging(false),700);}
      prevCount.current=ns.length;setNotifs(ns);setUnread(ns.filter(n=>!n.read).length);
    };
    load();const t=setInterval(load,8000);return()=>clearInterval(t);
  },[]);
  const markRead=async()=>{const ns=notifs.map(n=>({...n,read:true}));setNotifs(ns);setUnread(0);await DB.set("smp:notifs",ns,true);};
  const NC={server:"#39ff14",war:"#ff4444",survey:"#3b82f6",admin:"#f97316",system:"#00f5ff",access:"#b44dff",leaderboard:"#fbbf24"};
  return(
    <div style={{position:"relative"}}>
      <button className={`bell-btn${ringing?" bell-ringing":""}`} onClick={()=>{setOpen(o=>!o);if(unread>0)markRead();}}>
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
                <div className="notif-item" key={n.id} style={{opacity:n.read?.6:1}}>
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
  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 16px",background:"rgba(1,8,18,.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(0,245,255,.1)",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap"}}>
        <span className="orb" style={{fontSize:9,color:"var(--cyan)",letterSpacing:3}}>NEXSCI SMP</span>
        <span className="topbar-center" style={{color:"rgba(0,245,255,.2)"}}>│</span>
        <span className="topbar-center mono" style={{fontSize:9,color:"var(--dim)"}}>NEURAL COMMAND v3.0</span>
        <span style={{color:"rgba(0,245,255,.2)"}}>│</span>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <div style={{position:"relative",width:8,height:8}}>
            <div style={{position:"absolute",inset:0,borderRadius:"50%",background:serverStatus==="online"?"var(--green)":"var(--red)",zIndex:1}}/>
            {serverStatus==="online"&&<div className="ping-ring"/>}
          </div>
          <span className="mono" style={{fontSize:9,color:serverStatus==="online"?"var(--green)":"var(--red)",letterSpacing:1}}>{serverStatus==="online"?"ONLINE":"OFFLINE"}</span>
        </div>
        {/* LOGIN / ACCOUNT BUTTON */}
        {user?(
          <button onClick={onOpenAccount} className="topbar-login-btn" style={{display:"flex",alignItems:"center",gap:5}}>
            <MCAvatar username={user.username} size={18} style={{borderRadius:4,border:"none"}}/>
            <span style={{color:user.isAdmin?"var(--orange)":"var(--cyan)"}}>{user.username}{user.isAdmin?" ★":""}</span>
          </button>
        ):(
          <button onClick={onOpenLogin} className="topbar-login-btn">⟩ LOGIN / SIGN IN</button>
        )}
        {/* MUSIC */}
        <button className="topbar-music-btn" onClick={()=>setMusicOpen(o=>!o)} title="Music Player" style={{borderColor:musicOpen?"var(--purple)":"rgba(180,77,255,.25)"}}>🎵</button>
      </div>
      <div className="topbar-right" style={{display:"flex",alignItems:"center",gap:10}}>
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════
function Panel({title,subtitle,color="#00f5ff",children,onClose,wide}){
  useEffect(()=>{const h=e=>e.key==="Escape"&&onClose();window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);},[onClose]);
  return(
    <div className="overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className={`glass pmodal${wide?" pmodal-wide":""}`} style={{padding:24,position:"relative"}}>
        <button className="close-btn" onClick={onClose}>✕</button>
        <div style={{marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
            <div style={{width:3,height:18,background:color,boxShadow:`0 0 8px ${color}`,borderRadius:2}}/>
            <span className="orb" style={{fontSize:11,color,letterSpacing:3}}>{title}</span>
          </div>
          {subtitle&&<div className="mono" style={{fontSize:9,color:"var(--dim)",letterSpacing:2,marginLeft:13}}>{subtitle}</div>}
        </div>
        <div style={{height:1,background:`linear-gradient(to right,${color},${color}44,transparent)`,marginBottom:18}}/>
        {children}
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
        PLAYER STATUS · WAR LOGS · SEASON ARCHIVES · LIVE SERVER PING · MUSIC
      </p>}
      {step>=3&&<div style={{animation:"fadeUp .8s ease both",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
        <button className="neon-btn" onClick={onEnter} style={{fontSize:11,letterSpacing:4,padding:"14px 48px",animation:"borderGlow 3s ease-in-out infinite"}}>⟩ ENTER SYSTEM ⟨</button>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND HUB — no Survey card
// ═══════════════════════════════════════════════════════════════════════════════
const MODS=[
  {id:"server",   icon:"🖥",  label:"SERVER STATUS",   sub:"Live ping + Aternos",   color:"#39ff14"},
  {id:"players",  icon:"👤",  label:"PLAYER SYSTEMS",  sub:"Live status + skins",   color:"#00f5ff"},
  {id:"leaderboard",icon:"🏆",label:"LEADERBOARD",     sub:"Player stats + ranks",  color:"#fbbf24"},
  {id:"wars",     icon:"⚔️",  label:"WAR LOGS",        sub:"Conflict history",      color:"#ff4444"},
  {id:"seasons",  icon:"🗓",  label:"SEASON ARCHIVES", sub:"SMP history",           color:"#b44dff"},
  {id:"rules",    icon:"📜",  label:"PROTOCOL RULES",  sub:"Server regulations",    color:"#fbbf24"},
  {id:"diag",     icon:"🧪",  label:"DIAGNOSTICS",     sub:"Troubleshoot issues",   color:"#3b82f6"},
  {id:"admin",    icon:"🛠",  label:"ADMIN CONTROLS",  sub:"Restricted access",     color:"#f97316",adminOnly:true},
];
function CommandHub({onOpen,user}){
  const mods=MODS.filter(m=>!m.adminOnly||(user&&user.isAdmin));
  return(
    <div style={{position:"fixed",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",padding:"74px 16px 16px",overflowY:"auto"}}>
      <div style={{textAlign:"center",marginBottom:24,animation:"hubIn .8s ease both"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:5}}>
          <div style={{width:32,height:1,background:"linear-gradient(to right,transparent,#00f5ff)"}}/>
          <span className="mono" style={{fontSize:8,color:"rgba(0,245,255,.5)",letterSpacing:3}}>COMMAND HUB · v3.0</span>
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
              <div style={{fontSize:24,marginBottom:9}}>{m.icon}</div>
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
  {title:"PLAY STYLE",fields:["play","style","pvp","hours"]},
  {title:"TECHNICAL",fields:["version","client","mods","specs"]},
  {title:"SOCIAL",fields:["voice","time","tz","lag","notes"]},
];

function SurveyFlow({username,onComplete}){
  const[step,setStep]=useState(0);
  const[form,setForm]=useState({});
  const sf=(k,v)=>setForm(f=>({...f,[k]:v}));

  const canNext=()=>{
    if(step===0)return form.play&&form.style&&form.pvp&&form.hours;
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
            <RadioGrp label="Playstyle" opts={["Builder","Warrior","Explorer","Trader","Engineer"]} value={form.style} onChange={v=>sf("style",v)}/>
            <RadioGrp label="PvP Interest" opts={["Love it","Neutral","Avoid it"]} value={form.pvp} onChange={v=>sf("pvp",v)}/>
            <RadioGrp label="Daily Playtime" opts={["<1hr","1-3hr","3-6hr","6hr+"]} value={form.hours} onChange={v=>sf("hours",v)}/>
          </div>
        )}
        {step===1&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}} className="survey-grid">
            <div style={{marginBottom:14}}><label className="si-label">Minecraft Version</label><select className="si" value={form.version||""} onChange={e=>sf("version",e.target.value)}><option value="">— Select —</option>{["1.20.4","1.20.1","1.19.4","Bedrock","Other"].map(v=><option key={v}>{v}</option>)}</select></div>
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
    const newUser={...pendingUser,createdAt:new Date().toISOString(),surveyDone:true};
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

  useEffect(()=>{
    if(!user.isAdmin){
      DB.getUsers().then(us=>{const f=us.find(u2=>u2.username===user.username);if(f)setNewStatus(f.displayStatus||"");});
      DB.getUserPfp(user.username).then(p=>{if(p)setPfpPreview(p);});
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
    const updated=users.map(u=>u.username===user.username?{...u,username:newUsername,displayStatus:newStatus}:u);
    await DB.setUsers(updated);
    if(pfpFile){
      toast("Uploading profile picture...","var(--cyan)","\u2b06");
      const ok=await DB.setUserPfp(user.username,pfpFile);
      if(!ok)toast("PFP upload failed. Check connection.","var(--red)","\u26a0");
      else toast("Profile picture saved to cloud!","var(--green)","\U0001f5bc");
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

  return(
    <Panel title="ACCOUNT MANAGE" subtitle={`${user.username.toUpperCase()} · ${user.isAdmin?"ADMIN":"PLAYER"}`} color="var(--cyan)" onClose={onClose}>
      <div style={{display:"flex",gap:7,marginBottom:16,borderBottom:"1px solid rgba(0,245,255,.1)",paddingBottom:10}}>
        {["profile","password"].map(t=>(
          <button key={t} onClick={()=>{setTab(t);setErr("");}} style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:2,padding:"6px 12px",borderRadius:5,cursor:"pointer",background:tab===t?"rgba(0,245,255,.12)":"transparent",border:`1px solid ${tab===t?"var(--cyan)":"rgba(0,245,255,.15)"}`,color:tab===t?"var(--cyan)":"var(--dim)",transition:"all .2s"}}>
            {t.toUpperCase()}
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
//  SERVER PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function ServerPanel({onClose,user}){
  const toast=useToast();
  const[srv,setSrv]=useState(null);
  const[pingData,setPingData]=useState(null);
  const[pinging,setPinging]=useState(false);
  const[edit,setEdit]=useState({});
  const[editMode,setEditMode]=useState(false);
  const[saving,setSaving]=useState(false);
  const[loading,setLoading]=useState(true);
  const[accessMsg,setAccessMsg]=useState("");
  const[accessSent,setAccessSent]=useState(false);
  const lastPingStatus=useRef(null);

  useEffect(()=>{
    DB.getServer().then(s=>{setSrv(s);setEdit(s);setLoading(false);});
    const t=setInterval(()=>DB.getServer().then(setSrv),6000);return()=>clearInterval(t);
  },[]);

  const doPing=useCallback(async s=>{
    if(!s?.ip||s.ip==="play.yourserver.net"){setPingData({reachable:false,note:"Update server IP first"});return;}
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

  const toggleStatus=async()=>{
    if(!user?.isAdmin)return;
    const ns={...srv,status:srv.status==="online"?"offline":"online",lastChanged:new Date().toISOString(),changedBy:user.username};
    setSaving(true);await DB.setServer(ns);setSrv(ns);
    if(ns.status==="online"){fireBrowserNotif("🟢 Server Online!","Admin started the server!");await DB.pushNotif({type:"server",title:"SERVER STARTED",body:`${user.username} started the server.`});}
    toast(`Server marked ${ns.status.toUpperCase()}`,ns.status==="online"?"var(--green)":"var(--red)",ns.status==="online"?"▶":"⬛");
    setSaving(false);
  };

  const saveEdit=async()=>{
    setSaving(true);await DB.setServer({...edit,lastChanged:new Date().toISOString(),changedBy:user.username});
    setSrv({...edit});setEditMode(false);setSaving(false);toast("Server info updated.","var(--green)","✅");
  };

  const requestAccess=async()=>{
    if(!user)return;
    await DB.pushAccessReq({username:user.username,message:accessMsg.trim()||"No message.",type:"aternos"});
    await DB.pushNotif({type:"access",title:"ATERNOS ACCESS REQUEST",body:`${user.username} is requesting Aternos access: "${accessMsg||"No message."}"`});
    toast("Access request sent to Admin!","var(--purple)","📨");setAccessSent(true);
  };

  if(loading)return <Panel title="SERVER STATUS" subtitle="FETCHING..." color="var(--green)" onClose={onClose}><div style={{textAlign:"center",padding:"50px 0"}}><div className="mono" style={{color:"var(--dim)"}}>CONNECTING...</div></div></Panel>;
  const isOnline=srv?.status==="online";

  return(
    <Panel title="SERVER STATUS" subtitle="LIVE PING · ATERNOS CONTROL" color="var(--green)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>
        {/* PING BANNER */}
        <div style={{background:"rgba(57,255,20,.05)",border:"1px solid rgba(57,255,20,.2)",borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{position:"relative",width:10,height:10}}>
              <div style={{position:"absolute",inset:0,borderRadius:"50%",background:pingData?.online?"var(--green)":pingData?.reachable===false?"var(--red)":"var(--amber)"}}/>
              {pingData?.online&&<div className="ping-ring" style={{borderColor:"var(--green)"}}/>}
            </div>
            <div>
              <div className="orb" style={{fontSize:9,color:"var(--green)",letterSpacing:2}}>LIVE SERVER PING</div>
              <div className="mono" style={{fontSize:10,color:"var(--dim)",marginTop:2}}>
                {pinging?"Pinging...":pingData?.reachable===false?`Unreachable${pingData.note?` — ${pingData.note}`:""}`:pingData?.online?`Online · ${pingData.players}/${pingData.maxPlayers} players`:"Server offline"}
              </div>
              {pingData?.version&&<div className="mono" style={{fontSize:9,color:"rgba(57,255,20,.5)"}}>v{pingData.version}</div>}
            </div>
          </div>
          <button className="neon-btn" onClick={()=>doPing(srv)} disabled={pinging} style={{fontSize:8,padding:"7px 16px",borderColor:"var(--green)",color:"var(--green)"}}>
            {pinging?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>:"⟳ PING"}
          </button>
        </div>

        {/* STATUS ORB + INFO */}
        <div className="srv-grid" style={{display:"flex",gap:16,marginBottom:18,flexWrap:"wrap"}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,flexShrink:0}}>
            <div style={{width:120,height:120,borderRadius:"50%",border:`3px solid ${isOnline?"var(--green)":"var(--red)"}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`radial-gradient(circle,${isOnline?"rgba(57,255,20,.12)":"rgba(255,68,68,.08)"} 0%,transparent 70%)`}}>
              <div style={{fontSize:28}}>{isOnline?"🟢":"🔴"}</div>
              <div className="orb" style={{fontSize:8,color:isOnline?"var(--green)":"var(--red)",letterSpacing:2,marginTop:4}}>{isOnline?"ONLINE":"OFFLINE"}</div>
            </div>
            {user?.isAdmin
              ?<button className="neon-btn" onClick={toggleStatus} disabled={saving} style={{fontSize:8,padding:"8px 16px",borderColor:isOnline?"var(--red)":"var(--green)",color:isOnline?"var(--red)":"var(--green)",width:120}}>{saving?"...":(isOnline?"⬛ STOP":"▶ START")}</button>
              :<div className="mono" style={{fontSize:8,color:"var(--dim)",textAlign:"center"}}>ADMIN ONLY</div>
            }
          </div>
          <div style={{flex:1,minWidth:180}}>
            {editMode&&user?.isAdmin?(
              <div style={{display:"grid",gap:9}}>
                {[["ip","SERVER IP"],["port","PORT"],["version","VERSION"],["motd","MOTD"],["atLink","ATERNOS URL"],["maxPlayers","MAX PLAYERS"],["discordLink","DISCORD LINK"],["dynmapLink","DYNMAP LINK"],["schedule","PLAY SCHEDULE"]].map(([k,l])=>(
                  <div key={k}><label className="si-label">{l}</label><input className="si" value={edit[k]||""} onChange={e=>setEdit(v=>({...v,[k]:e.target.value}))}/></div>
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
                  {[["📍 IP",srv?.ip],["🔌 PORT",srv?.port],["🎮 VERSION",pingData?.version||srv?.version],["💬 MOTD",pingData?.motd||srv?.motd],["👥 PLAYERS",pingData?.online?`${pingData.players}/${pingData.maxPlayers} (live)`:`0/${srv?.maxPlayers||20}`],["⏰ SCHEDULE",srv?.schedule],["⏱ CHANGED",srv?.lastChanged?new Date(srv.lastChanged).toLocaleString():"—"]].map(([l,v])=>(
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
                    :<button className="neon-btn" disabled title="Admin → Server → Edit → set Discord Link" style={{fontSize:8,padding:"7px 14px",borderColor:"#5865F2",color:"#5865F2",opacity:.3}}>💬 DISCORD</button>
                  }
                  {srv?.dynmapLink
                    ?<a href={srv.dynmapLink} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}><button className="neon-btn" style={{fontSize:8,padding:"7px 14px",borderColor:"var(--blue)",color:"var(--blue)"}}>🗺 LIVE MAP</button></a>
                    :<button className="neon-btn" disabled title="Dynmap = live web map of Minecraft world. Admin → Server → Edit → set Dynmap Link" style={{fontSize:8,padding:"7px 14px",borderColor:"var(--blue)",color:"var(--blue)",opacity:.3}}>🗺 LIVE MAP</button>
                  }
                </div>
              </div>
            )}
          </div>
        </div>

        {/* JOIN STEPS */}
        <div style={{background:"rgba(57,255,20,.04)",border:"1px solid rgba(57,255,20,.14)",borderRadius:8,padding:"12px 16px",marginBottom:12}}>
          <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:3,marginBottom:8}}>▶ HOW TO JOIN</div>
          {[`1. Open Minecraft Java Edition → Multiplayer`,`2. Add Server — IP: ${srv?.ip||"..."} (Port: ${srv?.port||"25565"})`,`3. Version: ${srv?.version||"1.20.4"}`,`4. ${isOnline?"Server is ONLINE — click Join Server!":"Server is OFFLINE — check Discord for updates."}`].map((s,i)=>(
            <div key={i} className="mono" style={{fontSize:11,color:i===3?(isOnline?"var(--green)":"var(--red)"):"var(--dim)",lineHeight:1.7}}>{s}</div>
          ))}
        </div>

        {/* ACCESS REQUEST */}
        {user&&!user.isAdmin&&(
          <div style={{background:"rgba(180,77,255,.05)",border:"1px solid rgba(180,77,255,.2)",borderRadius:8,padding:"14px 16px",marginBottom:12}}>
            <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:3,marginBottom:8}}>🔐 REQUEST ATERNOS ACCESS</div>
            {accessSent
              ?<div className="mono" style={{fontSize:11,color:"var(--green)"}}>✅ Request sent! AdminOP will review soon.</div>
              :<div style={{display:"flex",gap:8}}>
                <input className="si" placeholder="Why do you need access? (optional)" value={accessMsg} onChange={e=>setAccessMsg(e.target.value)} style={{flex:1}}/>
                <button className="neon-btn" onClick={requestAccess} style={{fontSize:8,padding:"9px 14px",borderColor:"var(--purple)",color:"var(--purple)",flexShrink:0}}>REQUEST →</button>
              </div>
            }
          </div>
        )}
        {!user&&<div style={{background:"rgba(180,77,255,.04)",border:"1px dashed rgba(180,77,255,.2)",borderRadius:8,padding:"10px 14px",marginBottom:12}}><div className="mono" style={{fontSize:10,color:"rgba(180,77,255,.6)"}}>🔐 Log in to request Aternos access.</div></div>}

        {/* ATERNOS */}
        <div style={{background:"rgba(15,15,15,.7)",border:"1px solid #2a2a2a",borderRadius:8,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span className="orb" style={{fontSize:12,color:"#ddd",letterSpacing:2,fontWeight:700}}>ATERNOS</span>
              <span className="orb" style={{fontSize:7,padding:"2px 8px",borderRadius:3,background:"rgba(100,100,100,.3)",border:"1px solid #444",color:"#aaa",letterSpacing:2}}>FREE HOSTING</span>
            </div>
            <div className="mono" style={{fontSize:10,color:"#555"}}>Start/stop from Aternos dashboard. Toggle status above to update for all players.</div>
          </div>
          <a href={srv?.atLink||"https://aternos.org"} target="_blank" rel="noopener noreferrer" style={{textDecoration:"none"}}>
            <button className="neon-btn" style={{fontSize:8,padding:"9px 18px",borderColor:"#555",color:"#bbb"}}>OPEN ATERNOS →</button>
          </a>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYERS — all registered users shown here
// ═══════════════════════════════════════════════════════════════════════════════
function PlayersPanel({onClose}){
  const[statuses,setStatuses]=useState({});
  const[users,setUsers]=useState([]);
  const[loading,setLoading]=useState(true);

  useEffect(()=>{
    const load=async()=>{
      const[us,st]=await Promise.all([DB.getUsers(),DB.getPlayerStatus()]);
      setUsers(us);setStatuses(st);setLoading(false);
    };
    load();const t=setInterval(async()=>{const[us,st]=await Promise.all([DB.getUsers(),DB.getPlayerStatus()]);setUsers(us);setStatuses(st);},6000);
    return()=>clearInterval(t);
  },[]);

  // Include admin as a player too
  const allPlayers=[
    {username:"AdminOP",role:"Admin",isAdmin:true},
    ...users.map(u=>({username:u.username,role:u.role||"Player",isAdmin:false}))
  ];

  const onlineCount=allPlayers.filter(p=>{const s=statuses[p.username];return s?.status==="online"||s?.status==="busy";}).length;

  return(
    <Panel title="PLAYER SYSTEMS" subtitle={`LIVE STATUS · ${onlineCount} ACTIVE · ${allPlayers.length} TOTAL`} color="var(--cyan)" onClose={onClose} wide>
      <div style={{marginBottom:12,padding:"8px 12px",background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.1)",borderRadius:6}}>
        <div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.6}}>💡 All registered players appear here. Set your status via <span style={{color:"var(--cyan)"}}>📊 STATUS</span> in the top bar. Auto-refreshes every 6s.</div>
      </div>
      {loading
        ?<div style={{textAlign:"center",padding:"40px 0"}}><div className="mono" style={{color:"var(--dim)"}}>LOADING...</div></div>
        :allPlayers.length<=1
          ?<div style={{textAlign:"center",padding:"50px 0"}}>
            <div style={{fontSize:32,marginBottom:10}}>👾</div>
            <div className="mono" style={{fontSize:11,color:"var(--dim)"}}>NO PLAYERS REGISTERED YET.<br/>Sign up to appear here!</div>
          </div>
          :<div className="player-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:12,maxHeight:"62vh",overflowY:"auto"}}>
            {allPlayers.map(p=>{
              const st=statuses[p.username]||{status:"offline",activity:"Status not set"};
              return(
                <div className="pcard" key={p.username}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                    <div style={{position:"relative",flexShrink:0}}>
                      <MCAvatar username={p.username} size={42} style={{border:`2px solid ${SC[st.status]||"#555"}44`}}/>
                      <div style={{position:"absolute",bottom:-2,right:-2,width:10,height:10,borderRadius:"50%",background:SC[st.status]||"#555",border:"2px solid #010812",boxShadow:`0 0 6px ${SC[st.status]||"#555"}`,animation:st.status!=="offline"?"pulseDot 2s ease-in-out infinite":"none"}}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div className="orb" style={{fontSize:10,color:"#fff",letterSpacing:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.username}</div>
                        {p.isAdmin&&<span style={{fontSize:7,color:"var(--orange)",fontFamily:"Orbitron"}}>★</span>}
                      </div>
                      <span className="mono" style={{fontSize:9,color:SC[st.status]||"#555",letterSpacing:1}}>{STATUS_EMOJI[st.status]||"⚫"} {SL[st.status]||"OFFLINE"}</span>
                      <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{p.role}</div>
                    </div>
                  </div>
                  <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.5,borderTop:"1px solid rgba(0,245,255,.07)",paddingTop:8}}>
                    <span style={{color:"rgba(0,245,255,.4)"}}>DOING › </span>{st.activity||"Status not set"}
                  </div>
                  {st.updatedAt&&<div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:4}}>Updated {new Date(st.updatedAt).toLocaleTimeString()}</div>}
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
//  DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════════
const DC2={ok:"var(--green)",warn:"var(--amber)",error:"var(--red)"};
const DI2={ok:"✅",warn:"⚠️",error:"❌"};
function DiagPanel({onClose,user}){
  const toast=useToast();
  const errC=DIAG_DEFAULT.filter(d=>d.s==="error").length;
  const warnC=DIAG_DEFAULT.filter(d=>d.s==="warn").length;
  const requestHelp=async label=>{
    await DB.pushNotif({type:"admin",title:"HELP REQUEST — DIAGNOSTICS",body:`${user?.username||"A user"} needs help with: "${label}".`});
    toast("Help request sent to AdminOP!","var(--blue)","🆘");
  };
  return(
    <Panel title="DIAGNOSTICS" subtitle={`${DIAG_DEFAULT.length} CHECKS · ${errC} ERROR · ${warnC} WARN`} color="var(--blue)" onClose={onClose} wide>
      <div style={{maxHeight:"66vh",overflowY:"auto"}}>
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
            <button onClick={()=>requestHelp(item.label)}
              style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.25)",borderRadius:5,color:"var(--blue)",cursor:"pointer",padding:"5px 9px",fontFamily:"Orbitron",fontSize:7,letterSpacing:1,flexShrink:0,transition:"all .2s"}}
              onMouseOver={e=>{e.currentTarget.style.background="rgba(59,130,246,.2)";}}
              onMouseOut={e=>{e.currentTarget.style.background="rgba(59,130,246,.08)";}}>
              🆘 HELP
            </button>
          </div>
        ))}
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

  const TABS=[{id:"users",l:"USERS"},{id:"wl",l:"WHITELIST"},{id:"war",l:"WARS"},{id:"rules",l:"RULES"},{id:"seasons",l:"SEASONS"},{id:"music",l:"MUSIC"},{id:"leaderboard",l:"LEADERBOARD"},{id:"access",l:"ACCESS REQS"},{id:"surveys",l:"SURVEYS"},{id:"broadcast",l:"BROADCAST"}];

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
                style={{opacity:newTrack._file?.4:1}}/>
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
          <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:2,marginBottom:12}}>ATERNOS ACCESS REQUESTS · {accessReqs.filter(r=>r.status==="pending").length} PENDING</div>
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

// ═══════════════════════════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════════════════════════
const PM={server:ServerPanel,players:PlayersPanel,leaderboard:LeaderboardPanel,wars:WarsPanel,seasons:SeasonsPanel,rules:RulesPanel,diag:DiagPanel,admin:AdminPanel};

function AppInner(){
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
        if(s.status==="online"){fireBrowserNotif("🟢 NexSci SMP Online!","Server is now online!");toast("Server is now ONLINE! Go play!","var(--green)","🟢");}
        else toast("Server went OFFLINE.","var(--red)","🔴");
      }else setServerStatus(s.status);
    },7000);
    return()=>clearInterval(t);
  },[]);

  const handleLogin=u=>{setUser(u);setLoginPanel(false);};
  const handleLogout=async()=>{await DB.setSession(null);setUser(null);toast("Logged out.","var(--dim)","👋");};
  const openPanelFn=id=>{if(id==="admin"&&!user?.isAdmin)return;setOpenPanel(id);};
  const ActivePanel=openPanel?PM[openPanel]:null;

  return(
    <>
      <style>{STYLE}</style>
      <div className="scanline"/>
      <Starfield/>
      <TopBar user={user} serverStatus={serverStatus} onLogout={handleLogout} onSetStatus={()=>user&&setStatusPanel(true)} onOpenLogin={()=>setLoginPanel(true)} onOpenAccount={()=>user&&setAccountPanel(true)} musicOpen={musicOpen} setMusicOpen={setMusicOpen}/>
      {musicOpen&&<MusicPlayer onClose={()=>setMusicOpen(false)}/>}
      {screen==="intro"&&ready&&<IntroScreen onEnter={()=>setScreen("hub")}/>}
      {screen==="hub"&&<CommandHub onOpen={openPanelFn} user={user}/>}
      {ActivePanel&&<ActivePanel onClose={()=>setOpenPanel(null)} user={user} currentUser={user} onLogin={handleLogin}/>}
      {statusPanel&&user&&<MyStatusPanel user={user} onClose={()=>setStatusPanel(false)}/>}
      {loginPanel&&!user&&<LoginPanel onClose={()=>setLoginPanel(false)} onLogin={handleLogin}/>}
      {accountPanel&&user&&<AccountPanel user={user} onClose={()=>setAccountPanel(false)} onLogin={setUser} onLogout={handleLogout}/>}
    </>
  );
}

export default function App(){
  return <ToastProvider><AppInner/></ToastProvider>;
}
