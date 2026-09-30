# NanoClaw v2 — Environment Recovery Guide

**Host**: Chorizo (macOS)
**Last updated**: 2026-07-18
**Agents**: Tia (general), Lupe (sysadmin), Sofia (financial advisor), Antonio (product research)

For backup scheme details, see [docs/backup.md](./backup.md).

---

## Prerequisites

- macOS with Homebrew
- Docker Desktop installed and running
- `/Volumes/overflow/` mounted
- Samsung T5 mounted at `/Volumes/nanoclaw_backup/` (for T5 restore), or Proton Drive available (for cloud restore)
- Node 22: `brew install node@22` if not present

---

## Step 1 — Restore Files

### From T5 backup

```bash
SNAP=/Volumes/nanoclaw_backup/latest
# Or a specific date:
# SNAP=/Volumes/nanoclaw_backup/snapshots/2026-06-13

# Repo files (preserves all data/, groups/, src/ customizations)
rsync -a "$SNAP/nanoclaw-v2/" /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2/

# Home-drive files
cp "$SNAP/home-files/nanoclaw-start.sh" ~/nanoclaw-start.sh
chmod +x ~/nanoclaw-start.sh
cp "$SNAP/home-files/com.nanoclaw-v2-58dc102f.plist" ~/Library/LaunchAgents/
cp "$SNAP/home-files/com.nanoclaw.healthcheck.plist" ~/Library/LaunchAgents/
cp "$SNAP/home-files/com.nanoclaw.backup.plist" ~/Library/LaunchAgents/
cp "$SNAP/home-files/com.nanoclaw.cloud-backup.plist" ~/Library/LaunchAgents/
cp "$SNAP/home-files/com.nanoclaw.thermal-check.plist" ~/Library/LaunchAgents/

# System scripts
sudo cp "$SNAP/home-files/restart-nanoclaw.sh" /usr/local/bin/restart-nanoclaw.sh
sudo chmod +x /usr/local/bin/restart-nanoclaw.sh
sudo cp "$SNAP/home-files/nanoclaw-backup.sh" /usr/local/bin/nanoclaw-backup.sh
sudo chmod +x /usr/local/bin/nanoclaw-backup.sh
sudo cp "$SNAP/home-files/nanoclaw-cloud-backup.sh" /usr/local/bin/nanoclaw-cloud-backup.sh
sudo chmod +x /usr/local/bin/nanoclaw-cloud-backup.sh
sudo cp "$SNAP/home-files/thermal-check.sh" /usr/local/bin/thermal-check.sh
sudo chmod +x /usr/local/bin/thermal-check.sh
sudo cp "$SNAP/home-files/sync-musica.sh" /usr/local/bin/sync-musica.sh
sudo chmod +x /usr/local/bin/sync-musica.sh

# Mount allowlist
mkdir -p ~/.config/nanoclaw
cp "$SNAP/home-files/mount-allowlist.json" ~/.config/nanoclaw/

# Claude Code memory
rsync -a "$SNAP/claude-memory/" ~/.claude/
```

### Recreating NanoClawBackup.app after restore

```bash
mkdir -p ~/Applications
osacompile -o ~/Applications/NanoClawBackup.app \
  -e 'do shell script "/usr/local/bin/nanoclaw-backup.sh"'
```

Then re-grant **Full Disk Access** to `NanoClawBackup.app` in System Settings → Privacy & Security → Full Disk Access.

### From Proton Drive (if T5 unavailable)

**Recovery point**: whatever the last successful 3am cloud-backup run uploaded — i.e. "as of last night," not a specific historical date. Proton Drive holds a single mirrored state, not dated snapshots (see [docs/backup.md](./backup.md)). If you need an older point in time, T5's dated `snapshots/YYYY-MM-DD/` directories are the only source for that, and this path doesn't apply — restore from T5 with the desired date instead.

**Prerequisites**: `proton-drive` CLI installed and authenticated. Check auth is live:

```bash
proton-drive filesystem list /my-files/NanoClaw
```

If it fails or prompts for a browser login, re-authenticate first:

```bash
proton-drive auth login   # browser popup appears — click to authenticate
```

**Download to a local staging directory.** Each remote folder is downloaded nested under `localFolder`, so the result matches the same `nanoclaw-v2/`, `home-files/`, `claude-memory/` layout used by the T5 restore commands above:

```bash
mkdir -p /tmp/nanoclaw-cloud-restore
proton-drive filesystem download -c replace \
  /my-files/NanoClaw/nanoclaw-v2 \
  /my-files/NanoClaw/home-files \
  /my-files/NanoClaw/claude-memory \
  /tmp/nanoclaw-cloud-restore
```

This produces `/tmp/nanoclaw-cloud-restore/{nanoclaw-v2,home-files,claude-memory}/` — structurally identical to a T5 snapshot dir. Point `SNAP` at it and run the exact same restore commands as the T5 path above:

```bash
SNAP=/tmp/nanoclaw-cloud-restore
# ... same rsync/cp commands as "From T5 backup" §1 above ...
```

**Caveats specific to a cloud restore:**
- The download is a full transfer over the network (whole repo minus excludes, `~/.claude/`, home-files) — expect it to take noticeably longer than the local T5 rsync.
- Files deleted locally since the last full wipe can still be present in the cloud copy (see Housekeeping below) — harmless for restore, since the same-named current files always win via `-c replace`, but don't be surprised by stale extras.
- If something was deleted accidentally *between* nightly runs, check Proton Drive's own trash before it's overwritten by the next sync or wiped by the next quarterly `--full`:
  ```bash
  proton-drive filesystem list /trash
  proton-drive filesystem restore <path>
  ```
  This is a short-lived safety net, not a substitute for T5's dated history.

**After restoring from cloud**, continue with Step 2 onward below exactly as with a T5 restore.

---

## Step 2 — Restore .env

`.env` is included in the snapshot at `nanoclaw-v2/.env`. Verify it contains all required keys (see §3). Also sync to the container env file:

```bash
cp /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2/.env \
   /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2/data/env/env
```

---

## Step 3 — Install Node Dependencies and Build

```bash
cd /Volumes/overflow/nanoclaw-workspace/nanoclaw-v2
export PATH="/usr/local/opt/node@22/bin:$PATH"

pnpm install
pnpm run build
```

---

## Step 4 — Build the Agent Container Image

```bash
export DOCKER_API_VERSION=1.47
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

./container/build.sh
```

---

## Step 5 — Set Up OneCLI and Register the Anthropic Key

If OneCLI is not already installed, follow the `/init-onecli` skill. Then:

```bash
onecli secrets create --name anthropic-key --value <ANTHROPIC_API_KEY> --hosts api.anthropic.com
```

OneCLI agents are auto-created when containers first spawn. After the first message to each agent, set secret mode to `all`:

```bash
onecli agents list   # find agent IDs (identifier = agent group ID)
onecli agents set-secret-mode --id <tia-agent-id>     --mode all
onecli agents set-secret-mode --id <lupe-agent-id>    --mode all
onecli agents set-secret-mode --id <sofia-agent-id>   --mode all
onecli agents set-secret-mode --id <antonio-agent-id> --mode all
```

No container restart needed — OneCLI injects credentials per-request.

---

## Step 5b — Rebuild Per-Agent-Group Images

Some agents have custom packages layered on top of the base image. Check `groups/*/container.json` (already restored in Step 1) for entries with a non-empty `npm` or `apt` array and an `imageTag` field — currently **Tia** (Proton email support: `imapflow`, `nodemailer`, `@modelcontextprotocol/sdk`, `ical.js`).

Don't hand-write the Dockerfile — the package list drifts (this has already caused one outage: a per-group image went missing from Docker and the docs still referenced an old package list). Use the same rebuild path the host uses internally, which reads packages straight from `container.json`:

```bash
./bin/ncl groups restart --id ag-1777855064068-wl1sog --rebuild
```

Repeat for any other group with a non-empty `packages` block. This both builds the image *and* respawns the container — no separate spawn step needed. Verify the tag exists afterward:

```bash
docker images | grep 58dc102f
```

---

## Step 6 — Load launchd Services

```bash
# NanoClaw service
launchctl enable gui/$(id -u)/com.nanoclaw-v2-58dc102f
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw-v2-58dc102f.plist

# Argus healthcheck (hourly)
launchctl enable gui/$(id -u)/com.nanoclaw.healthcheck
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.healthcheck.plist

# T5 backup (every 8 hours)
launchctl enable gui/$(id -u)/com.nanoclaw.backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.backup.plist

# Cloud backup / Proton Drive (3am daily)
launchctl enable gui/$(id -u)/com.nanoclaw.cloud-backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.cloud-backup.plist

# Thermal monitor (hourly)
launchctl enable gui/$(id -u)/com.nanoclaw.thermal-check
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.thermal-check.plist
```

Verify NanoClaw is running:

```bash
launchctl list | grep nanoclaw
tail -20 ~/Library/Logs/nanoclaw.log
```

---

## Step 7 — Verify Discord Bots

In the **Discord Developer Portal** (`discord.com/developers/applications`):

For each bot — **Tia Assistant**, **Lupe Sysadmin**, **Sofia Finance**, **Antonio Research**:
- **Bot** → **Privileged Gateway Intents** → enable **Message Content Intent**
- Confirm the bot is invited to the server with `bot` + `applications.commands` scopes and **Guild Install**

Re-authenticate Proton Drive (cloud backup will fail without this):
```bash
proton-drive auth login
```

---

## Step 8 — Smoke Test

```bash
# Send a message to Tia in #general — she should respond
# @mention Lupe in #general — Lupe responds, Tia stays silent
# Message #lupe directly — Lupe responds
# Message #sofia-finance — Sofia responds
# Message #antonio — Antonio responds
# Ask Tia to delegate something to Lupe — Lupe should post in #lupe AND reply to Tia
```

---

## §3 — Required `.env` Keys

```
ANTHROPIC_API_KEY=           # Anthropic API — also registered in OneCLI vault
ASSISTANT_NAME=              # Tia's display name
DISCORD_BOT_TOKEN=           # Tia's bot token
DISCORD_APPLICATION_ID=      # Tia's application ID
DISCORD_PUBLIC_KEY=          # Tia's public key
DISCORD_LUPE_BOT_TOKEN=      # Lupe's bot token
DISCORD_LUPE_APPLICATION_ID= # Lupe's application ID
DISCORD_LUPE_PUBLIC_KEY=     # Lupe's public key
DISCORD_SOFIA_BOT_TOKEN=     # Sofia's bot token
DISCORD_SOFIA_APPLICATION_ID=# Sofia's application ID
DISCORD_SOFIA_PUBLIC_KEY=    # Sofia's public key
DISCORD_ANTONIO_BOT_TOKEN=   # Antonio's bot token
DISCORD_ANTONIO_APPLICATION_ID=# Antonio's application ID
DISCORD_ANTONIO_PUBLIC_KEY=  # Antonio's public key
BRAVE_API_KEY=               # Brave Search API (MCP server for all agents)
DOCKER_HOST=                 # Docker socket path
ONECLI_URL=                  # OneCLI gateway URL (default: http://127.0.0.1:10254)
```

---

## §4 — Key Paths Reference

| What | Where |
|------|-------|
| NanoClaw logs | `~/Library/Logs/nanoclaw.log`, `nanoclaw.error.log` |
| Argus logs | `~/Library/Logs/nanoclaw-restart.log`, `nanoclaw-healthcheck.log` |
| Backup logs | `~/Library/Logs/nanoclaw-backup-status.json`, `nanoclaw-cloud-backup-status.json` |
| Session DBs | `data/v2-sessions/<agent-group>/<session>/` |
| Central DB | `data/v2.db` |
| Container env | `data/env/env` (copy of `.env`) |
| Tia's workspace | `groups/discord_main/` |
| Lupe's workspace | `groups/discord_lupe/` |
| Sofia's workspace | `groups/discord_sofia/` |
| Antonio's workspace | `groups/discord_antonio/` |
| OneCLI web UI | `http://127.0.0.1:10254` |
| Backup script | `/usr/local/bin/nanoclaw-backup.sh` |
| Cloud backup script | `/usr/local/bin/nanoclaw-cloud-backup.sh` |
| Backup volume | `/Volumes/nanoclaw_backup/` |

---

## §5 — If Things Go Wrong

**Service won't start (EX_CONFIG)**
```bash
launchctl enable gui/$(id -u)/com.nanoclaw-v2-58dc102f
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw-v2-58dc102f.plist
```
Note: `StandardOutPath`/`StandardErrorPath` in the plist must point to `~/Library/Logs/`, not `/Volumes/` — launchd rejects paths on external volumes.

**Docker unhealthy after restart**
```bash
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
No container restart needed.

**Cloud backup auth expired**
```bash
proton-drive auth login   # browser popup appears — click to authenticate
```

**Agent `general` destination missing after restore**

Lupe:
```bash
pnpm exec tsx scripts/q.ts data/v2.db "INSERT OR REPLACE INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at) VALUES ('ag-1778023201501-lupe01','general','channel','mg-1778023201513-lupe03',datetime('now'))"
```

Sofia:
```bash
pnpm exec tsx scripts/q.ts data/v2.db "INSERT OR REPLACE INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at) VALUES ('ag-1779908367249-sofia1','general','channel','mg-1779910982959-sofia03',datetime('now'))"
```

Antonio:
```bash
pnpm exec tsx scripts/q.ts data/v2.db "INSERT OR REPLACE INTO agent_destinations (agent_group_id, local_name, target_type, target_id, created_at) VALUES ('ag-1781309289316-vfc6gv','general','channel','mg-1781309289330-u96ziq',datetime('now'))"
```

**Agent silently stops responding, container spawns then immediately exits (code 125)**

Means `docker run` itself failed — usually a per-group tagged image (see Step 5b) that no longer exists locally, e.g. after a `docker image prune`/`system prune`. The host retries silently on every wake with no user-visible error. Diagnose:

```bash
grep "code=125" ~/Library/Logs/nanoclaw.log | tail -5     # confirms the crash loop
docker images | grep <image-base-name>                     # per-group tag missing?
```

Fix: rebuild via `./bin/ncl groups restart --id <agent-group-id> --rebuild` (same as Step 5b).

**Backup volume not mounted**
Mount the Samsung T5 first, then re-run the backup script.

**13GB stuck in `/Library/Developer/CoreSimulator/Cryptex`**
Leftover from a failed iOS 17.4 simulator download. On next macOS system update: install Xcode from App Store, run `sudo xcrun simctl runtime delete all`, then remove Xcode again.
