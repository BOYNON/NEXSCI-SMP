# NexSci SMP — Automated JAR Control System
## Integration Guide (v10.0 Extension)

---

### What was added

Three new bridge files and a patched `App.jsx` — no existing code was rewritten.

---

### Bridge — new files

```
bridge/
├── services/
│   ├── jarVersionService.js   ← fetches stable builds from all providers
│   └── jarManager.js         ← safely downloads & switches server.jar
└── routes/
    └── jarRoutes.js           ← GET /jar/versions · POST /jar/apply
```

#### 1. Drop files into your bridge directory

```bash
# On your Oracle VPS, inside your bridge directory:
cp jarVersionService.js /path/to/bridge/services/
cp jarManager.js        /path/to/bridge/services/
cp jarRoutes.js         /path/to/bridge/routes/
```

#### 2. Register the route in server.js

In your existing `server.js`, add **two lines** (shown in the provided `server.js`):

```js
// Near the top with other requires:
const jarRoutes = require("./routes/jarRoutes");

// After the existing app.use() calls:
app.use("/", jarRoutes);
```

#### 3. Ensure VPS directory structure

```
/minecraft/
├── server.jar    ← will become a symlink
├── jars/         ← created automatically
└── backups/      ← created automatically
```

`MC_SERVER_PATH` in your `.env` must point to `/minecraft` (or wherever your server lives).

#### 4. Node.js fetch (Node 18+)

`jarVersionService.js` and `jarManager.js` use the built-in `fetch` (available in Node 18+).
Your `package.json` already requires `node>=18`. No new dependencies needed.

---

### Frontend — App.jsx

The patched `App.jsx` is a drop-in replacement. Changes are confined to `JarControlPanel`:

- Added state variables for live builds, provider/version/build selection, and apply status.
- Added `fetchLiveBuilds()` — called automatically when bridge comes online.
- Added `applyJar()` — calls `POST /jar/apply` with admin headers.
- Added **Live Builds UI block** at the top of the panel, above the existing start/stop controls.

All existing features (start/stop/restart, JAR type cards, Firestore config) are **unchanged**.

---

### Security notes

| Check | Implementation |
|---|---|
| API key | `apiKeyMiddleware` already applied globally in server.js |
| Admin only | `requireAdmin` middleware on `POST /jar/apply` |
| Input sanitization | Regex whitelist on provider/version/build; HTTPS-only URLs |
| Path traversal | Filename sanitized; symlink target validated |
| Concurrent ops | Global `_switching` lock — 409 if busy |
| Backup | Current `server.jar` backed up before every switch |
| Rollback | If switch fails, backup is restored and server restarted |

---

### Spigot

Spigot has no official public download API. The system returns a curated version list with a warning flag. Auto-apply is blocked for Spigot — the UI shows instructions to use BuildTools manually.

---

### Vanilla two-step resolution

Vanilla requires fetching a per-version manifest first to get the actual server JAR URL. `jarManager.js` handles this automatically via `resolveVanillaJarUrl()`.

---

### API reference

**GET `/jar/versions`** — No extra headers beyond `X-API-Key`.

```json
{
  "success": true,
  "versions": {
    "Paper":   [{ "version": "1.21.1", "build": "196", "jarUrl": "https://...", "stability": "stable" }],
    "Purpur":  [...],
    "Vanilla": [...],
    "Fabric":  [...],
    "Spigot":  [{ "version": "1.20.4", "build": "curated", "jarUrl": null, "warning": "..." }]
  }
}
```

**POST `/jar/apply`** — Requires `X-API-Key` + `X-Is-Admin: true`.

```json
{ "provider": "Paper", "version": "1.21.1", "build": "196" }
```

Response (immediate — switch runs in background):
```json
{ "success": true, "state": "switching", "provider": "Paper", "version": "1.21.1", "build": "196" }
```
