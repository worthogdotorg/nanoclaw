---
name: add-proton-email
description: Add Proton Mail (via Proton Mail Bridge) as an MCP email tool for an agent group. Gives the agent read (IMAP) and send (SMTP) access to a Proton Mail address. The agent always composes a draft for user approval before sending.
---

# Add Proton Email Tool

Wires a custom IMAP/SMTP MCP server into an agent group via Proton Mail Bridge.

**Prerequisites:**
- Proton Mail Bridge installed and running on the host Mac
- The target email address added to Bridge (signed in, fully synced)
- Bridge IMAP port 1143 and SMTP port 1025 accessible on 127.0.0.1
- The Bridge-generated password for the address

**Tools the agent gets** (surfaced as `mcp__proton-email__<name>`):
- `list_inbox` — list recent messages
- `search_emails` — search by text
- `read_email` — read a message by UID
- `compose_draft` — compose a draft for review (does NOT send)
- `send_email` — send after user approval

**Draft-first policy:** `compose_draft` never sends — it returns the draft text for the agent to show the user. Only `send_email` delivers. This is enforced in the tool descriptions so the agent respects it.

## Phase 1: Copy the MCP server

```bash
SKILL_DIR="${CLAUDE_SKILL_DIR}"
GROUP_DIR="groups/discord_main"   # adjust for other groups

mkdir -p "$GROUP_DIR/mcp-servers/proton-email"
cp "$SKILL_DIR/server/index.mjs" "$GROUP_DIR/mcp-servers/proton-email/index.mjs"
```

The server source lives in the group workspace, mounted read-write at `/workspace/agent/` inside the container. No image bake-in needed.

## Phase 2: Install dependencies

The MCP server requires three Node packages installed globally via pnpm in the per-group image: `imapflow`, `nodemailer`, and `@modelcontextprotocol/sdk`.

Check what's already in the group's npm packages:

```bash
GROUP_ID="ag-1777855064068-wl1sog"   # Tia — adjust for other groups
pnpm exec tsx scripts/q.ts data/v2.db \
  "SELECT packages_npm FROM container_configs WHERE agent_group_id='$GROUP_ID'"
```

For each package not already listed, add it via the self-mod tool or directly:

```bash
pnpm exec tsx scripts/q.ts data/v2.db \
  "UPDATE container_configs SET packages_npm=json_insert(packages_npm,'\$[#]','imapflow'), updated_at=datetime('now') WHERE agent_group_id='$GROUP_ID'"
pnpm exec tsx scripts/q.ts data/v2.db \
  "UPDATE container_configs SET packages_npm=json_insert(packages_npm,'\$[#]','nodemailer'), updated_at=datetime('now') WHERE agent_group_id='$GROUP_ID'"
pnpm exec tsx scripts/q.ts data/v2.db \
  "UPDATE container_configs SET packages_npm=json_insert(packages_npm,'\$[#]','@modelcontextprotocol/sdk'), updated_at=datetime('now') WHERE agent_group_id='$GROUP_ID'"
```

Then rebuild the per-group image (reads packages_npm from DB):

```bash
# From NanoClaw project root — runs buildAgentGroupImage via the self-mod path
# or trigger manually via ncl groups restart --rebuild --id $GROUP_ID
```

## Phase 3: Register the MCP server

Store credentials in the mcpServers env in the DB. The Bridge password is a locally-generated credential for a local service — storing it in the container config DB has the same threat model as `.env`.

```bash
GROUP_ID="ag-1777855064068-wl1sog"
BRIDGE_EMAIL="info@worthog.org"
BRIDGE_PASSWORD="<bridge-generated-password>"

ncl groups config add-mcp-server \
  --id "$GROUP_ID" \
  --name proton-email \
  --command node \
  --args '["/workspace/agent/mcp-servers/proton-email/index.mjs"]' \
  --env "{\"BRIDGE_EMAIL\":\"$BRIDGE_EMAIL\",\"BRIDGE_PASSWORD\":\"$BRIDGE_PASSWORD\",\"BRIDGE_HOST\":\"host.docker.internal\"}"
```

## Phase 4: Rebuild and restart

```bash
# Rebuild per-group image with new packages
GROUP_ID="ag-1777855064068-wl1sog"
ncl groups restart --id "$GROUP_ID" --rebuild \
  --message "Proton email MCP server is now available. Test it by listing your inbox."
```

## Phase 5: Verify

Ask the agent: **"Check my email at info@worthog.org"**

Expected: agent calls `mcp__proton-email__list_inbox` and returns recent messages.

If it fails, check:
- Bridge is running: `ps aux | grep -i bridge`
- Bridge port is listening: `nc -z 127.0.0.1 1143 && echo ok`
- Correct password — regenerate in Bridge app if needed
- Per-group image was rebuilt with the three npm packages

## Removal

1. `ncl groups config remove-mcp-server --id <group-id> --name proton-email`
2. Remove from packages_npm in DB (reverse of Phase 2 inserts)
3. `rm -rf groups/discord_main/mcp-servers/proton-email/`
4. Rebuild per-group image

## Notes

- **Bridge must stay running** on the host for the tools to work. If Bridge quits, the MCP server gets connection refused and returns errors. Add Bridge to Login Items on macOS.
- **Docker networking — use `host.docker.internal`:** Containers cannot reach `127.0.0.1` on the host (that loopback resolves to the container itself). Docker Desktop on macOS provides `host.docker.internal` as the hostname for the host. Always set `BRIDGE_HOST=host.docker.internal` in the MCP server env — this is already included in the Phase 3 `--env` example above.
- **Module resolution:** the server uses `createRequire('/pnpm/global/5/node_modules/_shim.js')` — this targets pnpm 10's global store layout. If pnpm major version bumps the store layout number, update the path in `index.mjs`.
- **Split mode vs combined:** if Bridge is in split mode, each account gets its own port pair. Update `BRIDGE_IMAP_PORT` / `BRIDGE_SMTP_PORT` env vars accordingly.
- **TLS:** Bridge uses a self-signed certificate; the server sets `rejectUnauthorized: false`. This is safe for localhost-only connections.
