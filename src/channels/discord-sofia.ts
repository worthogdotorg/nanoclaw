/**
 * Sofia's Discord channel adapter — third Discord bot instance.
 * Uses DISCORD_SOFIA_BOT_TOKEN / DISCORD_SOFIA_APPLICATION_ID.
 * Registered as channel type 'discord-sofia' so it gets a distinct
 * slot in the channel registry and messaging_groups table from Tia's and Lupe's adapters.
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

registerChannelAdapter('discord-sofia', {
  factory: () => {
    const env = readEnvFile(['DISCORD_SOFIA_BOT_TOKEN', 'DISCORD_SOFIA_APPLICATION_ID', 'DISCORD_SOFIA_PUBLIC_KEY']);
    if (!env.DISCORD_SOFIA_BOT_TOKEN) return null;
    const discordAdapter = createDiscordAdapter({
      botToken: env.DISCORD_SOFIA_BOT_TOKEN,
      applicationId: env.DISCORD_SOFIA_APPLICATION_ID,
      publicKey: env.DISCORD_SOFIA_PUBLIC_KEY,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (discordAdapter as any).name = 'discord-sofia';
    return createChatSdkBridge({
      adapter: discordAdapter,
      concurrency: 'concurrent',
      botToken: env.DISCORD_SOFIA_BOT_TOKEN,
      extractReplyContext,
      supportsThreads: true,
      // Discord rejects messages over 2000 chars — split instead of failing.
      maxTextLength: 2000,
    });
  },
});
