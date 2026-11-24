import type { Types } from 'mongoose';
import { EXTERNAL_CHANNELS, type NotificationEvent } from '@jr/shared';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { NotificationModel } from '../models/comms';
import { OrderModel, PaymentModel } from '../models/commerce';
import { VendorModel } from '../models/vendor';
import { UserModel } from '../models/user';
import { channelsReady, messaging } from './messaging';
import { getSettings } from './settings';

type Id = Types.ObjectId | string;
export interface Notice { event: NotificationEvent; title: string; body?: string; link?: string; /** Same key = same notice: never sent twice. */ key: string }

/**
 * Tell someone something happened. Call only after the change has been committed.
 * Never throws: a notification problem must not fail the action that caused it.
 */
export async function notify(userId: Id | null | undefined, n: Notice): Promise<void> {
  if (!userId) return;
  try {
    try {
      await NotificationModel.create({ userId, event: n.event, title: n.title.slice(0, 160), body: (n.body ?? '').slice(0, 500), link: n.link, key: n.key });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return; // already told
      throw e;
    }
    const s = await getSettings('notifications');
    const wanted = EXTERNAL_CHANNELS.filter((c) => s.events[n.event]?.[c] && (env.MESSAGING_DRIVER === 'console' || channelsReady()[c]));
    if (!wanted.length) return;
    const [user, general] = await Promise.all([UserModel.findOne({ _id: userId, status: 'active' }, { name: 1, email: 1, mobile: 1 }).lean(), getSettings('general')]);
    if (!user) return;
    const vars: Record<string, string> = { title: n.title, body: n.body ?? '', name: user.name.split(' ')[0]!, site: general.siteName, link: n.link ? `${env.PUBLIC_WEB_URL}${n.link}` : env.PUBLIC_WEB_URL };
    const fill = (t: string) => t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).replace(/[ \t]+/g, ' ').trim();
    await Promise.allSettled(wanted.map((channel) => messaging.send({ channel, to: channel === 'email' ? user.email : user.mobile, subject: fill(s.emailSubject).replace(/[\r\n]/g, ' '), text: fill(s.template) })));
  } catch (err) {
    logger.error({ err, event: n.event }, 'Notification failed');
  }
}

/** The right panel link for someone: vendors and members see the same order at different addresses. */
export async function notifyOrder(orderId: Id, kind: 'status' | 'cancel_request' | 'cancel_declined' | 'refund') {
  const o = await OrderModel.findById(orderId).lean().catch(() => null);
  const v = o && (await VendorModel.findById(o.vendorId, { userId: 1 }).lean());
  if (!o || !v) return;
  const buyer = `/member/orders/${o._id}`;
  const seller = `/vendor/orders/${o._id}`;
  const base = `order:${o._id}`;
  if (kind === 'cancel_request') return notify(v.userId, { event: 'order', title: `Cancellation requested for ${o.orderNo}`, body: o.cancellation?.reason ?? '', link: seller, key: `${base}:cancel_request` });
  if (kind === 'cancel_declined') return notify(o.buyerUserId, { event: 'order', title: `Cancellation declined for ${o.orderNo}`, body: o.cancellation?.note ?? '', link: buyer, key: `${base}:cancel_declined` });
  if (kind === 'refund') return notify(o.buyerUserId, { event: 'payment', title: `Refund issued for ${o.orderNo}`, body: `Refunded so far: ₹${(o.refundedPaise / 100).toFixed(2)}`, link: buyer, key: `${base}:refund:${o.refundedPaise}` });
  await notify(o.buyerUserId, { event: 'order', title: `Order ${o.orderNo} is ${o.status}`, body: o.status === 'shipped' && o.tracking ? `${o.tracking.carrier} ${o.tracking.number}` : (o.items[0]?.name ?? ''), link: buyer, key: `${base}:${o.status}` });
  if (o.status === 'confirmed') await notify(v.userId, { event: 'order', title: `New order ${o.orderNo}`, body: o.items[0]?.name ?? '', link: seller, key: `${base}:new` });
  else if (o.confirmedAt && ['cancelled', 'refunded', 'completed'].includes(o.status)) await notify(v.userId, { event: 'order', title: `Order ${o.orderNo} is ${o.status}`, link: seller, key: `${base}:${o.status}` });
}

export async function notifyPayment(paymentId: Id) {
  const p = await PaymentModel.findById(paymentId).lean().catch(() => null);
  if (!p) return;
  const amount = `₹${(p.amountPaise / 100).toFixed(2)}`;
  if (p.status === 'failed') return notify(p.buyerUserId, { event: 'payment', title: `Payment of ${amount} failed`, body: p.paymentNo, link: `/member/pay/${p._id}`, key: `payment:${p._id}:failed` });
  if (p.status !== 'captured') return;
  await notify(p.buyerUserId, { event: p.purpose === 'topup' ? 'wallet' : 'payment', title: p.purpose === 'topup' ? `${amount} added to your wallet` : `Payment of ${amount} received`, body: p.paymentNo, link: p.purpose === 'topup' ? '/member/wallet' : `/member/pay/${p._id}`, key: `payment:${p._id}:captured` });
  for (const a of p.allocations) await notifyOrder(a.orderId!, 'status');
}
