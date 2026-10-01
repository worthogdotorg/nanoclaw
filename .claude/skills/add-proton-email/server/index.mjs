#!/usr/bin/env node
/**
 * proton-email MCP server
 *
 * Connects to Proton Mail Bridge running on localhost.
 * Exposes IMAP (read/search) and SMTP (draft/send) tools.
 *
 * Environment variables:
 *   BRIDGE_EMAIL      — email address (e.g. info@worthog.org)
 *   BRIDGE_PASSWORD   — Bridge-generated password
 *   BRIDGE_HOST       — Bridge host (default: 127.0.0.1)
 *   BRIDGE_IMAP_PORT  — IMAP port (default: 1143)
 *   BRIDGE_SMTP_PORT  — SMTP port (default: 1025)
 *
 * Dependencies: imapflow, nodemailer, @modelcontextprotocol/sdk
 * Installed in container via install_packages (pnpm global).
 * Module resolution uses the known pnpm global path.
 */

import { createRequire } from 'module';

// All deps installed globally via pnpm — resolve from the global node_modules root.
const requireGlobal = createRequire('/pnpm/global/5/node_modules/_shim.js');
const { ImapFlow }  = requireGlobal('imapflow');
const { Server }    = requireGlobal('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = requireGlobal('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = requireGlobal('@modelcontextprotocol/sdk/types.js');

// ── Config ────────────────────────────────────────────────────────────────────

const EMAIL    = process.env.BRIDGE_EMAIL;
const PASSWORD = process.env.BRIDGE_PASSWORD;
const HOST     = process.env.BRIDGE_HOST      ?? '127.0.0.1';
const IMAP_PORT = Number(process.env.BRIDGE_IMAP_PORT ?? 1143);

if (!EMAIL || !PASSWORD) {
  process.stderr.write('[proton-email] BRIDGE_EMAIL and BRIDGE_PASSWORD are required\n');
  process.exit(1);
}

// ── IMAP helpers ──────────────────────────────────────────────────────────────

function imapClient() {
  return new ImapFlow({
    host: HOST,
    port: IMAP_PORT,
    secure: false,           // Bridge uses STARTTLS on 1143
    auth: { user: EMAIL, pass: PASSWORD },
    logger: false,
    tls: { rejectUnauthorized: false },  // Bridge uses self-signed cert
  });
}

async function withImap(fn) {
  const client = imapClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

function snippet(text, len = 120) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, len);
}

// Strip HTML tags for plain-text display
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchMessages(client, searchCriteria, limit) {
  await client.mailboxOpen('INBOX');
  const uids = await client.search(searchCriteria, { uid: true });
  if (!Array.isArray(uids) || !uids.length) return [];
  const recent = uids.slice(-limit).reverse();
  const results = [];
  for await (const msg of client.fetch(recent, {
    uid: true, envelope: true, bodyStructure: true,
  }, { uid: true })) {
    results.push({
      uid: msg.uid,
      from: msg.envelope.from?.[0]?.address ?? '(unknown)',
      subject: msg.envelope.subject ?? '(no subject)',
      date: msg.envelope.date?.toISOString() ?? '',
    });
  }
  return results;
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function listInbox({ limit = 20, unreadOnly = true }) {
  return withImap(client => fetchMessages(client, unreadOnly ? { seen: false } : { all: true }, limit));
}

async function searchEmails({ query, limit = 10 }) {
  return withImap(client => fetchMessages(client, { body: query }, limit));
}

async function readEmail({ uid }) {
  return withImap(async client => {
    await client.mailboxOpen('INBOX');
    let body = null;
    for await (const msg of client.fetch([uid], {
      uid: true, envelope: true, source: true,
    }, { uid: true })) {
      const raw = msg.source.toString();
      // Extract text/plain body — simple heuristic split on double CRLF after headers
      const parts = raw.split(/\r?\n\r?\n/);
      const textBody = parts.slice(1).join('\n\n');
      body = {
        uid: msg.uid,
        from: msg.envelope.from?.[0]?.address ?? '(unknown)',
        to: msg.envelope.to?.map(a => a.address).join(', ') ?? '',
        subject: msg.envelope.subject ?? '(no subject)',
        date: msg.envelope.date?.toISOString() ?? '',
        messageId: msg.envelope.messageId ?? '',
        body: snippet(stripHtml(textBody), 4000),
      };
    }
    if (!body) throw new Error(`Message UID ${uid} not found`);
    return body;
  });
}

function composeDraft({ to, subject, body, inReplyTo = null }) {
  // Returns a formatted draft for review — does NOT send.
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    '',
    body,
  ].filter(l => l !== null);
  return {
    draft: lines.join('\n'),
    note: 'Draft composed — call send_email to deliver after approval.',
  };
}

// ── MCP server ────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_inbox',
    description: 'List messages in the inbox. By default returns only unread messages. Set unreadOnly=false to see all messages.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max messages to return (default 20)' },
        unreadOnly: { type: 'boolean', description: 'If true (default), return only unread messages. Set false to see all.' },
      },
    },
  },
  {
    name: 'search_emails',
    description: 'Search inbox for messages matching a text query.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search text (subject, body, sender)' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'read_email',
    description: 'Read the full content of a message by UID.',
    inputSchema: {
      type: 'object',
      required: ['uid'],
      properties: {
        uid: { type: 'number', description: 'Message UID from list_inbox or search_emails' },
      },
    },
  },
  {
    name: 'compose_draft',
    description: 'Compose a draft email for review. Returns the draft text — does NOT send. Always call this first and show the draft to the user. After the user approves, call request_email_send (a separate built-in tool) to submit for approval and delivery.',
    inputSchema: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        inReplyTo: { type: 'string', description: 'Message-ID of message being replied to' },
      },
    },
  },
];

const server = new Server(
  { name: 'proton-email', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case 'list_inbox':    result = await listInbox(args ?? {}); break;
      case 'search_emails': result = await searchEmails(args); break;
      case 'read_email':    result = await readEmail(args); break;
      case 'compose_draft': result = composeDraft(args); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
