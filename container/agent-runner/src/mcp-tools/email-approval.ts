/**
 * Email send approval MCP tool.
 *
 * The container agent calls `request_email_send` instead of sending directly.
 * This writes a system action to outbound.db; the host picks it up, DMs Kiko
 * an Approve/Reject card, and only sends the email after explicit approval.
 * The send itself happens on the host — the container can never send directly.
 */
import { writeMessageOut } from '../db/messages-out.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

export const requestEmailSend: McpToolDefinition = {
  tool: {
    name: 'request_email_send',
    description:
      'Submit an email for Kiko\'s approval before sending. Always call compose_draft first and show the draft to Kiko. Only call this after Kiko has approved the draft. The email will not be sent until Kiko clicks Approve in Discord.',
    inputSchema: {
      type: 'object' as const,
      required: ['to', 'subject', 'body'],
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        inReplyTo: { type: 'string', description: 'Message-ID for threading' },
        references: { type: 'string', description: 'References header for threading' },
      },
    },
  },
  async handler(args) {
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;

    if (!to || !subject || !body) return err('to, subject, and body are required');

    const requestId = generateId();
    await writeMessageOut({
      id: requestId,
      kind: 'system',
      content: JSON.stringify({
        action: 'send_proton_email',
        to,
        subject,
        body,
        inReplyTo: (args.inReplyTo as string) || null,
        references: (args.references as string) || null,
      }),
    });

    return ok(
      `Email send request submitted — Kiko will be asked to approve in Discord before it goes out.\n` +
      `To: ${to}\nSubject: ${subject}`,
    );
  },
};

registerTools([requestEmailSend]);
