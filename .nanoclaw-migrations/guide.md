# NanoClaw Migration Guide

Generated: 2026-10-01
Base: 24922593e3f79552039449d679e92a9f216c21a0
HEAD at generation: b17c424a
Upstream: 6d8e0c91 (nanocoai/nanoclaw main)
Reference tag: `pre-sync-2026-10-01` (pushed to `fork`). "Copy from tag" below means
`git show pre-sync-2026-10-01:<path> > <path>`.

## Migration Plan

1. Start from clean `upstream/main` on branch `upgrade/2026-10`.
2. Install Tia's Discord adapter the upstream way (`upstream/channels:src/channels/discord.ts`,
   `@chat-adapter/discord` pinned as the add-discord skill says).
3. Re-add the `channelType` override to the Chat SDK bridge (needed by the extra bots).
4. Add the Lupe / Sofia / Antonio adapters.
5. Proton email approval (host module + container tool + skill), adapted to the new
   `registerDeliveryAction` signature.
6. Remaining small host/container customizations.
7. Copy docs, container skills, start.sh.
8. `pnpm install && pnpm run build && pnpm test`; agent-runner typecheck + `bun test`.

Risk areas: `chat-sdk-bridge.ts` and `container-runner.ts` were heavily reworked upstream —
re-implement intent, don't paste old hunks.

## Applied Skills

- `add-discord` — re-install Tia's adapter from `upstream/channels` (file `src/channels/discord.ts`,
  import in `src/channels/index.ts`, dep `@chat-adapter/discord` at the version the skill pins).
- Earlier merges of `skill/a2a-return-path`, `skill/setup-dynamic-context` leave no diff vs base;
  `skill/emacs` was reverted. Nothing to reapply.

Custom skills (copy as-is from tag):
- `.claude/skills/add-proton-email/` (SKILL.md + server/index.mjs)
- `container/skills/capabilities/SKILL.md`
- `container/skills/status/SKILL.md`

## Dropped (upstream now covers these)

- Mid-turn `<message>` accumulation in `providers/claude.ts` (+ `claude.dispatch.test.ts`) —
  upstream emits `text` events per assistant message.
- `<task time=…>` stale timestamp fix in `formatter.ts` — upstream uses `process_after ?? timestamp`.
- `materializeAttachments()` in `poll-loop.ts` — host `session-manager.ts` now writes attachment
  data into the session inbox.
- node@22 keg PATH fixes in `setup.sh`, `setup/install-node.sh`; `migrate-v2.sh` status parsing.
- Deletion of `groups/global/CLAUDE.md` — absent upstream.

## Customizations

### 1. Bridge `channelType` override (multi-bot Discord)

**Intent:** Run several Discord bots in one host, each with its own channel type
(`discord-lupe`, `discord-sofia`, `discord-antonio`). Existing DB rows (messaging_groups,
users `discord-<bot>:<id>`, user_roles) are keyed on these channel types — keep them working with
zero data changes. (Upstream's `instance` option keeps `channelType = 'discord'`, which would
orphan those rows; switching is a deliberate later step.)

**Files:** `src/channels/chat-sdk-bridge.ts`

**How to apply:** Add an optional `channelType?: string` to `ChatSdkBridgeConfig` (doc: override
the NanoClaw channel type; defaults to `adapter.name`). Wherever the bridge object sets
`channelType` (and `name`, if it falls back to `adapter.name`), use
`config.channelType ?? <upstream default>`. Make sure the registry key, Chat SDK state namespace
and webhook route stay distinct per bot (pass `instance: <same value>` too if upstream derives
those from `instance`).

### 2. Extra Discord bot adapters

**Intent:** Lupe (sysadmin), Sofia (finance), Antonio (product research) as separate bots.

**Files:** `src/channels/discord-lupe.ts`, `discord-sofia.ts`, `discord-antonio.ts`,
`src/channels/index.ts`

**How to apply:** Copy the three files from tag. Each reads `DISCORD_<BOT>_BOT_TOKEN`,
`_APPLICATION_ID`, `_PUBLIC_KEY`, creates `createDiscordAdapter(...)`, then **directly assigns**
`(discordAdapter as any).name = 'discord-<bot>'` (own-property assignment — a Proxy does not work
because the adapter calls `chat.handleIncomingMessage(this, …)`; this gives a separate dedup
namespace), and calls `createChatSdkBridge({ adapter, channelType: 'discord-<bot>',
concurrency: 'concurrent', botToken, extractReplyContext, supportsThreads: true })`.
Align with upstream's `discord.ts` where cheap (e.g. reuse its `DISCORD_DEFAULTS` /
forwarded-snapshot handling if the bridge config needs them). Append imports after
`./discord.js` in `src/channels/index.ts`:
`./discord-lupe.js`, `./discord-sofia.js`, `./discord-antonio.js`.

### 3. iMessage adapter file

**Intent:** Kept for possible future use; **not** imported in `channels/index.ts`.

**Files:** `src/channels/imessage.ts`, dep `chat-adapter-imessage@0.1.1`

**How to apply:** Copy from tag; add dep only if it builds cleanly. If it fails to compile against
the new bridge types, drop it and note it (it's inactive).

### 4. Discord attachment download by URL

**Intent:** Discord's Chat SDK adapter (4.26) had no `fetchData`, so attachments arrived without
bytes. Bridge falls back to downloading `att.url` on the host at receive time.

**Files:** `src/channels/chat-sdk-bridge.ts`

**How to apply:** First check whether the pinned `@chat-adapter/discord` now sets `fetchData` on
attachments. If yes — drop this. If no — in the attachment loop, after the `if (att.fetchData)`
branch add `else if (raw.url)` that `fetch()`es the URL and sets `entry.data` to base64,
logging a warning on non-OK / errors.

### 5. Proton email with host-enforced approval

**Intent:** Tia can read Proton mail (MCP server, per-group config) and request sends; the send
happens on the host only after Kiko approves in Discord. Container never has SMTP.

**Files:** `src/modules/email-approval/index.ts`, `src/modules/index.ts`,
`container/agent-runner/src/mcp-tools/email-approval.ts`,
`container/agent-runner/src/mcp-tools/index.ts`, `package.json`
(`nodemailer@9.0.1`, dev `@types/nodemailer@^8.0.1`)

**How to apply:** Copy both files from tag; add the two imports to the barrels.
Upstream `registerDeliveryAction` now requires a 3rd argument (guard spec or an `Unguarded`
declaration) — read `src/delivery.ts` and pick the variant matching how other modules register
host-acting actions (approval-gated send ⇒ most likely the unguarded declaration with a reason,
since the approval itself is the guard). Check `requestApproval` options and the
`registerApprovalHandler` callback signature in `src/modules/approvals/primitive.ts` still match
(`session`, `payload`, `notify`); adapt if renamed. SMTP creds come from the group's
`container_configs.mcp_servers['proton-email'].env` (`BRIDGE_EMAIL`, `BRIDGE_PASSWORD`,
`BRIDGE_SMTP_PORT` default 1025), host `127.0.0.1`, `secure:false`, `tls.rejectUnauthorized:false`.

### 6. Refresh destinations when container already running

**Intent:** Admin destination changes take effect without restarting a running container.

**Files:** `src/container-runner.ts`

**How to apply:** In `wakeContainer`, inside the `activeContainers.has(session.id)` early-return
branch, fire-and-forget the same refresh `spawnContainer` does:
if `agent_destinations` table exists, dynamic-import `write-destinations.js` and call
`writeDestinations(session.agent_group_id, session.id)`; swallow errors. Respect upstream's
now-async `hasTable` / `getAgentGroup`.

### 7. Threads see parent channel's scheduled tasks

**Intent:** Recurring tasks scheduled in a channel live in the channel session's inbound.db; a
thread session should still list them.

**Files:** `src/container-runner.ts` (`buildMounts`),
`container/agent-runner/src/mcp-tools/scheduling.ts` (`list_tasks`)

**How to apply:** Host: if `session.thread_id` ends in `:<segment>`, strip it to get the parent
thread id, look up the parent session (`findSessionForAgent(agentGroupId, messagingGroupId,
parentThreadId)` or upstream equivalent), and if its `inbound.db` exists mount it read-only at
`/workspace/parent-inbound.db`. Container: in `list_tasks`, factor the query into
`queryTasks(db, status)`, run it on the local DB, then if `/workspace/parent-inbound.db` exists
open it with `new Database(path, { readonly: true })`, `PRAGMA busy_timeout = 5000`,
`PRAGMA mmap_size = 0`, merge rows whose id isn't already present, sort by `process_after`,
close in `finally`. Check first whether upstream thread sessions already share the parent
session — if so, drop this.

### 8. Record resolved model + Haiku fallback

**Intent:** Ground-truth "which model is this session running" stored in session_state; agents
without a configured model default to Haiku (cost control).

**Files:** `container/agent-runner/src/providers/types.ts`, `providers/claude.ts`,
`db/session-state.ts`, `poll-loop.ts`

**How to apply:** `ProviderEvent` init variant gets `model?: string`. Claude provider yields
`model: (message as { model?: string }).model` on the `system/init` message. session-state adds
`resolved_model:<provider>` key with `getResolvedModel` / `setResolvedModel`. poll-loop calls
`setResolvedModel(providerName, event.model)` when handling `init`, and logs
`Session: <id> (model: <m>)`. In claude.ts the SDK `model` option falls back to
`'claude-haiku-4-5-20251001'` when the configured model is unset (upstream: `this.inference.model`).

### 9. Docs and misc files

Copy from tag as-is: `docs/backup.md`, `docs/recovery.md`, `docs/migration-2026-05-04.json`,
`start.sh`. Apply the model-ID text edits: `claude-sonnet-5` in
`container/agent-runner/src/mcp-tools/cli.instructions.md` examples and in
`.claude/skills/add-opencode/SKILL.md` (`OPENCODE_MODEL` examples) — only if those lines still
exist upstream.

## Data (never touched by the migration)

`groups/`, `data/`, `store/`, `.env`, OneCLI volumes, launchd plists, `~/nanoclaw-start.sh`.
After upgrade, rebuild the container image and per-group images
(`ncl groups restart --id ag-1777855064068-wl1sog --rebuild` for Tia's imapflow/nodemailer/ical.js).

## Upgrade log — 2026-10-01 (upstream 6d8e0c91)

Applied: add-discord (4.29.0), extra bots (Lupe/Sofia/Antonio — `channelType:` option removed,
`maxTextLength: 2000` added), Discord attachment URL fallback (4.29 still has no `fetchData`),
Proton email approval (async DB calls; `registerDeliveryAction(..., unguarded(...))`),
resolved-model recording + Haiku fallback, docs/skills/start.sh, cli.instructions model IDs.

Turned out unnecessary on this upstream — drop from future runs:
- #1 bridge `channelType` override — bridge derives `name`/`channelType` from `adapter.name`,
  which the extra-bot adapters already override.
- #3 iMessage file — upstream rebuilt iMessage (`/add-imessage`), legacy remote mode removed.
- #6 destination refresh — `ncl destinations add/remove` and `wirings create` now project
  destinations into live sessions (`projectDestinationsToSessions`).
- #7 parent-thread `list_tasks` — tasks moved to central `ncl tasks` with isolated sessions;
  the `list_tasks` MCP tool no longer exists.
- add-opencode SKILL.md model-ID edit — lines no longer present.

## Post-upgrade changes — 2026-10-01

### Extra Discord bots: one shared definition (replaces customization #2)

`src/channels/discord-bots.ts` registers every specialist bot from
`EXTRA_BOTS = ['lupe', 'sofia', 'antonio']`; `src/channels/index.ts` imports
`./discord.js` then `./discord-bots.js`. Each bot reads `DISCORD_<NAME>_BOT_TOKEN` /
`_APPLICATION_ID` / `_PUBLIC_KEY`, registers channel type `discord-<name>` (must stay
stable — DB rows are keyed on it), assigns `(adapter as any).name = 'discord-<name>'`
(own property, not a Proxy), reuses `unwrapForwardedSnapshot` from `discord.ts` for
forwarded messages, and passes `maxTextLength: 2000`. Copy the file as-is.

### Discord button clicks: decode the 4.29 custom_id (customization #10)

`@chat-adapter/discord` 4.29 encodes button custom_id as `<actionId>\n<value>`.
The Gateway interaction path in `src/channels/chat-sdk-bridge.ts`
(`handleForwardedEvent`) parsed it raw, so every approval card resolved to `"0\n0"`
and was ignored. Fix: exported helper `parseNcqCustomId(customId)` strips the
`\n<value>` suffix before splitting `ncq:<questionId>:<idx>`; tests in
`chat-sdk-bridge.test.ts` (`describe('parseNcqCustomId')`). **Drop when upstream fixes
it** — check whether upstream's interaction handler already splits on `\n`.

### Agent configuration (data, not code — survives upgrades)

All four agents: model `claude-sonnet-5-5`, effort `high` (full IDs, because aliases
like `sonnet` lag the newest model). **On every upgrade:** check the current model
list; if a newer Sonnet ships, bump with
`ncl groups config update --id <id> --model <new id>` and verify via
`session_state` key `resolved_model:claude` in each session's outbound.db.

Specialists (Lupe, Sofia, Antonio) share one setup: own channel engage pattern `.`;
#general engage `mention`, priority 0, sender_scope all, drop; channels
`unknown_sender_policy=strict`; DMs wired mention-sticky / known / accumulate with
`request_approval`; owner is a member; destinations `general`, `discord-general`,
`dm`, `tia`. Tia's #general pattern skips @mentions of all three bot IDs.

### Known upstream bugs (report, don't patch)

- `container/agent-runner/src/compact-instructions.ts` runs standalone and calls
  `getAllDestinations()` without registering a mailbox → PreCompact hook fails with
  "No agent mailbox registered" on every compaction.

### After every upgrade — checklist

1. Stamp the marker after the final commit: `pnpm exec tsx scripts/upgrade-state.ts set`.
2. Rebuild Tia's per-group image: `ncl groups restart --id ag-1777855064068-wl1sog --rebuild`.
3. Check the model policy (newest Sonnet, effort high, full IDs) — bump all four together.
4. **Update Lupe's monthly check to the new base commit:**
   `ncl tasks update --id monthly-upgrade-check-6c58 --group ag-1778023201501-lupe01 --prompt '…'`
   (replace `6d8e0c91` in both places with the new upstream commit, and drop carried
   patches from item 2 that upstream has fixed).
5. Re-check upstream issues #3456 (button custom_id) and #3984 (PreCompact hook); drop
   `parseNcqCustomId` once upstream decodes `\n<value>` itself.
