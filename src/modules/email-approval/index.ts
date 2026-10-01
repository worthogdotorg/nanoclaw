/**
 * Email approval module.
 *
 * Intercepts `send_proton_email` system actions from the container agent,
 * presents an Approve/Reject card to Kiko via Discord, and — on approval —
 * sends the email from the host using the Bridge SMTP credentials stored in
 * the agent group's container config.
 *
 * The send never happens inside the container. Prompt injection can request
 * a send but cannot approve one.
 */
import nodemailer from 'nodemailer';
import { getContainerConfig } from '../../db/container-configs.js';
import { log } from '../../log.js';
import type { Session } from '../../types.js';
import { registerDeliveryAction } from '../../delivery.js';
import { notifyAgent, registerApprovalHandler, requestApproval } from '../approvals/index.js';
import { getAgentGroup } from '../../db/agent-groups.js';

// ── Delivery action: container wrote send_proton_email → queue approval ──

export async function handleSendProtonEmail(content: Record<string, unknown>, session: Session): Promise<void> {
  const agentGroup = getAgentGroup(session.agent_group_id);
  if (!agentGroup) {
    notifyAgent(session, 'send_proton_email failed: agent group not found.');
    return;
  }

  const to = content.to as string;
  const subject = content.subject as string;
  const body = content.body as string;

  if (!to || !subject || !body) {
    notifyAgent(session, 'send_proton_email failed: to, subject, and body are required.');
    return;
  }

  const preview = body.length > 300 ? body.slice(0, 300) + '…' : body;

  await requestApproval({
    session,
    agentName: agentGroup.name,
    action: 'send_proton_email',
    payload: {
      to,
      subject,
      body,
      inReplyTo: (content.inReplyTo as string) || null,
      references: (content.references as string) || null,
    },
    title: 'Email Send Request',
    question:
      `${agentGroup.name} wants to send an email:\n\n` +
      `**To:** ${to}\n` +
      `**Subject:** ${subject}\n\n` +
      `${preview}`,
  });
}

// ── Approval handler: Kiko clicked Approve → send from host ──

function getSmtpConfig(agentGroupId: string): {
  host: string;
  port: number;
  user: string;
  pass: string;
} | null {
  const configRow = getContainerConfig(agentGroupId);
  if (!configRow) return null;

  let servers: Record<string, { env?: Record<string, string> }>;
  try {
    servers = JSON.parse(configRow.mcp_servers);
  } catch {
    return null;
  }

  const protonEnv = servers['proton-email']?.env;
  if (!protonEnv?.BRIDGE_EMAIL || !protonEnv?.BRIDGE_PASSWORD) return null;

  return {
    // Bridge runs on the host — use 127.0.0.1 from host side, not host.docker.internal
    host: '127.0.0.1',
    port: Number(protonEnv.BRIDGE_SMTP_PORT ?? 1025),
    user: protonEnv.BRIDGE_EMAIL,
    pass: protonEnv.BRIDGE_PASSWORD,
  };
}

registerDeliveryAction('send_proton_email', handleSendProtonEmail);

registerApprovalHandler('send_proton_email', async ({ session, payload, notify }) => {
  const smtp = getSmtpConfig(session.agent_group_id);
  if (!smtp) {
    notify('Email send failed: proton-email MCP server not configured for this agent group.');
    return;
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: false,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false },
  });

  try {
    const mail: Record<string, unknown> = {
      from: smtp.user,
      to: payload.to as string,
      subject: payload.subject as string,
      text: payload.body as string,
    };
    if (payload.inReplyTo) mail.inReplyTo = payload.inReplyTo as string;
    if (payload.references) mail.references = payload.references as string;

    const info = await transport.sendMail(mail);
    log.info('Email sent via approval', { to: payload.to, subject: payload.subject, messageId: info.messageId });
    notify(`Email sent to ${payload.to as string}. Message ID: ${info.messageId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('Email send failed after approval', { err: e });
    notify(`Email send failed: ${msg}`);
  }
});
