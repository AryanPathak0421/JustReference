import nodemailer, { type Transporter } from 'nodemailer';
import { DevMessageModel } from '../models/system';
import { AppError } from '../core/errors';
import { logger } from '../config/logger';
import { env } from '../config/env';

export type Channel = 'whatsapp' | 'sms' | 'email';

export interface OutboundMessage {
  channel: Channel;
  to: string;
  subject?: string;
  text: string;
}

export interface MessagingDriver {
  send(msg: OutboundMessage): Promise<void>;
}

/**
 * Development driver: stores messages in a dev-only outbox (GET /api/v1/dev/outbox) instead of sending.
 * Message bodies are never written to logs, because they contain OTPs.
 */
const consoleDriver: MessagingDriver = {
  async send(msg) {
    await DevMessageModel.create({ channel: msg.channel, to: msg.to, subject: msg.subject, body: msg.text });
    logger.info({ channel: msg.channel }, 'Message stored in dev outbox (console messaging driver)');
  },
};

let smtp: Transporter | undefined;
const gateways = { sms: () => ({ url: env.SMS_HTTP_URL, token: env.SMS_HTTP_TOKEN }), whatsapp: () => ({ url: env.WHATSAPP_HTTP_URL, token: env.WHATSAPP_HTTP_TOKEN }) };

/** Which channels can really deliver. Credentials live only in the server's environment. */
export const channelsReady = (): Record<Channel, boolean> =>
  env.MESSAGING_DRIVER === 'console' ? { email: false, sms: false, whatsapp: false } : { email: !!(env.SMTP_URL && env.MAIL_FROM), sms: !!env.SMS_HTTP_URL, whatsapp: !!env.WHATSAPP_HTTP_URL };

/**
 * Live driver: email over SMTP; SMS and WhatsApp through an HTTP endpoint that accepts
 * `POST { to, text }` with a bearer token (MSG91, Gupshup, Twilio or Meta behind a small adapter).
 */
const liveDriver: MessagingDriver = {
  async send(msg) {
    if (!channelsReady()[msg.channel]) throw new AppError(503, 'CHANNEL_OFF', 'Messages can’t be sent on this channel yet');
    try {
      if (msg.channel === 'email') {
        smtp ??= nodemailer.createTransport(env.SMTP_URL, { connectionTimeout: 10_000, socketTimeout: 15_000 } as never);
        await smtp.sendMail({ from: env.MAIL_FROM, to: msg.to, subject: msg.subject ?? '', text: msg.text });
        return;
      }
      const { url, token } = gateways[msg.channel]();
      const res = await fetch(url!, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ to: msg.to, text: msg.text }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (!res.ok) throw new Error(`Gateway answered ${res.status}`);
    } catch (err) {
      // Neither the recipient nor the text is logged.
      logger.error({ channel: msg.channel, reason: (err as Error).name }, 'Message delivery failed');
      throw new AppError(502, 'DELIVERY_FAILED', 'The message could not be sent. Please try again shortly.');
    }
  },
};

export const messaging: MessagingDriver = env.MESSAGING_DRIVER === 'live' ? liveDriver : consoleDriver;
