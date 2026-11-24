import { createHmac } from 'node:crypto';
import { env } from '../config/env';
import { randomToken, safeEqual } from '../core/crypto';

/** What a verified gateway notification tells us, whichever provider sent it. */
export interface GatewayEvent {
  eventId: string;
  type: 'captured' | 'failed';
  providerOrderId: string;
  providerPaymentId: string;
  amountPaise: number;
  currency: string;
}

/**
 * Payment provider interface. Razorpay, Cashfree, PayU etc. plug in here without touching orders.
 * Nothing in the app marks money as received except a notification that passed `verifyWebhook`.
 */
export interface PaymentGateway {
  name: string;
  testMode: boolean;
  createOrder(input: { paymentNo: string; amountPaise: number }): Promise<{ providerOrderId: string }>;
  /** Returns the event only if the signature over the raw body is valid; otherwise null. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent | null;
  /** `key` makes retries safe: the same key never refunds twice. */
  refund(input: { providerPaymentId: string; amountPaise: number; key: string }): Promise<{ providerRefundId: string }>;
}

// Derived, purpose-specific key, so a sandbox signature is useless anywhere else.
const sandboxKey = () => createHmac('sha256', env.JWT_ACCESS_SECRET).update('payments:sandbox:webhook').digest();
export const sandboxSign = (body: Buffer) => createHmac('sha256', sandboxKey()).update(body).digest('hex');

/** Simulated gateway: exercises the same signed-webhook path as a real one. No real money moves. */
const sandbox: PaymentGateway = {
  name: 'sandbox',
  testMode: true,
  async createOrder() {
    return { providerOrderId: `sbx_order_${randomToken(12)}` };
  },
  verifyWebhook(raw, signature) {
    if (!signature || !safeEqual(signature, sandboxSign(raw))) return null;
    try {
      return JSON.parse(raw.toString('utf8')) as GatewayEvent;
    } catch {
      return null;
    }
  },
  async refund({ key }) {
    return { providerRefundId: `sbx_refund_${key}` };
  },
};

const gateways: Record<string, PaymentGateway> = { sandbox };

/** The active gateway, or null when online payments are switched off. */
export const activeGateway = (): PaymentGateway | null => (env.PAYMENT_DRIVER === 'none' ? null : (gateways[env.PAYMENT_DRIVER] ?? null));
/** Only the configured provider's webhooks are accepted. */
export const gatewayByName = (name: string) => (env.PAYMENT_DRIVER === name ? (gateways[name] ?? null) : null);
