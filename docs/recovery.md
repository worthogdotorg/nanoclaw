# NanoClaw v2 — Environment Recovery Guide

**Host**: Chorizo (macOS)
**Last updated**: 2026-05-07
**Agents**: Tia (general assistant) + Lupe (sysadmin)

> For steps on adding another agent, see `groups/discord_lupe/adding-agent.md`.

---

## 1. Backup Scheme

Backups are automated via `/usr/local/bin/nanoclaw-backup.sh`. Each run creates a dated hard-linked snapshot under `/Volumes/nanoclaw_backup/snapshots/`. Unchanged files are hard-linked from the previous snapshot (no extra space). A `latest` symlink always points to the most recent snapshot.

### Backup Volume

| What | Where |
|------|-------|
| Backup root | `/Volumes/nanoclaw_backup/` |
| Snapshots | `/Volumes/nanoclaw_backup/snapshots/YYYY-MM-DD/` |
| Latest symlink | `/Volumes/nanoclaw_backup/latest/` |
| Backup log | `/Volumes/nanoclaw_backup/backup.log` |

### What Gets Backed Up

| Source | Destination in snapshot |
|--------|------------------------|
| `/Volumes/overflow/nanoclaw-workspace/nanoclaw-v2/` (excl. `node_modules/`, `dist/`, `logs/`, `.git/`) | `<snapshot>/nanoclaw-v2/` |
| `~/nanoclaw-start.sh` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw-v2-58dc102f.plist` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw.healthcheck.plist` | `<snapshot>/home-files/` |
| `~/.config/nanoclaw/mount-allowlist.json` | `<snapshot>/home-files/` |
| `/usr/local/bin/restart-nanoclaw.sh` | `<snapshot>/home-files/` |
| `/usr/local/bin/nanoclaw-backup.sh` | `<snapshot>/home-files/` |

### Running a Backup Manually

```bash
/usr/local/bin/nanoclaw-backup.sh
```

### Checking Backup Status

```bash
# View recent backup log entries
tail -20 /Volumes/nanoclaw_backup/backup.log

# List all snapshots
ls /Volumes/nanoclaw_backup/snapshots/

# Size of backup volume
du -sh /Volumes/nanoclaw_backup/
```

### Automated Scheduling

Runs every 8 hours: **2:00 AM, 10:00 AM, 6:00 PM**. Plist: `~/Library/LaunchAgents/com.nanoclaw.backup.plist`

The launchd job runs via `~/Applications/NanoClawBackup.app` — an AppleScript app wrapper that must be granted **Full Disk Access** in System Settings so it can write to the external APFS backup volume. Without FDA, launchd's bash process cannot create directories on external volumes (macOS TCC restriction).

```bash
# Check it's registered
launchctl list | grep com.nanoclaw.backup

# Run immediately (outside the schedule)
/usr/local/bin/nanoclaw-backup.sh

# launchd stdout/stderr
tail -20 ~/Library/Logs/nanoclaw-backup.log

# Backup status (written after every run)
cat ~/Library/Logs/nanoclaw-backup-status.json
```

To reload after editing the plist:
```bash
launchctl bootout gui/$(id -u)/com.nanoclaw.backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.backup.plist
```

#### Recreating NanoClawBackup.app after restore

```bash
mkdir -p ~/Applications
osacompile -o ~/Applications/NanoClawBackup.app \
  -e 'do shell script "/usr/local/bin/nanoclaw-backup.sh"'
```

Then re-grant **Full Disk Access** to `NanoClawBackup.app` in System Settings → Privacy & Security → Full Disk Access.

### OneCLI Vault

The Anthropic API key lives in a Docker volume managed by OneCLI. Back up via the web UI at `http://127.0.0.1:10254`, or keep the raw key from `.env`.

---

## 2. Restore Steps

### Prerequisites

- macOS with Homebrew
- Docker Desktop installed and running
- `/Volumes/overflow/` mounted
- `/Volumes/nanoclaw_backup/` mounted (Samsung T5 — disk3)
- Git repo restored (or cloned from backup)

---

### Step 1 — Restore files from backup

```bash
SNAP=/Volumes/nanoclaw_backup/latest

# Repo files (rsync from snapshot — preserves all data/, groups/, src/ customizations)
rsync -a "$SNAP/nanoclaw-v2/" /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2/

# Home-drive files
cp "$SNAP/home-files/nanoclaw-start.sh" ~/nanoclaw-start.sh
chmod +x ~/nanoclaw-start.sh
cp "$SNAP/home-files/com.nanoclaw-v2-58dc102f.plist" ~/Library/LaunchAgents/
cp "$SNAP/home-files/com.nanoclaw.healthcheck.plist" ~/Library/LaunchAgents/
cp "$SNAP/home-files/com.nanoclaw.backup.plist" ~/Library/LaunchAgents/

# System scripts
sudo cp "$SNAP/home-files/restart-nanoclaw.sh" /usr/local/bin/restart-nanoclaw.sh
sudo chmod +x /usr/local/bin/restart-nanoclaw.sh
sudo cp "$SNAP/home-files/nanoclaw-backup.sh" /usr/local/bin/nanoclaw-backup.sh
sudo chmod +x /usr/local/bin/nanoclaw-backup.sh

# Mount allowlist
mkdir -p ~/.config/nanoclaw
cp "$SNAP/home-files/mount-allowlist.json" ~/.config/nanoclaw/
```

To restore from a specific date instead of `latest`:

```bash
SNAP=/Volumes/nanoclaw_backup/snapshots/2026-05-07
```

---

### Step 2 — Restore .env

`.env` is included in the snapshot under `nanoclaw-v2/`. Verify it contains all required keys (see §4).

---

### Step 3 — Install Node dependencies and build

```bash
cd /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2

# Node 22 is keg-only
export PATH="/usr/local/opt/node@22/bin:$PATH"

pnpm install
pnpm run build
```

---

### Step 4 — Build the agent container image

```bash
export DOCKER_API_VERSION=1.47
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

./container/build.sh
```

---

### Step 5 — Set up OneCLI and register the Anthropic key

If OneCLI is not already installed:

```bash
# Follow /init-onecli skill, or:
# Download and install onecli binary, then:
onecli secrets create --name anthropic-key --value <ANTHROPIC_API_KEY> --hosts api.anthropic.com
```

Set agent secret mode to `all` for both agents so credentials are injected automatically:

```bash
onecli agents list   # find agent IDs for Tia and Lupe
onecli agents set-secret-mode --id <tia-agent-id>  --mode all
onecli agents set-secret-mode --id <lupe-agent-id> --mode all
```

---

### Step 5b — Rebuild per-agent-group images

Any agent with custom npm/apt packages needs its own image layered on top of the base. Check `groups/*/container.json` for entries with `"imageTag"` set.

Currently: **Tia** has `ical.js` installed.

```bash
export DOCKER_API_VERSION=1.47
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

docker build \
  --tag "nanoclaw-agent-v2-58dc102f:ag-1777855064068-wl1sog" \
  - <<'EOF'
FROM nanoclaw-agent-v2-58dc102f:latest
USER root
RUN echo 'only-built-dependencies[]=ical.js' >> /root/.npmrc && pnpm install -g ical.js
USER node
EOF
```

> If more agents gain custom packages in the future, add their build steps here.

---

### Step 6 — Load launchd services

```bash
# NanoClaw service
launchctl enable gui/$(id -u)/com.nanoclaw-v2-58dc102f
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw-v2-58dc102f.plist

# Argus healthcheck (hourly)
launchctl enable gui/$(id -u)/com.nanoclaw.healthcheck
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.healthcheck.plist

# Daily backup (2am)
launchctl enable gui/$(id -u)/com.nanoclaw.backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.backup.plist
```

Verify both are running:

```bash
launchctl list | grep nanoclaw
tail -20 ~/Library/Logs/nanoclaw.log
```

---

### Step 7 — Verify Discord bots

In the **Discord Developer Portal** (`discord.com/developers/applications`):

- **Tia Assistant** bot — confirm Message Content Intent is enabled (Bot → Privileged Gateway Intents)
- **Lupe Sysadmin** bot — confirm Message Content Intent is enabled

Both bots must be invited to the server with `bot` + `applications.commands` scopes and Guild Install.

---

### Step 8 — Smoke test

Send a message to Tia in #general. She should respond.
Send `@Lupe Sysadmin hello` in #general. Lupe should respond in a thread, Tia should stay silent.
Ask Lupe to send a test message to the general channel to confirm her `general` destination is wired.

---

## 3. Required `.env` Keys

```
ANTHROPIC_API_KEY=          # Anthropic API — also registered in OneCLI vault
ASSISTANT_NAME=             # Display name (e.g. Tia)
DISCORD_BOT_TOKEN=          # Tia's bot token
DISCORD_APPLICATION_ID=     # Tia's application ID
DISCORD_PUBLIC_KEY=         # Tia's public key
DISCORD_LUPE_BOT_TOKEN=     # Lupe's bot token
DISCORD_LUPE_APPLICATION_ID=# Lupe's application ID
DISCORD_LUPE_PUBLIC_KEY=    # Lupe's public key
DOCKER_HOST=                # Docker socket path
ONECLI_URL=                 # OneCLI gateway URL (default: http://127.0.0.1:10254)
```

---

## 4. Key Paths Reference

| What | Where |
|------|-------|
| NanoClaw logs | `~/Library/Logs/nanoclaw.log` and `nanoclaw.error.log` |
| Argus logs | `~/Library/Logs/nanoclaw-restart.log` and `nanoclaw-healthcheck.log` |
| Session DBs | `data/v2-sessions/<agent-group>/<session>/` |
| Central DB | `data/v2.db` |
| Tia's workspace | `groups/discord_main/` → `/workspace/agent/` in container |
| Lupe's workspace | `groups/discord_lupe/` → `/workspace/agent/` in container |
| OneCLI web UI | `http://127.0.0.1:10254` |
| Backup script | `/usr/local/bin/nanoclaw-backup.sh` |
| Backup volume | `/Volumes/nanoclaw_backup/` |

---

## 5. If Things Go Wrong

**Service won't start (EX_CONFIG)**
```bash
launchctl enable gui/$(id -u)/com.nanoclaw-v2-58dc102f
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw-v2-58dc102f.plist
```
Note: `StandardOutPath`/`StandardErrorPath` in the plist must point to `~/Library/Logs/`, not `/Volumes/` — launchd rejects paths on external volumes.

**Docker unhealthy after restart**
```bash
# Remove stale socket and relaunch
rm -f ~/.docker/run/docker.sock
open -a Docker
# Wait ~2 min, then restart NanoClaw
launchctl kickstart -k gui/$(id -u)/com.nanoclaw-v2-58dc102f
```

**Agent gets 401 from Anthropic API**
```bash
onecli agents list
onecli agents set-secret-mode --id <agent-id> --mode all
```
No container restart needed — OneCLI injects credentials per-request.

**Lupe's `general` destination missing after session restart**
The `agent_destinations` row in `data/v2.db` is the source of truth and is projected automatically on each container wake. If missing entirely:
```bash
node -e "
const db = require('better-sqlite3')('data/v2.db');
db.prepare('INSERT OR REPLACE INTO agent_destinations VALUES (?,?,?,?,?)').run(
  'ag-1778023201501-lupe01','general','channel','mg-1778023201511-lupe02', new Date().toISOString()
);
"
```

**Backup volume not mounted**
The backup script exits with an error if `/Volumes/nanoclaw_backup/` is not present. Mount the Samsung T5 first, then re-run.
