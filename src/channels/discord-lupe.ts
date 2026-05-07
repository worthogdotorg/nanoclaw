/**
 * Lupe's Discord channel adapter — second Discord bot instance.
 * Uses DISCORD_LUPE_BOT_TOKEN / DISCORD_LUPE_APPLICATION_ID.
 * Registered as channel type 'discord-lupe' so it gets a distinct
 * slot in the channel registry and messaging_groups table from Tia's adapter.
 */
import { createDiscordAdapter } from '@chat-adapter/discord';

import { readEnvFile } from '../env.js';
import { createChatSdkBridge, type ReplyContext } from './chat-sdk-bridge.js';
import { registerChannelAdapter } from './channel-registry.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReplyContext(raw: Record<string, any>): ReplyContext | null {
  if (!raw.referenced_message) return null;
  const reply = raw.referenced_message;
  return {
    text: reply.content || '',
    sender: reply.author?.global_name || reply.author?.username || 'Unknown',
  };
}

registerChannelAdapter('discord-lupe', {
  factory: () => {
    const env = readEnvFile(['DISCORD_LUPE_BOT_TOKEN', 'DISCORD_LUPE_APPLICATION_ID', 'DISCORD_LUPE_PUBLIC_KEY']);
    if (!env.DISCORD_LUPE_BOT_TOKEN) return null;
    const discordAdapter = createDiscordAdapter({
      botToken: env.DISCORD_LUPE_BOT_TOKEN,
      applicationId: env.DISCORD_LUPE_APPLICATION_ID,
      publicKey: env.DISCORD_LUPE_PUBLIC_KEY,
    });
    // Override the adapter's name so the Chat SDK uses a separate dedup
    // namespace ('dedupe:discord-lupe:…') from Tia's adapter ('dedupe:discord:…').
    // Must be a direct own-property assignment — a Proxy doesn't work because
    // the adapter calls chat.handleIncomingMessage(this, …) internally, and
    // `this` bypasses any Proxy wrapper, so `adapter.name` inside the SDK
    // still sees the original 'discord' value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (discordAdapter as any).name = 'discord-lupe';
    return createChatSdkBridge({
      adapter: discordAdapter,
      channelType: 'discord-lupe',
      concurrency: 'concurrent',
      botToken: env.DISCORD_LUPE_BOT_TOKEN,
      extractReplyContext,
      supportsThreads: true,
    });
  },
});
