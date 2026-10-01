/**
 * Extra Discord bots — one bot per specialist agent, alongside Tia's
 * `discord` adapter. Self-registers on import.
 *
 * Each bot reads DISCORD_<NAME>_BOT_TOKEN / _APPLICATION_ID / _PUBLIC_KEY and
 * registers as channel type `discord-<name>`. Existing messaging_groups,
 * users (`discord-<name>:<id>`) and user_roles rows are keyed on that channel
 * type, so it must stay stable. To add a bot, add its name to EXTRA_BOTS,
 * its three env vars to .env, and an owner role for `discord-<name>:<owner id>`.
 */
import { createDiscordAdapter } from '@chat-adapter/discord';

import { readEnvFile } from '../env.js';
import { createChatSdkBridge, type ReplyContext } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';
import { unwrapForwardedSnapshot } from './discord.js';

const EXTRA_BOTS = ['lupe', 'sofia', 'antonio'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReplyContext(raw: Record<string, any>): ReplyContext | null {
  if (!raw.referenced_message) return null;
  const reply = raw.referenced_message;
  return {
    text: reply.content || '',
    sender: reply.author?.global_name || reply.author?.username || 'Unknown',
  };
}

/** Same forwarded-message unwrapping Tia's adapter applies. */
function unwrapForwards(adapter: ReturnType<typeof createDiscordAdapter>): void {
  const a = adapter as unknown as {
    handleForwardedMessage: (data: Record<string, unknown>, options?: unknown) => Promise<void>;
  };
  const orig = a.handleForwardedMessage.bind(adapter);
  a.handleForwardedMessage = async (data, options) => {
    unwrapForwardedSnapshot(data);
    return orig(data, options);
  };
}

for (const bot of EXTRA_BOTS) {
  const channelType = `discord-${bot}`;
  const prefix = `DISCORD_${bot.toUpperCase()}`;

  registerChannelAdapter(channelType, {
    factory: () => {
      const env = readEnvFile([`${prefix}_BOT_TOKEN`, `${prefix}_APPLICATION_ID`, `${prefix}_PUBLIC_KEY`]);
      const botToken = env[`${prefix}_BOT_TOKEN`];
      if (!botToken) return null;
      const discordAdapter = createDiscordAdapter({
        botToken,
        applicationId: env[`${prefix}_APPLICATION_ID`],
        publicKey: env[`${prefix}_PUBLIC_KEY`],
      });
      unwrapForwards(discordAdapter);
      // Give the Chat SDK a separate dedup namespace per bot. Must be a direct
      // own-property assignment — the adapter calls
      // chat.handleIncomingMessage(this, …) internally, so a Proxy wrapper
      // would be bypassed and the SDK would still see 'discord'.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (discordAdapter as any).name = channelType;
      return createChatSdkBridge({
        adapter: discordAdapter,
        concurrency: 'concurrent',
        botToken,
        extractReplyContext,
        supportsThreads: true,
        // Discord rejects messages over 2000 chars — split instead of failing.
        maxTextLength: 2000,
      });
    },
  });
}
