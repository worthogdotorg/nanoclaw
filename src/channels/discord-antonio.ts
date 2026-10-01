/**
 * Antonio's Discord channel adapter — fourth Discord bot instance.
 * Uses DISCORD_ANTONIO_BOT_TOKEN / DISCORD_ANTONIO_APPLICATION_ID.
 * Registered as channel type 'discord-antonio' so it gets a distinct
 * slot in the channel registry and messaging_groups table from the other adapters.
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

registerChannelAdapter('discord-antonio', {
  factory: () => {
    const env = readEnvFile([
      'DISCORD_ANTONIO_BOT_TOKEN',
      'DISCORD_ANTONIO_APPLICATION_ID',
      'DISCORD_ANTONIO_PUBLIC_KEY',
    ]);
    if (!env.DISCORD_ANTONIO_BOT_TOKEN) return null;
    const discordAdapter = createDiscordAdapter({
      botToken: env.DISCORD_ANTONIO_BOT_TOKEN,
      applicationId: env.DISCORD_ANTONIO_APPLICATION_ID,
      publicKey: env.DISCORD_ANTONIO_PUBLIC_KEY,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (discordAdapter as any).name = 'discord-antonio';
    return createChatSdkBridge({
      adapter: discordAdapter,
      concurrency: 'concurrent',
      botToken: env.DISCORD_ANTONIO_BOT_TOKEN,
      extractReplyContext,
      supportsThreads: true,
      // Discord rejects messages over 2000 chars — split instead of failing.
      maxTextLength: 2000,
    });
  },
});
