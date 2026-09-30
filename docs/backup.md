# NanoClaw — Backup Scheme

**Last updated**: 2026-07-18
**Host**: Chorizo (macOS)

Two-layer backup: nightly T5 rsync (local) + nightly Proton Drive upload (cloud).

---

## T5 Rsync Backup

### How It Works

Incremental rsync with hard-linked snapshots. Each run creates a dated directory under `/Volumes/nanoclaw_backup/snapshots/`. Unchanged files share inodes with the previous snapshot — only deltas use new space.

| What | Where |
|------|-------|
| Backup root | `/Volumes/nanoclaw_backup/` (Samsung T5 — disk3) |
| Snapshots | `/Volumes/nanoclaw_backup/snapshots/YYYY-MM-DD/` |
| Latest symlink | `/Volumes/nanoclaw_backup/latest/` |
| Script | `/usr/local/bin/nanoclaw-backup.sh` |
| Script log | `/Volumes/nanoclaw_backup/backup.log` |
| launchd log | `~/Library/Logs/nanoclaw-backup.log` |
| Status file | `~/Library/Logs/nanoclaw-backup-status.json` |

### What Gets Backed Up

| Source | Snapshot path |
|--------|---------------|
| `/Volumes/overflow/nanoclaw-workspace/nanoclaw-v2/` (excl. `node_modules/`, `dist/`, `logs/`, `.git/`) | `<snapshot>/nanoclaw-v2/` |
| `~/nanoclaw-start.sh` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw-v2-58dc102f.plist` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw.healthcheck.plist` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw.backup.plist` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw.cloud-backup.plist` | `<snapshot>/home-files/` |
| `~/Library/LaunchAgents/com.nanoclaw.thermal-check.plist` | `<snapshot>/home-files/` |
| `~/.config/nanoclaw/mount-allowlist.json` | `<snapshot>/home-files/` |
| `/usr/local/bin/restart-nanoclaw.sh` | `<snapshot>/home-files/` |
| `/usr/local/bin/nanoclaw-backup.sh` | `<snapshot>/home-files/` |
| `/usr/local/bin/nanoclaw-cloud-backup.sh` | `<snapshot>/home-files/` |
| `/usr/local/bin/thermal-check.sh` | `<snapshot>/home-files/` |
| `/usr/local/bin/sync-musica.sh` | `<snapshot>/home-files/` |
| `~/Applications/NanoClawBackup.app` (Info.plist + main.scpt) | `<snapshot>/home-files/` |
| `~/.claude/` (excl. `*.jsonl`, `tool-results/`) | `<snapshot>/claude-memory/` |

### Schedule

Every 8 hours: **2:00 AM, 10:00 AM, 6:00 PM** via launchd (`com.nanoclaw.backup`).

Runs via `~/Applications/NanoClawBackup.app` — an AppleScript wrapper that must have **Full Disk Access** granted in System Settings → Privacy & Security, so launchd can write to the external APFS volume.

### Manual Run

```bash
/usr/local/bin/nanoclaw-backup.sh
```

### Checking Status

```bash
cat ~/Library/Logs/nanoclaw-backup-status.json
tail -20 /Volumes/nanoclaw_backup/backup.log
ls /Volumes/nanoclaw_backup/snapshots/
```

### Reload launchd Job (after editing plist)

```bash
launchctl bootout gui/$(id -u)/com.nanoclaw.backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.backup.plist
```

---

## Cloud Backup (Proton Drive)

Uploads the latest T5 snapshot to Proton Drive nightly, after the 2am rsync completes.

**Important — this is a mirror, not versioned history.** Every nightly run uploads with `-c replace`, overwriting Proton Drive's copy of `/my-files/NanoClaw/` in place. There is only ever **one** state on Proton Drive at any time: whatever the last successful 3am run produced. It is *not* a series of dated increments the way the T5 snapshots are — restoring from Proton Drive always gives you "as of last night," never an arbitrary earlier date. If you need a specific past date, that only exists on T5 (`snapshots/YYYY-MM-DD/`, subject to local retention) — cloud is the off-site copy of the *latest* state, not a time machine. See [docs/recovery.md](./recovery.md) for the restore procedure and what recovery point each source gives you.

| What | Where |
|------|-------|
| Script | `/usr/local/bin/nanoclaw-cloud-backup.sh` |
| Schedule | 3:00 AM daily via launchd (`com.nanoclaw.cloud-backup`) |
| Plist | `~/Library/LaunchAgents/com.nanoclaw.cloud-backup.plist` |
| Log | `~/Library/Logs/nanoclaw-cloud-backup.log` |
| Status file | `~/Library/Logs/nanoclaw-cloud-backup-status.json` |
| Proton destination | `/my-files/NanoClaw/` (nanoclaw-v2/, home-files/, claude-memory/) |
| CLI binary | `/usr/local/bin/proton-drive` |
| Auth credentials | `~/Library/Application Support/proton-drive-cli/` |

Flow: T5 rsync runs at 2am → cloud backup runs at 3am, reads from `/Volumes/nanoclaw_backup/latest/`, stages to `/tmp/nanoclaw-cloud-staging/` (symlinks dereferenced), uploads to Proton Drive.

### Authentication

Proton Drive uses browser-based OAuth. Sessions expire periodically. When auth expires, the backup fails fast with a notification to Lupe's Discord channel and a DM to Kiko.

To re-authenticate:
```bash
proton-drive auth login
```
A browser popup will appear — click it to authenticate. The next scheduled backup will succeed automatically.

### Manual Run

```bash
/usr/local/bin/nanoclaw-cloud-backup.sh           # incremental (normal)
/usr/local/bin/nanoclaw-cloud-backup.sh --full    # full wipe + fresh upload (quarterly)
```

### Checking Status

```bash
cat ~/Library/Logs/nanoclaw-cloud-backup-status.json
tail -20 ~/Library/Logs/nanoclaw-cloud-backup.log
```

### Housekeeping

The cloud backup uses `replace` conflict strategy — files removed locally accumulate on Proton over time (harmless). Run `--full` quarterly to wipe and re-upload clean.

### Reload launchd Job (after editing plist)

```bash
launchctl bootout gui/$(id -u)/com.nanoclaw.cloud-backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nanoclaw.cloud-backup.plist
```
