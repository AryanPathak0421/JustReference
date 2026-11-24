import PDFDocument from 'pdfkit';
import type { ClientSession } from 'mongoose';
import type { GstSummaryRow, InvoiceRow } from '@jr/shared';
import { InvoiceModel, type Invoice, type OrderDoc } from '../models/commerce';
import { VendorModel } from '../models/vendor';
import { ProfileModel } from '../models/member';
import { nextSequence } from '../models/system';

const IST = 5.5 * 3_600_000;
/** Indian financial year (April to March) in IST, e.g. "2627" for 2026-27. */
export function financialYear(d: Date) {
  const ist = new Date(d.getTime() + IST);
  const start = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

/**
 * GST numbering must be consecutive per seller and financial year, at most 16 characters.
 * V<seller>/<FY>/<n> for invoices, C… for credit notes, and a separate T… series for sandbox orders.
 */
async function nextNumber(vendorId: unknown, kind: 'V' | 'C', isTest: boolean, at: Date, session: ClientSession) {
  const code = await sellerCode(String(vendorId), session);
  const prefix = `${isTest ? 'T' : ''}${kind}${code}/${financialYear(at)}`;
  const n = await nextSequence(`invoice:${prefix}`, session);
  return `${prefix}/${String(n).padStart(4, '0')}`;
}

async function sellerCode(vendorId: string, session: ClientSession) {
  const v = await VendorModel.findById(vendorId, { sellerNo: 1 }).session(session);
  if (!v) throw new Error('Vendor not found');
  if (!v.sellerNo) {
    v.sellerNo = await nextSequence('sellerNo', session);
    await v.save({ session });
  }
  return v.sellerNo;
}

const sameState = (a?: string | null, b?: string | null) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

function split(gst: number, interState: boolean) {
  if (interState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: gst };
  const half = Math.floor(gst / 2);
  return { cgstPaise: half, sgstPaise: gst - half, igstPaise: 0 };
}

const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);

/** Issue the tax invoice (bill of supply if the seller isn't GST registered). One per order, inside the caller's transaction. */
export async function issueInvoice(order: OrderDoc, session: ClientSession) {
  const at = new Date();
  const v = await VendorModel.findById(order.vendorId).session(session);
  const profile = await ProfileModel.findOne({ userId: order.buyerUserId }, { gstin: 1 }).session(session);
  const a = order.address;
  const interState = !sameState(v!.state, a.state);
  const lines = order.items.map((i) => ({ name: i.name, qty: i.qty, gstRatePct: i.gstRatePct, taxablePaise: i.taxablePaise, ...split(i.gstPaise, interState), totalPaise: i.totalPaise }));
  await InvoiceModel.create([{
    invoiceNo: await nextNumber(order.vendorId, 'V', order.isTest, at, session),
    type: 'invoice', orderId: order._id, orderNo: order.orderNo, vendorId: order.vendorId, buyerUserId: order.buyerUserId,
    seller: { name: v!.businessName, address: [v!.officeAddress, v!.city, v!.pincode].filter(Boolean).join(', '), state: v!.state, gstin: v!.gstin },
    buyer: { name: a.name, address: [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', '), state: a.state, gstin: profile?.gstin },
    interState, lines,
    taxablePaise: sum(lines, (l) => l.taxablePaise), cgstPaise: sum(lines, (l) => l.cgstPaise), sgstPaise: sum(lines, (l) => l.sgstPaise), igstPaise: sum(lines, (l) => l.igstPaise),
    totalPaise: order.totalPaise, isTest: order.isTest, issuedAt: at,
  }], { session });
}

/** Credit note for a refund of an invoiced order; tax is reduced in the same proportion as the price. */
export async function issueCreditNote(order: OrderDoc, amountPaise: number, refundKey: string, session: ClientSession) {
  const inv = await InvoiceModel.findOne({ orderId: order._id, type: 'invoice' }).session(session).lean();
  if (!inv || amountPaise <= 0) return;
  const at = new Date();
  const tax = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
  const gst = Math.round((tax * amountPaise) / inv.totalPaise);
  const parts = split(gst, inv.interState);
  await InvoiceModel.create([{
    invoiceNo: await nextNumber(order.vendorId, 'C', order.isTest, at, session),
    type: 'credit_note', orderId: order._id, orderNo: order.orderNo, refundKey, vendorId: inv.vendorId, buyerUserId: inv.buyerUserId,
    seller: inv.seller, buyer: inv.buyer, interState: inv.interState, originalInvoiceNo: inv.invoiceNo,
    lines: [{ name: `Refund against ${inv.invoiceNo}`, qty: 1, gstRatePct: 0, taxablePaise: amountPaise - gst, ...parts, totalPaise: amountPaise }],
    taxablePaise: amountPaise - gst, ...parts, totalPaise: amountPaise, isTest: order.isTest, issuedAt: at,
  }], { session });
}

export const toInvoiceRow = (i: Invoice & { _id: unknown }): InvoiceRow => ({
  id: String(i._id), invoiceNo: i.invoiceNo, type: i.type, orderId: String(i.orderId), orderNo: i.orderNo, seller: i.seller.name ?? '', buyer: i.buyer.name ?? '',
  taxablePaise: i.taxablePaise, cgstPaise: i.cgstPaise, sgstPaise: i.sgstPaise, igstPaise: i.igstPaise, totalPaise: i.totalPaise, issuedAt: i.issuedAt.toISOString(), isTest: i.isTest,
});

/** Month-wise GST totals; credit notes are subtracted. */
export async function gstSummary(match: Record<string, unknown>): Promise<GstSummaryRow[]> {
  const signed = (f: string) => ({ $sum: { $cond: [{ $eq: ['$type', 'credit_note'] }, { $multiply: [`$${f}`, -1] }, `$${f}`] } });
  const rows = await InvoiceModel.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$issuedAt', timezone: 'Asia/Kolkata' } }, invoices: { $sum: 1 },
        taxablePaise: signed('taxablePaise'), cgstPaise: signed('cgstPaise'), sgstPaise: signed('sgstPaise'), igstPaise: signed('igstPaise'), totalPaise: signed('totalPaise'),
      },
    },
    { $sort: { _id: -1 } },
  ]);
  return rows.map(({ _id, ...r }) => ({ month: _id as string, ...r }) as GstSummaryRow);
}

// The built-in PDF fonts have no ₹ glyph and only cover Latin-1.
const rs = (p: number) => `Rs. ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const latin = (s: string | null | undefined) =>
  (s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/₹/g, 'Rs. ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

export function invoicePdf(i: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: i.invoiceNo, Author: 'JustReference' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    const title = i.type === 'credit_note' ? 'CREDIT NOTE' : i.seller.gstin ? 'TAX INVOICE' : 'BILL OF SUPPLY';
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0f1e46').text(title);
    if (i.isTest) doc.fontSize(10).fillColor('#b91c1c').text('TEST DOCUMENT: simulated payment, not valid for accounting or tax.');
    doc.moveDown(0.5).font('Helvetica').fontSize(9.5).fillColor('#222');
    doc.text(`Number: ${i.invoiceNo}`).text(`Date: ${i.issuedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}`).text(`Order: ${i.orderNo}`);
    if (i.originalInvoiceNo) doc.text(`Against invoice: ${i.originalInvoiceNo}`);
    const y = doc.y + 14;
    const party = (label: string, p: Invoice['seller'], x: number) => {
      doc.font('Helvetica-Bold').text(label, x, y, { width: 235 }).font('Helvetica').text(latin(p.name), { width: 235 }).text(latin(p.address), { width: 235 }).text(`State: ${latin(p.state)}`, { width: 235 }).text(`GSTIN: ${p.gstin || 'Not registered'}`, { width: 235 });
      return doc.y;
    };
    const bottom = Math.max(party('Sold by', i.seller, 48), party('Billed to', i.buyer, 310));
    doc.x = 48;
    doc.y = bottom + 10;
    doc.text(`Place of supply: ${latin(i.buyer.state)}${i.interState ? ' (inter-state)' : ''}`, 48);
    doc.y += 10;
    const cols = [48, 215, 250, 290, 365, 440];
    const widths = [160, 30, 36, 70, 70, 107];
    const row = (cells: string[], bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const h = Math.max(...cells.map((c, n) => doc.heightOfString(c, { width: widths[n] })));
      if (doc.y + h > 770) doc.addPage();
      const top = doc.y;
      cells.forEach((c, n) => doc.text(c, cols[n]!, top, { width: widths[n], align: n ? 'right' : 'left' }));
      doc.y = top + h + 6;
      doc.moveTo(48, doc.y - 3).lineTo(547, doc.y - 3).strokeColor('#dddddd').stroke();
    };
    row(['Item', 'Qty', 'GST', 'Taxable', 'Tax', 'Total'], true);
    for (const l of i.lines) row([latin(l.name), String(l.qty), l.gstRatePct ? `${l.gstRatePct}%` : '-', rs(l.taxablePaise!), rs(l.cgstPaise! + l.sgstPaise! + l.igstPaise!), rs(l.totalPaise!)]);
    doc.y += 8;
    const total = (k: string, v: number, bold = false) => {
      const top = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).text(k, 320, top, { width: 110 }).text(rs(v), 430, top, { width: 117, align: 'right' });
      doc.y = top + 16;
    };
    total('Taxable value', i.taxablePaise);
    if (i.interState) total('IGST', i.igstPaise);
    else { total('CGST', i.cgstPaise); total('SGST', i.sgstPaise); }
    total('Total', i.totalPaise, true);
    doc.y += 20;
    doc.font('Helvetica').fontSize(8).fillColor('#666').text('Computer-generated document issued through JustReference.in on behalf of the seller.', 48, doc.y, { width: 499 });
    doc.end();
  });
}
