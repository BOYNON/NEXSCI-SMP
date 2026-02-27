# NexSci SMP — Oracle Cloud Bridge Setup Guide  v10.0

## Target Environment
- **Provider:** Oracle Cloud Free Tier
- **Instance:** ARM Ampere A1 (4 OCPU / 24 GB RAM free tier)
- **OS:** Ubuntu 22.04 LTS
- **Stack:** Java 21 · Node.js 20 LTS · PaperMC

---

## 1 — Connect to Your Instance

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@<YOUR_ORACLE_IP>
```

---

## 2 — System Updates

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git screen unzip net-tools
```

---

## 3 — Install Java 21 (required for PaperMC 1.21+)

```bash
sudo apt install -y openjdk-21-jre-headless
java -version   # should show 21.x
```

---

## 4 — Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # should show v20.x
npm -v
```

---

## 5 — Oracle Firewall Rules

In the Oracle Cloud console go to:
**Networking → Virtual Cloud Networks → Security Lists → Inbound Rules**

Add the following ingress rules:

| Protocol | Port  | Source      | Purpose               |
|----------|-------|-------------|----------------------|
| TCP      | 25565 | 0.0.0.0/0   | Minecraft Java       |
| TCP      | 4000  | 0.0.0.0/0   | NexSci Bridge API    |
| TCP      | 22    | your IP     | SSH                  |

Also open the OS firewall:

```bash
sudo iptables -I INPUT -p tcp --dport 25565 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 4000   -j ACCEPT
sudo netfilter-persistent save
```

---

## 6 — Directory Structure

```
/home/ubuntu/
├── minecraft/                  ← Minecraft server
│   ├── server.jar              ← symlink to active JAR (managed by JAR system)
│   ├── server.properties
│   ├── eula.txt
│   ├── jars/                   ← downloaded JARs (auto-created by JAR manager)
│   ├── backups/                ← server.jar backups before each switch (auto-created)
│   └── logs/
│       └── latest.log
├── nexsci/                     ← This repo
│   ├── start.sh
│   ├── stop.sh
│   ├── restart.sh
│   └── bridge/
│       ├── server.js
│       ├── .env                ← copy from .env.example, fill in secrets
│       ├── routes/
│       │   ├── server.js
│       │   ├── status.js
│       │   ├── logs.js
│       │   ├── command.js
│       │   └── jarRoutes.js    ← JAR control endpoints
│       ├── services/
│       │   ├── heartbeat.js
│       │   ├── jarVersionService.js  ← fetches stable builds from provider APIs
│       │   └── jarManager.js         ← downloads & switches active server JAR
│       └── utils/
│           ├── auth.js
│           └── logger.js
└── .mc.pid                     ← Auto-created by start.sh
```

---

## 7 — PaperMC Setup

```bash
mkdir -p /home/ubuntu/minecraft && cd /home/ubuntu/minecraft

# Download latest PaperMC (replace BUILD with the latest build number from papermc.io)
wget "https://api.papermc.io/v2/projects/paper/versions/1.21.1/builds/BUILD/downloads/paper-1.21.1-BUILD.jar" -O paper.jar

# Accept EULA
echo "eula=true" > eula.txt
```

Edit `server.properties` and set:
```
enable-rcon=true
rcon.port=25575
rcon.password=CHANGEME_STRONG_PASSWORD
online-mode=true
max-players=20
```

---

## 8 — Install the Bridge

```bash
cd /home/ubuntu/nexsci
git clone <your-repo-url> .    # or copy files manually

cd bridge
npm install

# Configure
cp .env.example .env
nano .env   # fill in all values
```

Make scripts executable:

```bash
chmod +x /home/ubuntu/nexsci/start.sh
chmod +x /home/ubuntu/nexsci/stop.sh
chmod +x /home/ubuntu/nexsci/restart.sh
```

---

## 9 — JAR Manager Setup

The JAR manager allows you to switch your server's JAR (Paper, Purpur, Vanilla, Fabric) from
the web panel without touching the server manually. This section covers what it needs to work.

### 9a — Prepare the minecraft directory

The JAR manager expects `server.jar` to be a **symlink** pointing to the active JAR inside
`jars/`. If you're starting fresh, set this up now. If you already have a `server.jar` file,
convert it:

```bash
cd /home/ubuntu/minecraft

# Create the jars and backups directories
mkdir -p jars backups

# Move your existing JAR into jars/ and replace server.jar with a symlink
mv paper.jar jars/paper-1.21.1-initial.jar
ln -s /home/ubuntu/minecraft/jars/paper-1.21.1-initial.jar server.jar

# Verify
ls -la server.jar
# Should show: server.jar -> /home/ubuntu/minecraft/jars/paper-1.21.1-initial.jar
```

> **Why symlinks?** The JAR manager does an atomic switch — it removes the old symlink and
> creates a new one pointing to the freshly downloaded JAR. This is instantaneous and leaves
> no window where `server.jar` is missing or corrupt.

### 9b — Verify start.sh and stop.sh are reachable

The JAR manager calls `start.sh` and `stop.sh` relative to the bridge directory. By default
it looks for them at:

```
/home/ubuntu/nexsci/start.sh
/home/ubuntu/nexsci/stop.sh
```

Check that these scripts exist and work:

```bash
# Test stop (safe to run when server is already stopped)
bash /home/ubuntu/nexsci/stop.sh

# Test start
bash /home/ubuntu/nexsci/start.sh
```

If your scripts live elsewhere, update the `SCRIPTS_DIR` constant at the top of
`bridge/services/jarManager.js`:

```js
const SCRIPTS_DIR = path.resolve(__dirname, "../../../");  // adjust this path
```

### 9c — Check .env values for the JAR manager

Open your `bridge/.env` and confirm these are set correctly:

```bash
# Absolute path to the directory containing server.jar
MC_SERVER_PATH=/home/ubuntu/minecraft

# This should already be set — the JAR manager uses it to find jars/ and backups/
```

No additional env vars are needed. The `jars/` and `backups/` directories are created
automatically on first use.

### 9d — Verify outbound HTTPS from your VPS

The JAR manager downloads JARs directly from provider APIs. Confirm your Oracle instance can
reach them:

```bash
curl -I https://api.papermc.io/v2/projects/paper
curl -I https://api.purpurmc.org/v2/purpur
curl -I https://meta.fabricmc.net/v2/versions
curl -I https://launchermeta.mojang.com/mc/game/version_manifest.json
```

All four should return `HTTP/2 200`. If any are blocked, check your Oracle VCN egress rules —
outbound HTTPS (port 443) must be allowed.

### 9e — Spigot note

Spigot has no official public download API. The JAR manager cannot auto-switch to Spigot.
The panel will display a warning and block the Apply button for Spigot. To use Spigot, compile
the JAR manually with BuildTools on your VPS and place it in `/home/ubuntu/minecraft/jars/`,
then symlink it manually.

### 9f — Quick end-to-end test

With the bridge running, test the versions endpoint:

```bash
curl -H "X-API-Key: YOUR_API_SECRET_KEY" http://localhost:4000/jar/versions | python3 -m json.tool
```

You should see a JSON object with Paper, Purpur, Vanilla, Fabric, and Spigot arrays each
containing up to 5 stable builds. If the arrays are populated, the JAR version service is
working correctly.

To test the apply endpoint (this will actually attempt a switch — only run when safe to do so):

```bash
curl -X POST http://localhost:4000/jar/apply \
  -H "X-API-Key: YOUR_API_SECRET_KEY" \
  -H "X-Is-Admin: true" \
  -H "Content-Type: application/json" \
  -d '{"provider":"Paper","version":"1.21.1","build":"196"}'
```

The response will be immediate: `{ "success": true, "state": "switching" }`. The actual
download and restart happen in the background — watch the bridge logs:

```bash
sudo journalctl -u nexsci-bridge -f
```

---

## 10 — Firebase Service Account

1. In Firebase Console → Project Settings → Service Accounts → Generate new private key
2. Download the JSON file to your local machine
3. On your server, encode it:
   ```bash
   base64 -w0 serviceAccount.json
   ```
4. Paste the output into `.env` as `FIREBASE_SA_BASE64=`

---

## 11 — Run the Bridge

**Manual test:**
```bash
cd /home/ubuntu/nexsci/bridge
node server.js
```

**Production (auto-restart via systemd):**

```bash
sudo nano /etc/systemd/system/nexsci-bridge.service
```

```ini
[Unit]
Description=NexSci SMP Bridge
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/nexsci/bridge
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/nexsci/bridge/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable nexsci-bridge
sudo systemctl start nexsci-bridge
sudo systemctl status nexsci-bridge
```

---

## 12 — Website Configuration

In the NexSci SMP web app:
1. Log in as admin
2. Open **Server Status** panel → Edit
3. Set **Bridge URL** to `https://your-oracle-ip:4000`
   (or use a domain + nginx reverse proxy for HTTPS)
4. Set **Bridge API Key** to the same value as `API_SECRET_KEY` in your `.env`
   — this is used by the JAR Control panel when calling `/jar/versions` and `/jar/apply`

The bridge badge will turn green within 15 seconds of the daemon starting.
Once green, open the **JAR Control** panel — the Live Builds section will auto-load.

---

## 13 — Optional: nginx Reverse Proxy (HTTPS)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo nano /etc/nginx/sites-available/nexsci-bridge
```

```nginx
server {
    listen 443 ssl;
    server_name bridge.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d bridge.yourdomain.com
sudo systemctl reload nginx
```

Then set Bridge URL to `https://bridge.yourdomain.com` in the web app.

---

## Appendix — JAR Manager behaviour reference

| Situation | What happens |
|---|---|
| Apply triggered while server is running | Bridge calls `stop.sh`, waits for it to finish, then proceeds |
| Apply triggered while a switch is already in progress | Bridge returns 409 — the panel shows "already in progress" |
| Download fails mid-transfer | Partial file is deleted, backup is restored, server is restarted |
| Downloaded JAR is suspiciously small (<1 KB) | Switch is aborted before touching `server.jar` |
| `start.sh` fails after successful switch | Logged as error — server stays stopped, new JAR is in place |
| `start.sh` fails after a rollback | Logged as critical error — manual intervention required |
| Backup location | `/home/ubuntu/minecraft/backups/server.jar.bak.<timestamp>` |
| Symlink target | `/home/ubuntu/minecraft/jars/<provider>-<version>-<build>.jar` |

Backups are never automatically deleted. Clean up old ones manually if disk space is a concern:

```bash
ls -lh /home/ubuntu/minecraft/backups/
rm /home/ubuntu/minecraft/backups/server.jar.bak.2025-*   # example
```
