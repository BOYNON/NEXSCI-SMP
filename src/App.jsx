import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

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

/* ANIMATIONS */
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
@keyframes srvOnPulse{0%,100%{box-shadow:0 0 20px rgba(57,255,20,.3)}50%{box-shadow:0 0 60px rgba(57,255,20,.7)}}
@keyframes srvOffPulse{0%,100%{box-shadow:0 0 16px rgba(255,68,68,.2)}50%{box-shadow:0 0 36px rgba(255,68,68,.4)}}
@keyframes toastIn{from{opacity:0;transform:translateX(120%)}to{opacity:1;transform:translateX(0)}}
@keyframes toastOut{from{opacity:1;transform:translateX(0)}to{opacity:0;transform:translateX(120%)}}
@keyframes pingPulse{0%{transform:scale(1);opacity:1}100%{transform:scale(2.5);opacity:0}}
@keyframes bellRing{0%,100%{transform:rotate(0)}20%{transform:rotate(-15deg)}40%{transform:rotate(15deg)}60%{transform:rotate(-10deg)}80%{transform:rotate(10deg)}}
@keyframes notifDrop{from{opacity:0;transform:translateY(-10px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

/* LAYOUT */
.scanline{position:fixed;left:0;width:100%;height:2px;background:linear-gradient(transparent,rgba(0,245,255,.04),transparent);animation:scan 6s linear infinite;pointer-events:none;z-index:9999;}
.stars-wrap{animation:starDrift 90s linear infinite;}
.glass{background:var(--glass);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--glass-b);border-radius:12px;}

/* BUTTONS */
.neon-btn{position:relative;background:transparent;border:1px solid var(--cyan);color:var(--cyan);font-family:'Orbitron',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;padding:11px 26px;cursor:pointer;transition:all .3s;overflow:hidden;border-radius:4px;}
.neon-btn::before{content:'';position:absolute;inset:0;background:var(--cyan);transform:scaleX(0);transform-origin:left;transition:transform .3s;z-index:-1;}
.neon-btn:hover::before{transform:scaleX(1);}
.neon-btn:hover{color:#010812;box-shadow:0 0 28px var(--cyan);}
.neon-btn:disabled{opacity:.38;cursor:not-allowed;}
.neon-btn:disabled:hover::before{transform:scaleX(0);}
.neon-btn:disabled:hover{color:var(--cyan);box-shadow:none;}

/* MODULE CARDS */
.mcard{position:relative;background:rgba(0,15,30,.74);border:1px solid rgba(0,245,255,.13);border-radius:10px;padding:20px 16px;cursor:pointer;transition:all .34s;overflow:hidden;backdrop-filter:blur(10px);}
.mcard::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(0,245,255,.06) 0%,transparent 60%);opacity:0;transition:opacity .34s;}
.mcard:hover{border-color:var(--cyan);box-shadow:0 0 18px rgba(0,245,255,.2),0 0 50px rgba(0,245,255,.05),inset 0 0 18px rgba(0,245,255,.04);transform:translateY(-4px) scale(1.02);}
.mcard:hover::before{opacity:1;}
.mc-tl{position:absolute;top:8px;right:8px;width:7px;height:7px;border-top:2px solid var(--cyan);border-right:2px solid var(--cyan);opacity:.28;transition:opacity .3s;}
.mc-bl{position:absolute;bottom:8px;left:8px;width:7px;height:7px;border-bottom:2px solid var(--cyan);border-left:2px solid var(--cyan);opacity:.14;transition:opacity .3s;}
.mcard:hover .mc-tl{opacity:1;}.mcard:hover .mc-bl{opacity:.8;}

/* PANELS */
.overlay{position:fixed;inset:0;background:rgba(0,5,15,.9);backdrop-filter:blur(7px);z-index:100;display:flex;align-items:center;justify-content:center;animation:backdropIn .28s ease;padding:12px;}
.pmodal{width:min(94vw,880px);max-height:92vh;overflow-y:auto;animation:panelIn .38s cubic-bezier(.22,1,.36,1);position:relative;}
.pmodal-wide{width:min(98vw,1080px);}

/* INPUTS */
.si{background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.2);border-radius:6px;color:var(--text);font-family:'Share Tech Mono',monospace;font-size:13px;padding:10px 14px;outline:none;transition:all .3s;width:100%;}
.si:focus{border-color:var(--cyan);box-shadow:0 0 12px rgba(0,245,255,.15);background:rgba(0,245,255,.07);}
.si option{background:#010c1a;}
.si-label{font-family:'Orbitron',monospace;font-size:9px;letter-spacing:2px;color:var(--cyan-dim);text-transform:uppercase;margin-bottom:6px;display:block;}

/* CLOSE */
.close-btn{position:absolute;top:14px;right:14px;width:30px;height:30px;background:rgba(255,50,50,.1);border:1px solid rgba(255,50,50,.3);border-radius:6px;color:#ff5555;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:10;}
.close-btn:hover{background:rgba(255,50,50,.22);box-shadow:0 0 12px rgba(255,50,50,.3);}

/* STATUS ELEMENTS */
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

/* RADIO */
.sradio{display:flex;gap:7px;flex-wrap:wrap;}
.srlabel{display:flex;align-items:center;gap:6px;background:rgba(0,245,255,.04);border:1px solid rgba(0,245,255,.14);border-radius:5px;padding:6px 11px;cursor:pointer;font-size:11px;font-family:'Share Tech Mono',monospace;transition:all .2s;color:var(--dim);}
.srlabel:hover,.srlabel.act{border-color:var(--cyan);color:var(--cyan);background:rgba(0,245,255,.08);}
.srlabel input{display:none;}

/* AUTH TABS */
.auth-tab{background:transparent;border:none;border-bottom:2px solid transparent;padding:10px 20px;cursor:pointer;font-family:'Orbitron',monospace;font-size:10px;letter-spacing:2px;color:var(--dim);transition:all .3s;}
.auth-tab.act{border-bottom-color:var(--cyan);color:var(--cyan);}

/* TOAST */
.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:9998;display:flex;flex-direction:column;gap:8px;pointer-events:none;}
.toast{background:rgba(5,20,40,.95);border-radius:8px;padding:12px 16px;min-width:260px;max-width:340px;backdrop-filter:blur(20px);pointer-events:auto;animation:toastIn .35s cubic-bezier(.22,1,.36,1) both;}
.toast.out{animation:toastOut .3s ease both;}

/* NOTIFICATION BELL */
.bell-btn{position:relative;background:transparent;border:1px solid rgba(0,245,255,.18);border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;font-size:14px;}
.bell-btn:hover{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,245,255,.2);}
.bell-badge{position:absolute;top:-4px;right:-4px;width:14px;height:14px;background:var(--red);border-radius:50%;font-family:'Orbitron',monospace;font-size:8px;color:#fff;display:flex;align-items:center;justify-content:center;}
.bell-ringing{animation:bellRing .6s ease;}

/* PING DOT */
.ping-ring{position:absolute;width:100%;height:100%;border-radius:50%;border:2px solid var(--green);animation:pingPulse 2s ease-out infinite;opacity:0;}

/* NOTIF PANEL */
.notif-panel{position:fixed;top:52px;right:14px;width:min(90vw,340px);background:rgba(3,14,30,.97);border:1px solid rgba(0,245,255,.18);border-radius:10px;z-index:200;animation:notifDrop .28s ease both;backdrop-filter:blur(20px);}
.notif-item{padding:12px 14px;border-bottom:1px solid rgba(0,245,255,.07);transition:background .2s;}
.notif-item:hover{background:rgba(0,245,255,.04);}
.notif-item:last-child{border-bottom:none;}

/* PLAYER STATUS SELECTOR */
.stat-btn{background:transparent;border:1px solid;border-radius:5px;padding:6px 12px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:1px;transition:all .2s;}

/* AVATAR */
.mc-avatar{width:40px;height:40px;border-radius:6px;object-fit:cover;image-rendering:pixelated;}

/* PING INDICATOR */
.ping-status{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:5px;background:rgba(0,0,0,.3);border:1px solid rgba(0,245,255,.1);}

/* MOBILE RESPONSIVE */
@media(max-width:640px){
  .pmodal,.pmodal-wide{width:99vw;max-height:96vh;padding:16px!important;}
  .hub-grid{grid-template-columns:1fr 1fr!important;}
  .survey-grid{grid-template-columns:1fr!important;}
  .player-grid{grid-template-columns:1fr!important;}
  .admin-tabs{flex-wrap:wrap!important;}
  .srv-grid{flex-direction:column!important;}
  .war-header{flex-direction:column!important;align-items:flex-start!important;}
  .topbar-right{gap:8px!important;}
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
  status:"offline", motd:"SMP Neural Command Server",
  atLink:"https://aternos.org/", lastChanged:null, changedBy:null,
  playerCount:0, maxPlayers:20,
};

const PLAYERS_DEFAULT_LIST = [
  { name:"StarlordX",    role:"Admin",     defaultStatus:"online" },
  { name:"NightCrawler", role:"Builder",   defaultStatus:"afk" },
  { name:"VoidWalker99", role:"Architect", defaultStatus:"online" },
  { name:"RedstoneKing", role:"Engineer",  defaultStatus:"busy" },
  { name:"PhantomBlade", role:"Warrior",   defaultStatus:"offline" },
];
const SC={ online:"#39ff14", afk:"#fbbf24", busy:"#b44dff", offline:"#555" };
const SL={ online:"ONLINE", afk:"AFK", busy:"BUSY", offline:"OFFLINE" };

const STATUS_OPTIONS = ["online","afk","busy","offline"];
const STATUS_EMOJI   = { online:"🟢", afk:"🟡", busy:"🟣", offline:"⚫" };

const WAR_DEF = [
  { id:1, title:"Battle of Spawn Plains", teams:["Alpha Squad","Night Raiders"], outcome:"Alpha Squad Victory", date:"S1·W3", notes:"First major conflict. Alpha Squad overwhelmed with superior armor.", winner:0 },
  { id:2, title:"The Nether War",          teams:["Night Raiders","Lone Wolves"],  outcome:"Ceasefire — Draw",   date:"S1·W6", notes:"Ended on server crash. Diplomatic ceasefire declared.", winner:-1 },
];
const RULES=[
  { cat:"GAMEPLAY",     icon:"⚙️", items:["No duplication glitches or exploits.","Respect builds and claimed land.","No killing in safe zones."] },
  { cat:"PVP PROTOCOL", icon:"⚔️", items:["PvP must be declared 24h in advance.","No end-crystal abuse outside war zones.","War zones marked on dynmap."] },
  { cat:"GRIEFING",     icon:"🔥", items:["Zero tolerance for unconsented griefing.","Raiding only during declared wars.","Lava griefing = permanent ban."] },
  { cat:"ECONOMY",      icon:"💎", items:["Diamond is base currency.","No market manipulation.","Active shop listings must be stocked."] },
];
const DIAG=[
  { icon:"📡", label:"Connection Issues",  s:"ok",    tip:"Ensure stable WiFi. Use the server IP from Server Status panel." },
  { icon:"🎮", label:"Version Mismatch",   s:"warn",  tip:"Server runs 1.20.4. Downgrade via launcher profile settings." },
  { icon:"🧩", label:"Mod Conflicts",      s:"ok",    tip:"Optifine: disable Smooth World if experiencing chunk issues." },
  { icon:"⚙️", label:"FPS / Lag",          s:"ok",    tip:"Set render distance ≤12. Disable shaders during events." },
  { icon:"💥", label:"Client Crashes",     s:"error", tip:"Known crash with carpet mod v1.4.12. Update to v1.4.14." },
  { icon:"🔊", label:"Voice Chat",         s:"ok",    tip:"Simple Voice Chat mod required. See #voice-setup in Discord." },
];
const SEASONS=[
  { num:1, available:true, tagline:"The Beginning", achievements:["First mega-base built","Iron economy established","3 major wars concluded"], events:["Spawn Wars","The Great Fire","Peace Treaty Accord"], builds:["Crystal Palace","Nether Highway Network","Underground Mall"] },
  { num:2, available:false },{ num:3, available:false },
];

// ═══════════════════════════════════════════════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════════════════════════════════════════════
const DB = {
  async get(k,shared=false){ try{ const r=await window.storage.get(k,shared); return r?JSON.parse(r.value):null; }catch{ return null; }},
  async set(k,v,shared=false){ try{ await window.storage.set(k,JSON.stringify(v),shared); return true; }catch{ return false; }},
  async del(k,shared=false){ try{ await window.storage.delete(k,shared); }catch{} },
  async getUsers()       { return (await DB.get("smp:users",true))||[]; },
  async setUsers(v)      { return DB.set("smp:users",v,true); },
  async getSurveys()     { return (await DB.get("smp:surveys",true))||[]; },
  async setSurveys(v)    { return DB.set("smp:surveys",v,true); },
  async getServer()      { return (await DB.get("smp:server",true))||SERVER_DEFAULT; },
  async setServer(v)     { return DB.set("smp:server",v,true); },
  async getWhitelist()   { return (await DB.get("smp:wl",true))||["AdminOP"]; },
  async setWhitelist(v)  { return DB.set("smp:wl",v,true); },
  async getWars()        { return (await DB.get("smp:wars",true))||WAR_DEF; },
  async setWars(v)       { return DB.set("smp:wars",v,true); },
  async getPlayerStatus(){ return (await DB.get("smp:pstatus",true))||{}; },
  async setPlayerStatus(v){ return DB.set("smp:pstatus",v,true); },
  async getNotifs()      { return (await DB.get("smp:notifs",true))||[]; },
  async pushNotif(n)     {
    const ns = await DB.getNotifs();
    const updated = [{ ...n, id:Date.now(), ts:new Date().toISOString() }, ...ns].slice(0,40);
    return DB.set("smp:notifs", updated, true);
  },
  async getSession()     { return DB.get("smp:session"); },
  async setSession(v)    { if(v) return DB.set("smp:session",v); else return DB.del("smp:session"); },
  async resetUserPw(username, newPw) {
    const users = await DB.getUsers();
    const updated = users.map(u => u.username===username ? {...u,password:newPw,pwResetAt:new Date().toISOString()} : u);
    return DB.setUsers(updated);
  },
  async requestPwReset(username) {
    const users = await DB.getUsers();
    const updated = users.map(u => u.username===username ? {...u,resetRequested:true,resetRequestedAt:new Date().toISOString()} : u);
    return DB.setUsers(updated);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MINECRAFT SERVER PING  (api.mcsrvstat.us — public CORS-enabled API)
// ═══════════════════════════════════════════════════════════════════════════════
async function pingMinecraft(ip, port="25565") {
  try {
    const res = await fetch(`https://api.mcsrvstat.us/3/${ip}:${port}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("API error");
    const d = await res.json();
    return {
      reachable: true,
      online: d.online === true,
      players: d.players?.online ?? 0,
      maxPlayers: d.players?.max ?? 20,
      motd: (d.motd?.clean?.[0] || "").trim(),
      version: d.version || "",
      icon: d.icon || null,
    };
  } catch {
    return { reachable: false, online: false, players: 0, maxPlayers: 20, motd:"", version:"", icon:null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BROWSER NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
function requestBrowserNotifPerm() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}
function fireBrowserNotif(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon:"https://mc-heads.net/avatar/StarlordX/32" });
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TOAST CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════
const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, color="#00f5ff", icon="ℹ") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, color, icon, out:false }]);
    setTimeout(() => setToasts(t => t.map(x => x.id===id ? {...x,out:true} : x)), 3200);
    setTimeout(() => setToasts(t => t.filter(x => x.id!==id)), 3700);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast${t.out?" out":""}`} style={{ border:`1px solid ${t.color}44`, borderLeft:`3px solid ${t.color}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:16 }}>{t.icon}</span>
              <span className="mono" style={{ fontSize:12, color:"var(--text)", lineHeight:1.5 }}>{t.msg}</span>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => useContext(ToastCtx);

// ═══════════════════════════════════════════════════════════════════════════════
//  MINECRAFT AVATAR
// ═══════════════════════════════════════════════════════════════════════════════
function MCAvatar({ username, size=40, style:sx={} }) {
  const [err, setErr] = useState(false);
  const url = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/${size}`;
  if (err) return (
    <div style={{ width:size, height:size, borderRadius:6, background:`linear-gradient(135deg,rgba(0,245,255,.15),rgba(180,77,255,.1))`, border:"1px solid rgba(0,245,255,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.45, fontWeight:700, color:"rgba(0,245,255,.8)", ...sx }}>
      {username[0]?.toUpperCase()}
    </div>
  );
  return (
    <img
      className="mc-avatar"
      src={url}
      alt={username}
      width={size} height={size}
      style={{ width:size, height:size, borderRadius:6, imageRendering:"pixelated", border:"1px solid rgba(0,245,255,.2)", ...sx }}
      onError={() => setErr(true)}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATION BELL
// ═══════════════════════════════════════════════════════════════════════════════
function NotifBell() {
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const [ringing, setRinging] = useState(false);
  const prevCount = useRef(0);

  useEffect(() => {
    const load = async () => {
      const ns = await DB.getNotifs();
      if (ns.length > prevCount.current && prevCount.current > 0) {
        setRinging(true);
        setTimeout(() => setRinging(false), 700);
      }
      prevCount.current = ns.length;
      setNotifs(ns);
      setUnread(ns.filter(n => !n.read).length);
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const markRead = async () => {
    const ns = notifs.map(n => ({...n, read:true}));
    setNotifs(ns); setUnread(0);
    await DB.set("smp:notifs", ns, true);
  };

  const NOTIF_COLOR = { server:"#39ff14", war:"#ff4444", survey:"#3b82f6", admin:"#f97316", system:"#00f5ff" };

  return (
    <div style={{ position:"relative" }}>
      <button className={`bell-btn${ringing?" bell-ringing":""}`} onClick={() => { setOpen(o=>!o); if(unread>0) markRead(); }}>
        🔔
        {unread > 0 && <div className="bell-badge">{unread > 9 ? "9+" : unread}</div>}
      </button>
      {open && (
        <div className="notif-panel">
          <div style={{ padding:"12px 14px", borderBottom:"1px solid rgba(0,245,255,.1)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span className="orb" style={{ fontSize:9, color:"var(--cyan)", letterSpacing:2 }}>NOTIFICATIONS</span>
            <button onClick={() => setOpen(false)} style={{ background:"none", border:"none", color:"var(--dim)", cursor:"pointer", fontSize:14 }}>✕</button>
          </div>
          <div style={{ maxHeight:320, overflowY:"auto" }}>
            {notifs.length === 0
              ? <div className="mono" style={{ textAlign:"center", padding:"28px 0", fontSize:11, color:"var(--dim)" }}>No notifications yet</div>
              : notifs.map(n => (
                  <div className="notif-item" key={n.id} style={{ opacity: n.read ? 0.6 : 1 }}>
                    <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                      <div style={{ width:3, alignSelf:"stretch", background: NOTIF_COLOR[n.type]||"var(--cyan)", borderRadius:2, flexShrink:0 }} />
                      <div>
                        <div className="orb" style={{ fontSize:9, color: NOTIF_COLOR[n.type]||"var(--cyan)", letterSpacing:1, marginBottom:2 }}>{n.title}</div>
                        <div className="mono" style={{ fontSize:10, color:"var(--text)", lineHeight:1.5 }}>{n.body}</div>
                        <div className="mono" style={{ fontSize:8, color:"var(--dim)", marginTop:3 }}>{n.ts ? new Date(n.ts).toLocaleString() : ""}</div>
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
function Starfield() {
  const stars = useRef(Array.from({length:200},()=>({x:Math.random()*100,y:Math.random()*200,s:Math.random()*2.2+.3,o:Math.random()*.8+.1}))).current;
  const pts   = useRef(Array.from({length:12},(_,i)=>({x:Math.random()*100,y:Math.random()*100,sz:Math.random()*2.5+1,c:i%3===0?"#00f5ff":i%3===1?"#b44dff":"#3b82f6",d:Math.random()*6,dur:4+Math.random()*5}))).current;
  return (
    <div style={{position:"fixed",inset:0,overflow:"hidden",zIndex:0,pointerEvents:"none"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:`linear-gradient(rgba(0,245,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,245,255,.04) 1px,transparent 1px)`,backgroundSize:"60px 60px",animation:"gridPulse 5s ease-in-out infinite"}} />
      <div className="stars-wrap" style={{position:"absolute",width:"100%",height:"200%"}}>
        {stars.map((s,i)=><div key={i} style={{position:"absolute",left:`${s.x}%`,top:`${s.y}%`,width:s.s,height:s.s,borderRadius:"50%",background:"#fff",opacity:s.o,boxShadow:s.s>1.5?`0 0 ${s.s*3}px rgba(0,245,255,.5)`:"none"}} />)}
      </div>
      <div style={{position:"absolute",top:"-20%",left:"-10%",width:"50vw",height:"50vw",borderRadius:"50%",background:"radial-gradient(circle,rgba(0,245,255,.04) 0%,transparent 70%)"}} />
      <div style={{position:"absolute",bottom:"-10%",right:"-5%",width:"40vw",height:"40vw",borderRadius:"50%",background:"radial-gradient(circle,rgba(180,77,255,.05) 0%,transparent 70%)"}} />
      {pts.map((p,i)=><div key={i} style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,width:p.sz,height:p.sz,borderRadius:"50%",background:p.c,boxShadow:`0 0 8px ${p.c}`,animation:`particleFloat ${p.dur}s ease-in-out ${p.d}s infinite`}} />)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TOPBAR
// ═══════════════════════════════════════════════════════════════════════════════
function TopBar({ user, serverStatus, onLogout, onSetStatus }) {
  const [time, setTime] = useState(new Date());
  useEffect(()=>{ const t=setInterval(()=>setTime(new Date()),1000); return()=>clearInterval(t); },[]);
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 16px",background:"rgba(1,8,18,.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(0,245,255,.1)",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
        <span className="orb" style={{fontSize:9,color:"var(--cyan)",letterSpacing:3}}>SMP</span>
        <span className="topbar-center" style={{color:"rgba(0,245,255,.2)"}}>│</span>
        <span className="topbar-center mono" style={{fontSize:9,color:"var(--dim)"}}>NEURAL COMMAND v3.0</span>
        <span style={{color:"rgba(0,245,255,.2)"}}>│</span>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <div style={{position:"relative",width:8,height:8}}>
            <div style={{position:"absolute",inset:0,borderRadius:"50%",background:serverStatus==="online"?"var(--green)":"var(--red)",zIndex:1}} />
            {serverStatus==="online" && <div className="ping-ring" />}
          </div>
          <span className="mono" style={{fontSize:9,color:serverStatus==="online"?"var(--green)":"var(--red)",letterSpacing:1}}>{serverStatus==="online"?"ONLINE":"OFFLINE"}</span>
        </div>
      </div>
      <div className="topbar-right" style={{display:"flex",alignItems:"center",gap:10}}>
        {user && (
          <>
            <button onClick={onSetStatus} style={{background:"transparent",border:"1px solid rgba(0,245,255,.2)",borderRadius:5,padding:"4px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,transition:"all .2s"}}
              onMouseOver={e=>e.currentTarget.style.borderColor="var(--cyan)"} onMouseOut={e=>e.currentTarget.style.borderColor="rgba(0,245,255,.2)"}>
              <span style={{fontSize:11}}>📊</span>
              <span className="mono" style={{fontSize:9,color:"var(--cyan)",letterSpacing:1}}>STATUS</span>
            </button>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <MCAvatar username={user.username} size={22} />
              <span className="mono" style={{fontSize:10,color:user.isAdmin?"var(--orange)":"var(--cyan)"}}>{user.username}{user.isAdmin?" ★":""}</span>
            </div>
            <button onClick={onLogout} style={{fontFamily:"Orbitron",fontSize:7,letterSpacing:2,padding:"4px 9px",background:"transparent",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:3,cursor:"pointer"}}>OUT</button>
          </>
        )}
        <NotifBell />
        <span className="mono topbar-center" style={{fontSize:10,color:"rgba(0,245,255,.3)"}}>{time.toLocaleTimeString([],{hour12:false})}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════
function Panel({ title, subtitle, color="#00f5ff", children, onClose, wide }) {
  useEffect(()=>{ const h=(e)=>e.key==="Escape"&&onClose(); window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h); },[onClose]);
  return (
    <div className="overlay" onClick={(e)=>e.target===e.currentTarget&&onClose()}>
      <div className={`glass pmodal${wide?" pmodal-wide":""}`} style={{padding:24,position:"relative"}}>
        <button className="close-btn" onClick={onClose}>✕</button>
        <div style={{marginBottom:4}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3}}>
            <div style={{width:3,height:18,background:color,boxShadow:`0 0 8px ${color}`,borderRadius:2}} />
            <span className="orb" style={{fontSize:11,color,letterSpacing:3}}>{title}</span>
          </div>
          {subtitle&&<div className="mono" style={{fontSize:9,color:"var(--dim)",letterSpacing:2,marginLeft:13}}>{subtitle}</div>}
        </div>
        <div style={{height:1,background:`linear-gradient(to right,${color},${color}44,transparent)`,marginBottom:18}} />
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INTRO SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function IntroScreen({ onEnter }) {
  const [step,setStep]=useState(0);
  useEffect(()=>{ const ts=[setTimeout(()=>setStep(1),300),setTimeout(()=>setStep(2),900),setTimeout(()=>setStep(3),1600)]; return()=>ts.forEach(clearTimeout); },[]);
  return (
    <div style={{position:"fixed",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 20px"}}>
      <div style={{position:"absolute",width:480,height:480,pointerEvents:"none"}}>
        {[{i:0,c:"0,245,255",a:"ringR",d:20},{i:30,c:"180,77,255",a:"ringL",d:15,dash:true},{i:80,c:"0,245,255",a:"ringR",d:30}].map((r,k)=>(
          <div key={k} style={{position:"absolute",inset:r.i,borderRadius:"50%",border:`1px ${r.dash?"dashed":"solid"} rgba(${r.c},.08)`,animation:`${r.a} ${r.d}s linear infinite`}} />
        ))}
      </div>
      {step>=1&&<div style={{display:"flex",gap:5,marginBottom:24,animation:"fadeDown .8s ease both"}}>
        {["#5a3e28","#7a5c3a","#3a7a3a","#5a3e28"].map((c,i)=><div key={i} style={{width:11,height:11,background:c,boxShadow:"0 0 8px rgba(0,245,255,.3)",animation:`hexFloat ${2+i*.3}s ease-in-out ${i*.2}s infinite`}} />)}
      </div>}
      {step>=1&&<h1 style={{fontFamily:"Orbitron",fontWeight:900,fontSize:"clamp(24px,5.5vw,64px)",textAlign:"center",lineHeight:1.1,animation:"fadeUp 1s ease both",marginBottom:8}}>
        <span style={{color:"#fff"}}>SMP</span><br/>
        <span style={{background:"linear-gradient(90deg,#00f5ff,#b44dff)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"glowPulse 3s ease-in-out infinite"}}>NEURAL COMMAND</span><br/>
        <span style={{color:"#fff"}}>INTERFACE</span>
      </h1>}
      {step>=2&&<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,animation:"fadeUp .8s ease both"}}>
          <div style={{width:44,height:1,background:"linear-gradient(to right,transparent,#00f5ff)"}} /><span className="mono" style={{fontSize:8,color:"rgba(0,245,255,.5)",letterSpacing:4}}>CLASSIFIED · v3.0</span><div style={{width:44,height:1,background:"linear-gradient(to left,transparent,#00f5ff)"}} />
        </div>
        <p className="mono" style={{fontSize:"clamp(9px,1.5vw,12px)",color:"var(--dim)",letterSpacing:2,textAlign:"center",maxWidth:500,lineHeight:1.9,marginBottom:40,animation:"fadeUp .8s .2s ease both",animationFillMode:"both"}}>
          PLAYER STATUS · WAR LOGS · SEASON ARCHIVES · LIVE SERVER PING · SKIN AVATARS
        </p>
      </>}
      {step>=3&&<div style={{animation:"fadeUp .8s ease both",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
        <button className="neon-btn" onClick={onEnter} style={{fontSize:11,letterSpacing:4,padding:"14px 48px",animation:"borderGlow 3s ease-in-out infinite"}}>⟩ ENTER SYSTEM ⟨</button>
        <div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:"50%",background:"rgba(0,245,255,.4)",animation:`pulseDot 2s ease-in-out ${i*.4}s infinite`}} />)}</div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  COMMAND HUB
// ═══════════════════════════════════════════════════════════════════════════════
const MODS=[
  {id:"server",  icon:"🖥",  label:"SERVER STATUS",   sub:"Live ping + Aternos",      color:"#39ff14"},
  {id:"players", icon:"👤",  label:"PLAYER SYSTEMS",  sub:"Live status + skins",      color:"#00f5ff"},
  {id:"survey",  icon:"📡",  label:"SURVEY SCANNER",  sub:"Account + questionnaire",  color:"#3b82f6"},
  {id:"wars",    icon:"⚔️",  label:"WAR LOGS",        sub:"Conflict history",         color:"#ff4444"},
  {id:"seasons", icon:"🗓",  label:"SEASON ARCHIVES", sub:"SMP history",              color:"#b44dff"},
  {id:"rules",   icon:"📜",  label:"PROTOCOL RULES",  sub:"Server regulations",       color:"#fbbf24"},
  {id:"diag",    icon:"🧪",  label:"DIAGNOSTICS",     sub:"Troubleshoot issues",      color:"#3b82f6"},
  {id:"admin",   icon:"🛠",  label:"ADMIN CONTROLS",  sub:"Restricted access",        color:"#f97316",adminOnly:true},
];
function CommandHub({ onOpen, user }) {
  const mods=MODS.filter(m=>!m.adminOnly||(user&&user.isAdmin));
  return(
    <div style={{position:"fixed",inset:0,zIndex:10,display:"flex",flexDirection:"column",alignItems:"center",padding:"74px 16px 16px",overflowY:"auto"}}>
      <div style={{textAlign:"center",marginBottom:24,animation:"hubIn .8s ease both"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:5}}>
          <div style={{width:32,height:1,background:"linear-gradient(to right,transparent,#00f5ff)"}} />
          <span className="mono" style={{fontSize:8,color:"rgba(0,245,255,.5)",letterSpacing:3}}>COMMAND HUB · v3.0</span>
          <div style={{width:32,height:1,background:"linear-gradient(to left,transparent,#00f5ff)"}} />
        </div>
        <h2 className="orb" style={{fontSize:"clamp(13px,2.4vw,22px)",color:"#fff",letterSpacing:4,marginBottom:3}}>NEURAL CONTROL MATRIX</h2>
        <p className="mono" style={{fontSize:9,color:"var(--dim)",letterSpacing:2}}>{user?`AUTHENTICATED · ${user.username.toUpperCase()}`:"SIGN IN VIA SURVEY SCANNER FOR FULL ACCESS"}</p>
        {!user&&<p className="mono" style={{fontSize:8,color:"rgba(255,165,0,.5)",letterSpacing:2,marginTop:3}}>⚠ ADMIN CONTROLS HIDDEN UNTIL AUTHENTICATED</p>}
      </div>
      <div style={{width:"min(460px,80vw)",marginBottom:24,animation:"hubIn .8s .2s ease both",animationFillMode:"both"}}>
        <div style={{height:2,background:"rgba(255,255,255,.05)",borderRadius:2}}>
          <div style={{height:"100%",background:"linear-gradient(to right,var(--cyan),var(--purple))",borderRadius:2,animation:"loadBar 2s ease-in-out infinite alternate"}} />
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
              <div style={{marginTop:12,height:1,background:`linear-gradient(to right,${m.color}44,transparent)`}} />
              <div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><span className="mono" style={{fontSize:7,color:`${m.color}88`,letterSpacing:2}}>INITIALIZE →</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MY STATUS PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function MyStatusPanel({ user, onClose }) {
  const toast = useToast();
  const [statuses, setStatuses] = useState({});
  const [sel, setSel] = useState("online");
  const [activity, setActivity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(()=>{
    DB.getPlayerStatus().then(s=>{
      setStatuses(s);
      const mine = s[user.username];
      if(mine){ setSel(mine.status); setActivity(mine.activity||""); }
    });
  },[user.username]);

  const save = async() => {
    setSaving(true);
    const updated = { ...statuses, [user.username]:{ status:sel, activity:activity.trim()||"Online", updatedAt:new Date().toISOString() } };
    await DB.setPlayerStatus(updated);
    toast("Status updated successfully!","var(--green)","✅");
    setSaving(false); onClose();
  };

  return(
    <Panel title="SET MY STATUS" subtitle={`UPDATING · ${user.username.toUpperCase()}`} color="var(--cyan)" onClose={onClose}>
      <div style={{maxWidth:400,margin:"0 auto"}}>
        <div style={{marginBottom:20}}>
          <label className="si-label">STATUS</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {STATUS_OPTIONS.map(s=>(
              <button key={s} className="stat-btn" onClick={()=>setSel(s)}
                style={{borderColor:sel===s?SC[s]:"rgba(255,255,255,.1)",color:sel===s?SC[s]:"var(--dim)",background:sel===s?`${SC[s]}18`:"transparent",padding:"10px",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{STATUS_EMOJI[s]}</div>
                <div className="orb" style={{fontSize:8,letterSpacing:2}}>{s.toUpperCase()}</div>
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <label className="si-label">CURRENT ACTIVITY</label>
          <input className="si" placeholder="What are you doing? e.g. Mining diamonds..." value={activity} onChange={e=>setActivity(e.target.value)} maxLength={60} />
          <div className="mono" style={{fontSize:9,color:"var(--dim)",marginTop:4,textAlign:"right"}}>{activity.length}/60</div>
        </div>
        <button className="neon-btn" onClick={save} disabled={saving} style={{width:"100%"}}>
          {saving?"UPDATING...":"⟩ SET STATUS ⟨"}
        </button>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVER STATUS PANEL — with real MC ping
// ═══════════════════════════════════════════════════════════════════════════════
function ServerPanel({ onClose, user }) {
  const toast = useToast();
  const [srv, setSrv] = useState(null);
  const [pingData, setPingData] = useState(null);
  const [pinging, setPinging] = useState(false);
  const [edit, setEdit] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastPingStatus = useRef(null);

  const doLoad = async() => { const s=await DB.getServer(); setSrv(s); setEdit(s); };

  useEffect(()=>{
    DB.getServer().then(s=>{setSrv(s);setEdit(s);setLoading(false);});
    const t=setInterval(()=>DB.getServer().then(setSrv),6000);
    return()=>clearInterval(t);
  },[]);

  const doPing = useCallback(async(s) => {
    if(!s?.ip || s.ip === "play.yourserver.net") { setPingData({reachable:false,note:"Update server IP first"}); return; }
    setPinging(true);
    const data = await pingMinecraft(s.ip, s.port||"25565");
    setPingData(data);
    // Auto-update status if ping shows different state
    if (data.reachable && data.online !== (s.status==="online")) {
      const newStatus = data.online?"online":"offline";
      if (lastPingStatus.current !== newStatus) {
        lastPingStatus.current = newStatus;
        const updated = {...s, status:newStatus, playerCount:data.players, lastChanged:new Date().toISOString(), changedBy:"AUTO-PING"};
        await DB.setServer(updated); setSrv(updated);
        if(newStatus==="online"){ fireBrowserNotif("🟢 SMP Server Online!","The server is up — hop on now!"); await DB.pushNotif({type:"server",title:"SERVER ONLINE",body:"SMP server is now online! Hop on and play."}); }
        toast(`Server auto-updated to ${newStatus.toUpperCase()}`, newStatus==="online"?"var(--green)":"var(--red)", newStatus==="online"?"🟢":"🔴");
      }
    }
    if(data.reachable && data.players !== undefined && s.playerCount !== data.players){
      await DB.setServer({...s, playerCount:data.players});
    }
    setPinging(false);
  },[toast]);

  useEffect(()=>{ if(srv&&!pingData) doPing(srv); },[srv]);

  const toggleStatus = async() => {
    if(!user?.isAdmin) return;
    const newStatus = srv.status==="online"?"offline":"online";
    const ns={...srv,status:newStatus,lastChanged:new Date().toISOString(),changedBy:user.username};
    setSaving(true); await DB.setServer(ns); setSrv(ns);
    if(newStatus==="online"){ fireBrowserNotif("🟢 Server Online!","Admin started the server!"); await DB.pushNotif({type:"server",title:"SERVER STARTED",body:`${user.username} started the server. Come play!`}); }
    toast(`Server marked ${newStatus.toUpperCase()}`, newStatus==="online"?"var(--green)":"var(--red)", newStatus==="online"?"▶":"⬛");
    setSaving(false);
  };

  const saveEdit = async() => {
    setSaving(true); await DB.setServer({...edit,lastChanged:new Date().toISOString(),changedBy:user.username});
    setSrv({...edit}); setEditMode(false); setSaving(false); toast("Server info updated.","var(--green)","✅");
  };

  if(loading) return <Panel title="SERVER STATUS" subtitle="FETCHING..." color="var(--green)" onClose={onClose}><div style={{textAlign:"center",padding:"50px 0"}}><div className="mono" style={{color:"var(--dim)"}}>CONNECTING TO DATABASE...</div></div></Panel>;

  const isOnline = srv?.status==="online";
  const DC={ ok:"var(--green)", warn:"var(--amber)", none:"var(--dim)" };

  return(
    <Panel title="SERVER STATUS" subtitle="LIVE PING · ATERNOS CONTROL" color="var(--green)" onClose={onClose} wide>
      <div style={{maxHeight:"72vh",overflowY:"auto"}}>

        {/* LIVE PING BANNER */}
        <div style={{background:"rgba(57,255,20,.05)",border:"1px solid rgba(57,255,20,.2)",borderRadius:8,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{position:"relative",width:10,height:10}}>
              <div style={{position:"absolute",inset:0,borderRadius:"50%",background:pingData?.online?"var(--green)":pingData?.reachable===false?"var(--red)":"var(--amber)"}} />
              {pingData?.online&&<div className="ping-ring" style={{borderColor:"var(--green)"}} />}
            </div>
            <div>
              <div className="orb" style={{fontSize:9,color:"var(--green)",letterSpacing:2}}>LIVE SERVER PING</div>
              <div className="mono" style={{fontSize:10,color:"var(--dim)",marginTop:2}}>
                {pinging?"Pinging...":pingData?.reachable===false?`Unreachable${pingData.note?` — ${pingData.note}`:""}`:pingData?.online?`Online · ${pingData.players}/${pingData.maxPlayers} players`:pingData?.motd?"Server offline":`Last ping: ${new Date().toLocaleTimeString()}`}
              </div>
              {pingData?.version&&<div className="mono" style={{fontSize:9,color:"rgba(57,255,20,.5)",marginTop:1}}>v{pingData.version}</div>}
            </div>
          </div>
          <button className="neon-btn" onClick={()=>doPing(srv)} disabled={pinging} style={{fontSize:8,padding:"7px 16px",borderColor:"var(--green)",color:"var(--green)"}}>
            {pinging?<span style={{animation:"spin 1s linear infinite",display:"inline-block"}}>⟳</span>:"⟳ PING"}
          </button>
        </div>

        {/* MAIN STATUS GRID */}
        <div className="srv-grid" style={{display:"flex",gap:16,marginBottom:18,flexWrap:"wrap"}}>
          {/* ORB */}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,flexShrink:0}}>
            <div className={isOnline?"srv-online":"srv-offline"} style={{width:120,height:120,borderRadius:"50%",border:`3px solid ${isOnline?"var(--green)":"var(--red)"}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`radial-gradient(circle,${isOnline?"rgba(57,255,20,.12)":"rgba(255,68,68,.08)"} 0%,transparent 70%)`,position:"relative"}}>
              <div style={{fontSize:28}}>{isOnline?"🟢":"🔴"}</div>
              <div className="orb" style={{fontSize:8,color:isOnline?"var(--green)":"var(--red)",letterSpacing:2,marginTop:4}}>{isOnline?"ONLINE":"OFFLINE"}</div>
              {pingData?.online&&pingData?.players>0&&<div className="mono" style={{fontSize:9,color:"var(--green)",marginTop:2}}>{pingData.players}P</div>}
            </div>
            {user?.isAdmin
              ?<button className="neon-btn" onClick={toggleStatus} disabled={saving} style={{fontSize:8,padding:"8px 16px",borderColor:isOnline?"var(--red)":"var(--green)",color:isOnline?"var(--red)":"var(--green)",width:120}}>
                {saving?"...":(isOnline?"⬛ STOP":"▶ START")}
              </button>
              :<div className="mono" style={{fontSize:8,color:"var(--dim)",textAlign:"center",marginTop:4}}>ADMIN ONLY</div>
            }
          </div>
          {/* INFO */}
          <div style={{flex:1,minWidth:180}}>
            {editMode&&user?.isAdmin?(
              <div style={{display:"grid",gap:9}}>
                {[["ip","SERVER IP"],["port","PORT"],["version","VERSION"],["motd","MOTD"],["atLink","ATERNOS URL"],["maxPlayers","MAX PLAYERS"]].map(([k,l])=>(
                  <div key={k}><label className="si-label">{l}</label><input className="si" value={edit[k]||""} onChange={e=>setEdit(v=>({...v,[k]:e.target.value}))} /></div>
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
                  {[["📍 IP",srv?.ip],["🔌 PORT",srv?.port],["🎮 VERSION",pingData?.version||srv?.version],["💬 MOTD",pingData?.motd||srv?.motd],["👥 PLAYERS",pingData?.online?`${pingData.players}/${pingData.maxPlayers} (live)`:`${srv?.playerCount||0}/${srv?.maxPlayers||20}`],["⏱ CHANGED",srv?.lastChanged?new Date(srv.lastChanged).toLocaleString():"—"],["👤 BY",srv?.changedBy||"—"]].map(([l,v])=>(
                    <div key={l} style={{display:"flex",gap:8,alignItems:"baseline"}}>
                      <span className="mono" style={{fontSize:8,color:"rgba(57,255,20,.5)",minWidth:82}}>{l}</span>
                      <span className="mono" style={{fontSize:11,color:"var(--text)"}}>{v}</span>
                    </div>
                  ))}
                </div>
                {user?.isAdmin&&<button className="neon-btn" onClick={()=>setEditMode(true)} style={{fontSize:8,padding:"7px 14px",borderColor:"var(--amber)",color:"var(--amber)",marginTop:10,width:"fit-content"}}>✎ EDIT</button>}
              </div>
            )}
          </div>
        </div>

        {/* JOIN STEPS */}
        <div style={{background:"rgba(57,255,20,.04)",border:"1px solid rgba(57,255,20,.14)",borderRadius:8,padding:"12px 16px",marginBottom:12}}>
          <div className="orb" style={{fontSize:8,color:"var(--green)",letterSpacing:3,marginBottom:8}}>▶ HOW TO JOIN</div>
          {[`1. Open Minecraft Java Edition → Multiplayer`,`2. Add Server — IP: ${srv?.ip||"..."} (Port: ${srv?.port||"25565"})`,`3. Make sure you're on version ${srv?.version||"1.20.4"}`,`4. ${isOnline?"Server is ONLINE — click Join Server!":"Server is OFFLINE — try again later or check Discord."}`].map((s,i)=>(
            <div key={i} className="mono" style={{fontSize:11,color:i===3?(isOnline?"var(--green)":"var(--red)"):"var(--dim)",lineHeight:1.7}}>{s}</div>
          ))}
        </div>

        {/* ATERNOS */}
        <div style={{background:"rgba(15,15,15,.7)",border:"1px solid #2a2a2a",borderRadius:8,padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span className="orb" style={{fontSize:12,color:"#ddd",letterSpacing:2,fontWeight:700}}>ATERNOS</span>
              <span className="orb" style={{fontSize:7,padding:"2px 8px",borderRadius:3,background:"rgba(100,100,100,.3)",border:"1px solid #444",color:"#aaa",letterSpacing:2}}>FREE HOSTING</span>
            </div>
            <div className="mono" style={{fontSize:10,color:"#555",lineHeight:1.6}}>Start/stop the server from the Aternos dashboard. Toggle status above to reflect the change for all players.</div>
            <div className="mono" style={{fontSize:9,color:"#3a3a3a",marginTop:3}}>⚠ No official Aternos API exists — manual toggle is the correct workflow.</div>
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
//  PLAYERS PANEL — with real-time self-set statuses + MC skins
// ═══════════════════════════════════════════════════════════════════════════════
function PlayersPanel({ onClose }) {
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    const load=()=>DB.getPlayerStatus().then(s=>{setStatuses(s);setLoading(false);});
    load();
    const t=setInterval(load,8000);
    return()=>clearInterval(t);
  },[]);

  const merged = PLAYERS_DEFAULT_LIST.map(p=>{
    const live = statuses[p.name];
    return live ? {...p, status:live.status, activity:live.activity, lastUpdated:live.updatedAt } : {...p, status:p.defaultStatus, activity:"Status not set", lastUpdated:null};
  });

  const onlineCount = merged.filter(p=>p.status==="online"||p.status==="busy").length;

  return(
    <Panel title="PLAYER SYSTEMS" subtitle={`LIVE STATUS · MINECRAFT SKINS · ${onlineCount} ACTIVE`} color="var(--cyan)" onClose={onClose} wide>
      <div style={{marginBottom:12,padding:"8px 12px",background:"rgba(0,245,255,.04)",border:"1px solid rgba(0,245,255,.1)",borderRadius:6}}>
        <div className="mono" style={{fontSize:10,color:"var(--dim)",lineHeight:1.6}}>
          💡 Player statuses update in real-time. Players can set their own status via the <span style={{color:"var(--cyan)"}}>📊 STATUS</span> button in the top bar after signing in.
        </div>
      </div>
      {loading
        ?<div style={{textAlign:"center",padding:"40px 0"}}><div className="mono" style={{color:"var(--dim)"}}>LOADING STATUS DATA...</div></div>
        :<div className="player-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:12,maxHeight:"62vh",overflowY:"auto"}}>
          {merged.map(p=>(
            <div className="pcard" key={p.name}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{position:"relative",flexShrink:0}}>
                  <MCAvatar username={p.name} size={42} style={{border:`2px solid ${SC[p.status]}44`}} />
                  <div style={{position:"absolute",bottom:-2,right:-2,width:10,height:10,borderRadius:"50%",background:SC[p.status],border:"2px solid #010812",boxShadow:`0 0 6px ${SC[p.status]}`,animation:p.status!=="offline"?"pulseDot 2s ease-in-out infinite":"none"}} />
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div className="orb" style={{fontSize:10,color:"#fff",letterSpacing:1,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <span className="mono" style={{fontSize:9,color:SC[p.status],letterSpacing:1}}>{STATUS_EMOJI[p.status]} {SL[p.status]}</span>
                  </div>
                  <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{p.role}</div>
                </div>
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--text)",lineHeight:1.5,borderTop:"1px solid rgba(0,245,255,.07)",paddingTop:8}}>
                <span style={{color:"rgba(0,245,255,.4)"}}>DOING › </span>{p.activity}
              </div>
              {p.lastUpdated&&<div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:4}}>Updated {new Date(p.lastUpdated).toLocaleTimeString()}</div>}
            </div>
          ))}
        </div>
      }
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SURVEY + AUTH PANEL
// ═══════════════════════════════════════════════════════════════════════════════
function RadioGrp({ label, opts, value, onChange }) {
  return(
    <div style={{marginBottom:12}}>
      <label className="si-label">{label}</label>
      <div className="sradio">{opts.map(o=><label key={o} className={`srlabel${value===o?" act":""}`} onClick={()=>onChange(o)}><input type="radio"/>{o}</label>)}</div>
    </div>
  );
}

function SurveyPanel({ onClose, currentUser, onLogin }) {
  const toast = useToast();
  const [tab,setTab]=useState(currentUser?"survey":"login");
  const [form,setForm]=useState({});
  const [af,setAf]=useState({username:"",password:"",email:"",confirm:""});
  const [submitted,setSubmitted]=useState(false);
  const [alreadyDone,setAlreadyDone]=useState(false);
  const [resetTab,setResetTab]=useState(false);
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const [checking,setChecking]=useState(true);
  const sf=(k,v)=>setForm(f=>({...f,[k]:v}));

  useEffect(()=>{
    if(currentUser) DB.getSurveys().then(s=>{setAlreadyDone(s.some(x=>x.username===currentUser.username));setChecking(false);});
    else setChecking(false);
  },[currentUser]);

  const doLogin=async()=>{
    setErr("");setLoading(true);
    if(!af.username||!af.password){setErr("All fields required.");setLoading(false);return;}
    if(af.username===ADMIN_CREDS.username&&af.password===ADMIN_CREDS.password){
      const u={username:ADMIN_CREDS.username,isAdmin:true};await DB.setSession(u);onLogin(u);setLoading(false);return;
    }
    const users=await DB.getUsers();
    const found=users.find(u=>u.username.toLowerCase()===af.username.toLowerCase()&&u.password===af.password);
    if(!found){setErr("Invalid username or password.");setLoading(false);return;}
    if(found.resetRequested){setErr("Your password was reset by admin. Contact AdminOP for new credentials.");setLoading(false);return;}
    const u={username:found.username,isAdmin:false};await DB.setSession(u);onLogin(u);toast(`Welcome back, ${found.username}!`,"var(--cyan)","👋");setLoading(false);
  };

  const doSignup=async()=>{
    setErr("");setLoading(true);
    const{username,password,email,confirm}=af;
    if(!username||!password||!email){setErr("All fields required.");setLoading(false);return;}
    if(password!==confirm){setErr("Passwords do not match.");setLoading(false);return;}
    if(password.length<6){setErr("Password must be ≥6 characters.");setLoading(false);return;}
    if(username===ADMIN_CREDS.username){setErr("Username not available.");setLoading(false);return;}
    const users=await DB.getUsers();
    if(users.some(u=>u.username.toLowerCase()===username.toLowerCase())){setErr("Username already taken.");setLoading(false);return;}
    await DB.setUsers([...users,{username,password,email,createdAt:new Date().toISOString()}]);
    await DB.pushNotif({type:"admin",title:"NEW PLAYER REGISTERED",body:`${username} created an account and is ready to fill the survey.`});
    const u={username,isAdmin:false};await DB.setSession(u);onLogin(u);toast(`Account created! Welcome, ${username}!`,"var(--green)","🎉");setLoading(false);
  };

  const doResetReq=async()=>{
    setErr("");setLoading(true);
    if(!af.username){setErr("Enter your username.");setLoading(false);return;}
    const users=await DB.getUsers();
    const found=users.find(u=>u.username.toLowerCase()===af.username.toLowerCase());
    if(!found){setErr("Username not found.");setLoading(false);return;}
    await DB.requestPwReset(af.username);
    await DB.pushNotif({type:"admin",title:"PASSWORD RESET REQUEST",body:`${af.username} requested a password reset. Go to Admin → Users to reset it.`});
    toast("Reset request sent! Ask AdminOP to set your new password.","var(--amber)","🔑");setResetTab(false);setLoading(false);
  };

  const doSurvey=async()=>{
    if(!form.play){setErr("Please answer at least the first question.");return;}
    setLoading(true);
    const surveys=await DB.getSurveys();
    await DB.setSurveys([...surveys,{username:currentUser.username,responses:form,submittedAt:new Date().toISOString()}]);
    const wl=await DB.getWhitelist();
    if(!wl.includes(currentUser.username))await DB.setWhitelist([...wl,currentUser.username]);
    await DB.pushNotif({type:"survey",title:"NEW SURVEY SUBMITTED",body:`${currentUser.username} completed the SMP survey and was added to the whitelist.`});
    toast("Survey submitted! You've been added to the whitelist.","var(--green)","📡");
    setSubmitted(true);setLoading(false);
  };

  if(submitted) return(
    <Panel title="SURVEY SCANNER" subtitle="RESPONSE CAPTURED" color="var(--blue)" onClose={onClose}>
      <div style={{textAlign:"center",padding:"40px 0",animation:"successPop .5s ease both"}}>
        <div style={{fontSize:50,marginBottom:14}}>✅</div>
        <div className="orb" style={{fontSize:12,color:"var(--green)",letterSpacing:3,marginBottom:8}}>RESPONSE LOGGED</div>
        <p className="mono" style={{fontSize:11,color:"var(--dim)",lineHeight:1.8}}>Your data was captured.<br/>You've been added to the server whitelist!</p>
      </div>
    </Panel>
  );
  if(alreadyDone) return(
    <Panel title="SURVEY SCANNER" subtitle="LOCKED" color="var(--blue)" onClose={onClose}>
      <div style={{textAlign:"center",padding:"40px 0"}}>
        <div style={{fontSize:50,marginBottom:14}}>🔒</div>
        <div className="orb" style={{fontSize:11,color:"var(--amber)",letterSpacing:3,marginBottom:8}}>SURVEY ALREADY SUBMITTED</div>
        <p className="mono" style={{fontSize:11,color:"var(--dim)",lineHeight:1.8}}>Account <span style={{color:"var(--cyan)"}}>{currentUser.username}</span> already completed the survey.<br/>One submission per account.</p>
        <div className="mono" style={{fontSize:9,color:"rgba(0,245,255,.35)",marginTop:14,letterSpacing:1}}>Contact AdminOP to reset your survey access.</div>
      </div>
    </Panel>
  );

  return(
    <Panel title="SURVEY SCANNER" subtitle={currentUser?`AUTHENTICATED · ${currentUser.username.toUpperCase()}`:"AUTHENTICATION REQUIRED"} color="var(--blue)" onClose={onClose} wide>
      {checking?<div style={{textAlign:"center",padding:"40px 0"}}><div className="mono" style={{color:"var(--dim)"}}>VERIFYING SESSION...</div></div>
      :!currentUser?(
        <div style={{maxWidth:420,margin:"0 auto"}}>
          <div style={{display:"flex",borderBottom:"1px solid rgba(0,245,255,.1)",marginBottom:20}}>
            {["login","signup","reset"].map((t,i)=>(
              <button key={t} className={`auth-tab${(resetTab?tab==="reset":tab===t)&&(t==="reset"?resetTab:(tab===t&&!resetTab))?" act":""}`}
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
              <div className="mono" style={{fontSize:9,color:"var(--dim)",lineHeight:1.7,textAlign:"center"}}>This will flag your account. AdminOP will set a new password in the Admin panel. Check back later.</div>
            </div>
          ):(
            <div style={{display:"grid",gap:11}}>
              <div><label className="si-label">USERNAME</label><input className="si" placeholder="Your IGN or username" value={af.username} onChange={e=>setAf(f=>({...f,username:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&(tab==="login"?doLogin():null)}/></div>
              {tab==="signup"&&<div><label className="si-label">EMAIL</label><input className="si" type="email" placeholder="you@example.com" value={af.email} onChange={e=>setAf(f=>({...f,email:e.target.value}))}/></div>}
              <div><label className="si-label">PASSWORD</label><input className="si" type="password" placeholder="••••••••" value={af.password} onChange={e=>setAf(f=>({...f,password:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&(tab==="login"?doLogin():null)}/></div>
              {tab==="signup"&&<div><label className="si-label">CONFIRM PASSWORD</label><input className="si" type="password" placeholder="••••••••" value={af.confirm} onChange={e=>setAf(f=>({...f,confirm:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&doSignup()}/></div>}
              <button className="neon-btn" onClick={tab==="login"?doLogin:doSignup} disabled={loading} style={{width:"100%",borderColor:"var(--blue)",color:"var(--blue)"}}>
                {loading?"PROCESSING...":(tab==="login"?"⟩ AUTHENTICATE ⟨":"⟩ CREATE ACCOUNT ⟨")}
              </button>
            </div>
          )}
          <div style={{marginTop:16,padding:10,background:"rgba(0,245,255,.03)",border:"1px dashed rgba(0,245,255,.1)",borderRadius:6}}>
            <div className="mono" style={{fontSize:8,color:"var(--dim)",lineHeight:1.8}}>
              ℹ One survey per account · Whitelisted on submission<br/>
              Admin: <span style={{color:"var(--orange)"}}>AdminOP</span> — contact server owner for credentials
            </div>
          </div>
        </div>
      ):(
        <div style={{maxHeight:"64vh",overflowY:"auto",paddingRight:4}}>
          {err&&<div className="mono" style={{fontSize:11,color:"var(--red)",marginBottom:10,padding:"8px 12px",background:"rgba(255,68,68,.08)",border:"1px solid rgba(255,68,68,.2)",borderRadius:6}}>⚠ {err}</div>}
          <div className="survey-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 20px"}}>
            <div>
              <RadioGrp label="Will you play?" opts={["Yes","No","Maybe"]} value={form.play} onChange={v=>sf("play",v)}/>
              <div style={{marginBottom:12}}><label className="si-label">Minecraft Version</label><select className="si" value={form.version||""} onChange={e=>sf("version",e.target.value)}><option value="">— Select —</option>{["1.20.4","1.20.1","1.19.4","Bedrock","Other"].map(v=><option key={v}>{v}</option>)}</select></div>
              <RadioGrp label="Client Type" opts={["Java Paid","Bedrock","Free Client"]} value={form.client} onChange={v=>sf("client",v)}/>
              <RadioGrp label="Playstyle" opts={["Builder","Warrior","Explorer","Trader","Engineer"]} value={form.style} onChange={v=>sf("style",v)}/>
              <div style={{marginBottom:12}}><label className="si-label">Preferred Time</label><select className="si" value={form.time||""} onChange={e=>sf("time",e.target.value)}><option value="">— Select —</option>{["Morning","Afternoon","Evening","Late Night"].map(v=><option key={v}>{v}</option>)}</select></div>
              <RadioGrp label="Daily Playtime" opts={["<1hr","1-3hr","3-6hr","6hr+"]} value={form.hours} onChange={v=>sf("hours",v)}/>
              <RadioGrp label="Aternos Familiarity" opts={["Used it","Heard of it","New to it"]} value={form.aternos} onChange={v=>sf("aternos",v)}/>
            </div>
            <div>
              <RadioGrp label="PvP Interest" opts={["Love it","Neutral","Avoid it"]} value={form.pvp} onChange={v=>sf("pvp",v)}/>
              <RadioGrp label="Voice Chat?" opts={["Yes","No","Sometimes"]} value={form.voice} onChange={v=>sf("voice",v)}/>
              <RadioGrp label="Mods OK?" opts={["Yes","No","Vanilla Only"]} value={form.mods} onChange={v=>sf("mods",v)}/>
              <RadioGrp label="Lag Tolerance" opts={["Low","Medium","High"]} value={form.lag} onChange={v=>sf("lag",v)}/>
              <div style={{marginBottom:12}}><label className="si-label">Time Zone</label><input className="si" placeholder="e.g. UTC+5:30, EST, PST" value={form.tz||""} onChange={e=>sf("tz",e.target.value)}/></div>
              <div style={{marginBottom:12}}><label className="si-label">Device / Specs</label><input className="si" placeholder="e.g. PC, 8GB RAM, GTX 1060" value={form.specs||""} onChange={e=>sf("specs",e.target.value)}/></div>
              <div style={{marginBottom:12}}><label className="si-label">Additional Notes</label><textarea className="si" rows={3} style={{resize:"vertical"}} value={form.notes||""} onChange={e=>sf("notes",e.target.value)}/></div>
            </div>
          </div>
          <button className="neon-btn" onClick={doSurvey} disabled={loading} style={{width:"100%",borderColor:"var(--blue)",color:"var(--blue)",marginTop:6}}>
            {loading?"TRANSMITTING...":"⟩ TRANSMIT SCAN DATA ⟨"}
          </button>
        </div>
      )}
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WAR LOGS
// ═══════════════════════════════════════════════════════════════════════════════
function WarsPanel({ onClose }) {
  const [season,setSeason]=useState(1);
  const [wars,setWars]=useState([]);
  useEffect(()=>{DB.getWars().then(setWars);},[]);
  const logs=season===1?wars:[];
  return(
    <Panel title="WAR LOGS" subtitle="CONFLICT HISTORY · TACTICAL ARCHIVE" color="var(--red)" onClose={onClose} wide>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[1,2].map(s=><button key={s} onClick={()=>setSeason(s)} style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:2,padding:"7px 16px",borderRadius:5,cursor:"pointer",background:season===s?"rgba(255,68,68,.2)":"transparent",border:`1px solid ${season===s?"var(--red)":"rgba(255,68,68,.2)"}`,color:season===s?"var(--red)":"var(--dim)",transition:"all .2s"}}>SEASON {s}</button>)}
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
function SeasonsPanel({ onClose }) {
  const [sel,setSel]=useState(null);
  if(sel) return(
    <Panel title={`SEASON ${sel.num} ARCHIVE`} subtitle={sel.tagline?.toUpperCase()} color="var(--purple)" onClose={()=>setSel(null)}>
      <div style={{maxHeight:"66vh",overflowY:"auto"}}>
        {[["ACHIEVEMENTS",sel.achievements],["MAJOR EVENTS",sel.events],["NOTABLE BUILDS",sel.builds]].map(([title,items])=>(
          <div key={title} style={{marginBottom:18}}>
            <div className="orb" style={{fontSize:8,color:"var(--purple)",letterSpacing:3,marginBottom:9}}>{title}</div>
            {items.map((item,i)=><div key={i} className="rule-item" style={{borderColor:"rgba(180,77,255,.4)"}}><span style={{color:"rgba(180,77,255,.5)"}}>◆ </span>{item}</div>)}
          </div>
        ))}
      </div>
    </Panel>
  );
  return(
    <Panel title="SEASON ARCHIVES" subtitle="SMP HISTORY DATABASE" color="var(--purple)" onClose={onClose}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(195px,1fr))",gap:12}}>
        {SEASONS.map(s=>(
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
function RulesPanel({ onClose }) {
  return(
    <Panel title="PROTOCOL RULES" subtitle="SERVER REGULATIONS · COMMAND LAW" color="var(--amber)" onClose={onClose}>
      <div style={{maxHeight:"66vh",overflowY:"auto"}}>
        {RULES.map(cat=>(
          <div key={cat.cat} style={{marginBottom:20}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:9}}>
              <span style={{fontSize:14}}>{cat.icon}</span>
              <span className="orb" style={{fontSize:8,color:"var(--amber)",letterSpacing:3}}>{cat.cat}</span>
            </div>
            {cat.items.map((rule,i)=><div key={i} className="rule-item" style={{borderColor:"rgba(251,191,36,.4)"}}><span className="mono" style={{color:"rgba(251,191,36,.5)"}}>R{i+1}. </span>{rule}</div>)}
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
function DiagPanel({ onClose }) {
  return(
    <Panel title="DIAGNOSTICS" subtitle="SYSTEM HEALTH · TROUBLESHOOT" color="var(--blue)" onClose={onClose}>
      <div style={{maxHeight:"66vh",overflowY:"auto"}}>
        <div className="mono" style={{fontSize:11,color:"var(--blue)",marginBottom:12,padding:"9px 13px",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.2)",borderRadius:6}}>
          SCANNING SYSTEM... 6 CHECKS COMPLETE · 1 ERROR DETECTED
        </div>
        {DIAG.map((item,i)=>(
          <div className="diag-row" key={i}>
            <div style={{fontSize:18}}>{item.icon}</div>
            <div style={{flex:1}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                <span className="orb" style={{fontSize:9,color:"#fff",letterSpacing:1}}>{item.label}</span>
                <span className="mono" style={{fontSize:8,color:DC2[item.s],letterSpacing:2}}>{item.s.toUpperCase()} {DI2[item.s]}</span>
              </div>
              <div className="mono" style={{fontSize:11,color:"var(--dim)",lineHeight:1.5}}>{item.tip}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN PANEL — with password reset
// ═══════════════════════════════════════════════════════════════════════════════
function AdminPanel({ onClose, user }) {
  const toast = useToast();
  const [tab,setTab]=useState("wl");
  const [whitelist,setWhitelist]=useState([]);
  const [wars,setWars]=useState([]);
  const [surveys,setSurveys]=useState([]);
  const [users,setUsers]=useState([]);
  const [wlIn,setWlIn]=useState("");
  const [wi,setWi]=useState({title:"",teams:"",outcome:"",notes:"",winner:"0"});
  const [pwReset,setPwReset]=useState({});
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    DB.getWhitelist().then(setWhitelist);
    DB.getWars().then(setWars);
    DB.getSurveys().then(setSurveys);
    DB.getUsers().then(setUsers);
  },[]);

  const addWL=async()=>{ if(!wlIn.trim()||whitelist.includes(wlIn.trim()))return; const nw=[...whitelist,wlIn.trim()];setWhitelist(nw);await DB.setWhitelist(nw);setWlIn("");toast("Player added to whitelist.","var(--green)","✅"); };
  const removeWL=async(n)=>{ const nw=whitelist.filter(p=>p!==n);setWhitelist(nw);await DB.setWhitelist(nw);toast(`${n} removed.`,"var(--amber)","🗑"); };
  const addWar=async()=>{
    if(!wi.title.trim())return;setSaving(true);
    const e={id:Date.now(),...wi,teams:wi.teams.split(",").map(t=>t.trim()),winner:parseInt(wi.winner),date:`S1·${new Date().toLocaleDateString()}`};
    const nw=[...wars,e];setWars(nw);await DB.setWars(nw);
    await DB.pushNotif({type:"war",title:"WAR ENTRY LOGGED",body:`New war logged: "${wi.title}"`});
    setWi({title:"",teams:"",outcome:"",notes:"",winner:"0"});setSaving(false);toast("War entry logged.","var(--red)","⚔️");
  };
  const resetSurvey=async(u)=>{ const ns=surveys.filter(s=>s.username!==u);setSurveys(ns);await DB.setSurveys(ns);toast(`Survey reset for ${u}.`,"var(--amber)","🔄"); };
  const removeUser=async(u)=>{
    const nu=users.filter(x=>x.username!==u);setUsers(nu);await DB.setUsers(nu);
    const nw=whitelist.filter(w=>w!==u);setWhitelist(nw);await DB.setWhitelist(nw);toast(`${u} removed.`,"var(--red)","🗑");
  };
  const doPasswordReset=async(username)=>{
    const newPw=pwReset[username];
    if(!newPw||newPw.length<6){toast("Password must be ≥6 characters.","var(--red)","⚠");return;}
    await DB.resetUserPw(username,newPw);
    // Clear resetRequested flag
    const users2=await DB.getUsers();
    const updated=users2.map(u=>u.username===username?{...u,resetRequested:false}:u);
    await DB.setUsers(updated);setUsers(updated);
    setPwReset(p=>({...p,[username]:""}));
    toast(`Password reset for ${username}.`,"var(--green)","🔑");
  };

  const TABS=[{id:"wl",l:"WHITELIST"},{id:"war",l:"WAR EDITOR"},{id:"users",l:"USERS"},{id:"surveys",l:"SURVEYS"}];

  return(
    <Panel title="ADMIN CONTROLS" subtitle={`RESTRICTED · ${user?.username?.toUpperCase()} AUTHENTICATED`} color="var(--orange)" onClose={onClose} wide>
      <div className="admin-tabs" style={{display:"flex",gap:7,marginBottom:16,flexWrap:"wrap"}}>
        {TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{fontFamily:"Orbitron",fontSize:8,letterSpacing:2,padding:"6px 12px",borderRadius:5,cursor:"pointer",background:tab===t.id?"rgba(249,115,22,.2)":"transparent",border:`1px solid ${tab===t.id?"var(--orange)":"rgba(249,115,22,.2)"}`,color:tab===t.id?"var(--orange)":"var(--dim)",transition:"all .2s"}}>{t.l}</button>)}
      </div>
      <div style={{maxHeight:"60vh",overflowY:"auto"}}>
        {tab==="wl"&&<>
          <div style={{display:"flex",gap:9,marginBottom:14,alignItems:"flex-end"}}>
            <div style={{flex:1}}><label className="si-label">ADD PLAYER</label><input className="si" value={wlIn} onChange={e=>setWlIn(e.target.value)} placeholder="Username..." onKeyDown={e=>e.key==="Enter"&&addWL()}/></div>
            <button className="neon-btn" onClick={addWL} style={{borderColor:"var(--orange)",color:"var(--orange)",fontSize:9,padding:"10px 16px",flexShrink:0}}>ADD</button>
          </div>
          <div style={{border:"1px solid rgba(249,115,22,.14)",borderRadius:8,overflow:"hidden"}}>
            <div style={{padding:"7px 14px",background:"rgba(249,115,22,.07)"}}><span className="orb" style={{fontSize:8,color:"var(--orange)",letterSpacing:2}}>WHITELIST · {whitelist.length} PLAYERS</span></div>
            {whitelist.map((name,i)=>(
              <div className="wl-row" key={i}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <MCAvatar username={name} size={24} />
                  <span>{name}</span>
                </div>
                <button onClick={()=>removeWL(name)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:10,cursor:"pointer",fontFamily:"Share Tech Mono"}}>REMOVE</button>
              </div>
            ))}
          </div>
        </>}
        {tab==="war"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--red)",letterSpacing:3,marginBottom:10}}>LOG NEW WAR ENTRY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            {[["title","WAR TITLE","e.g. Battle of Spawn Plains"],["teams","TEAMS (comma sep)","Alpha, Night Raiders"],["outcome","OUTCOME","e.g. Alpha Victory"],["notes","NOTES","Summary..."]].map(([k,l,ph])=>(
              <div key={k}><label className="si-label">{l}</label><input className="si" placeholder={ph} value={wi[k]} onChange={e=>setWi(w=>({...w,[k]:e.target.value}))}/></div>
            ))}
            <div><label className="si-label">WINNER</label><select className="si" value={wi.winner} onChange={e=>setWi(w=>({...w,winner:e.target.value}))}><option value="0">Team 1 wins</option><option value="1">Team 2 wins</option><option value="-1">Draw</option></select></div>
          </div>
          <button className="neon-btn" onClick={addWar} disabled={saving} style={{borderColor:"var(--red)",color:"var(--red)",fontSize:9,marginBottom:18}}>{saving?"...":"⟩ LOG WAR ENTRY ⟨"}</button>
          <div className="orb" style={{fontSize:8,color:"var(--dim)",letterSpacing:2,marginBottom:9}}>EXISTING · {wars.length}</div>
          {wars.map(w=><div key={w.id} style={{padding:"9px 13px",borderRadius:6,border:"1px solid rgba(255,68,68,.14)",marginBottom:7}}><span className="mono" style={{color:"#ff8888",fontSize:11}}>{w.title}</span><span className="mono" style={{color:"var(--dim)",fontSize:10}}> · {Array.isArray(w.teams)?w.teams.join(" vs "):w.teams}</span></div>)}
        </>}
        {tab==="users"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--cyan)",letterSpacing:2,marginBottom:12}}>REGISTERED ACCOUNTS · {users.length}</div>
          {users.length===0&&<div className="mono" style={{color:"var(--dim)",fontSize:11}}>No registered accounts yet.</div>}
          {users.map((u,i)=>(
            <div key={i} style={{border:"1px solid rgba(0,245,255,.09)",borderRadius:8,padding:"12px 14px",marginBottom:9,background:"rgba(0,10,25,.4)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <MCAvatar username={u.username} size={34} />
                  <div>
                    <div className="orb" style={{fontSize:10,color:"var(--text)"}}>{u.username} {u.resetRequested&&<span style={{color:"var(--amber)",fontSize:8}}>⚠ RESET REQ</span>}</div>
                    <div className="mono" style={{fontSize:8,color:"var(--dim)",marginTop:2}}>{u.email} · {new Date(u.createdAt).toLocaleDateString()}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={()=>resetSurvey(u.username)} style={{background:"rgba(251,191,36,.1)",border:"1px solid rgba(251,191,36,.3)",color:"var(--amber)",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>RESET SURVEY</button>
                  <button onClick={()=>removeUser(u.username)} style={{background:"rgba(255,68,68,.1)",border:"1px solid rgba(255,68,68,.3)",color:"#ff5555",borderRadius:4,padding:"3px 9px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono"}}>REMOVE</button>
                </div>
              </div>
              {/* PASSWORD RESET SECTION */}
              <div style={{borderTop:"1px solid rgba(0,245,255,.07)",paddingTop:9}}>
                <label className="si-label">SET NEW PASSWORD FOR {u.username}</label>
                <div style={{display:"flex",gap:8}}>
                  <input className="si" type="password" placeholder="New password (≥6 chars)..." value={pwReset[u.username]||""} onChange={e=>setPwReset(p=>({...p,[u.username]:e.target.value}))} style={{flex:1}} />
                  <button onClick={()=>doPasswordReset(u.username)} style={{background:"rgba(57,255,20,.1)",border:"1px solid rgba(57,255,20,.3)",color:"var(--green)",borderRadius:4,padding:"6px 12px",fontSize:9,cursor:"pointer",fontFamily:"Share Tech Mono",flexShrink:0}}>SET PW</button>
                </div>
              </div>
            </div>
          ))}
        </>}
        {tab==="surveys"&&<>
          <div className="orb" style={{fontSize:8,color:"var(--blue)",letterSpacing:2,marginBottom:12}}>SURVEY SUBMISSIONS · {surveys.length}</div>
          {surveys.length===0&&<div className="mono" style={{color:"var(--dim)",fontSize:11}}>No submissions yet.</div>}
          {surveys.map((s,i)=>(
            <div key={i} style={{border:"1px solid rgba(59,130,246,.14)",borderRadius:8,padding:13,marginBottom:9,background:"rgba(0,8,22,.5)"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:9,flexWrap:"wrap",gap:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <MCAvatar username={s.username} size={26} />
                  <div className="orb" style={{fontSize:9,color:"var(--blue)"}}>{s.username}</div>
                </div>
                <div className="mono" style={{fontSize:8,color:"var(--dim)"}}>{new Date(s.submittedAt).toLocaleString()}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:5}}>
                {Object.entries(s.responses).filter(([k])=>k!=="notes").map(([k,v])=>(
                  <div key={k} style={{padding:"4px 7px",background:"rgba(59,130,246,.05)",borderRadius:4}}>
                    <div className="mono" style={{fontSize:7,color:"rgba(59,130,246,.5)",letterSpacing:1}}>{k.toUpperCase()}</div>
                    <div className="mono" style={{fontSize:9,color:"var(--text)"}}>{v||"—"}</div>
                  </div>
                ))}
              </div>
              {s.responses.notes&&<div style={{marginTop:7,fontFamily:"Share Tech Mono",fontSize:10,color:"var(--dim)",borderTop:"1px solid rgba(59,130,246,.08)",paddingTop:7}}>📝 {s.responses.notes}</div>}
            </div>
          ))}
        </>}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APP ROOT
// ═══════════════════════════════════════════════════════════════════════════════
const PM={server:ServerPanel,players:PlayersPanel,survey:SurveyPanel,wars:WarsPanel,seasons:SeasonsPanel,rules:RulesPanel,diag:DiagPanel,admin:AdminPanel};

function AppInner() {
  const [screen,setScreen]=useState("intro");
  const [openPanel,setOpenPanel]=useState(null);
  const [statusPanel,setStatusPanel]=useState(false);
  const [user,setUser]=useState(null);
  const [serverStatus,setServerStatus]=useState("offline");
  const [ready,setReady]=useState(false);
  const prevSrvStatus=useRef(null);
  const toast=useToast();

  useEffect(()=>{
    const init=async()=>{
      requestBrowserNotifPerm();
      const session=await DB.getSession();
      if(session) setUser(session);
      const srv=await DB.getServer();
      setServerStatus(srv.status);
      prevSrvStatus.current=srv.status;
      setReady(true);
    };
    init();
    const t=setInterval(async()=>{
      const s=await DB.getServer();
      if(s.status!==prevSrvStatus.current){
        prevSrvStatus.current=s.status;
        setServerStatus(s.status);
        if(s.status==="online"){ fireBrowserNotif("🟢 SMP Online!","Server is now online — join now!"); toast("Server is now ONLINE! Go play!","var(--green)","🟢"); }
        else { toast("Server went OFFLINE.","var(--red)","🔴"); }
      } else { setServerStatus(s.status); }
    },7000);
    return()=>clearInterval(t);
  },[]);

  const handleLogin=(u)=>setUser(u);
  const handleLogout=async()=>{ await DB.setSession(null); setUser(null); toast("Logged out successfully.","var(--dim)","👋"); };
  const openPanelFn=(id)=>{ if(id==="admin"&&!user?.isAdmin) return; setOpenPanel(id); };
  const ActivePanel=openPanel?PM[openPanel]:null;

  return(
    <>
      <style>{STYLE}</style>
      <div className="scanline"/>
      <Starfield/>
      <TopBar user={user} serverStatus={serverStatus} onLogout={handleLogout} onSetStatus={()=>user&&setStatusPanel(true)} />
      {screen==="intro"&&ready&&<IntroScreen onEnter={()=>setScreen("hub")}/>}
      {screen==="hub"&&<CommandHub onOpen={openPanelFn} user={user}/>}
      {ActivePanel&&<ActivePanel onClose={()=>setOpenPanel(null)} user={user} currentUser={user} onLogin={handleLogin}/>}
      {statusPanel&&user&&<MyStatusPanel user={user} onClose={()=>setStatusPanel(false)}/>}
    </>
  );
}

export default function App() {
  return <ToastProvider><AppInner /></ToastProvider>;
}
