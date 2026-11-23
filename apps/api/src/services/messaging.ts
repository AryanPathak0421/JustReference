import { DevMessageModel } from '../models/system';
import { logger } from '../config/logger';
import { env } from '../config/env';

export type Channel = 'whatsapp' | 'sms' | 'email';

export interface OutboundMessage {
  channel: Channel;
  to: string;
  subject?: string;
  text: string;
}

/** Provider interface. Real drivers (MSG91, Twilio, Meta WhatsApp Cloud, SES…) plug in here in Phase 6. */
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

const drivers: Record<typeof env.MESSAGING_DRIVER, MessagingDriver> = { console: consoleDriver };

export const messaging: MessagingDriver = drivers[env.MESSAGING_DRIVER];
