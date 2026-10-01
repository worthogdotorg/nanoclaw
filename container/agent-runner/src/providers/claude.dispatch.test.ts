import { describe, expect, it, mock } from 'bun:test';

// Regression test for a real production bug: the SDK's 'result' message only
// carries the *last* assistant text segment of a turn. If the agent emits a
// correctly-wrapped <message to="..."> block and then does more tool work
// (e.g. retries a failed file edit) before the turn ends, that earlier block
// never appears in `message.result` — and was silently never dispatched.
// ClaudeProvider.query() must instead accumulate every assistant text block
// seen during the turn, not just trust the SDK's own summarized result text.

async function* fakeSdkStream() {
  yield { type: 'system', subtype: 'init', session_id: 'sess-fake' };

  // The agent composes and wraps its real deliverable output first.
  yield {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '<message to="discord-general">real content</message>' }],
    },
  };

  // Then does unrelated follow-up tool work (e.g. fixing a tracking file)
  // after already having composed the message above.
  yield {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit', input: {} }],
    },
  };

  // The turn's *final* text has no <message> block — this is what the SDK's
  // own `result` field reflects.
  yield {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '<internal>logged it</internal>' }],
    },
  };

  yield { type: 'result', result: '<internal>logged it</internal>' };
}

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => fakeSdkStream(),
}));

const { ClaudeProvider } = await import('./claude.js');

describe('ClaudeProvider.query — turn text accumulation', () => {
  it('does not drop a <message> block emitted before trailing tool work', async () => {
    const provider = new ClaudeProvider();
    const q = provider.query({ prompt: 'go', cwd: '/workspace/agent' });

    let resultText: string | null | undefined;
    for await (const event of q.events) {
      if (event.type === 'result') {
        resultText = event.text;
      }
    }

    expect(resultText).toContain('<message to="discord-general">real content</message>');
  });
});
