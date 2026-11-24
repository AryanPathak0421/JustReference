import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Model, PipelineStage, Types } from 'mongoose';
import { REPORTS, type ReportColumn, type ReportKey } from '@jr/shared';
import { CommissionModel, LedgerModel, RewardModel, SettlementModel, TdsModel, WithdrawalModel } from '../models/finance';
import { InvoiceModel, OrderModel } from '../models/commerce';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { VendorModel } from '../models/vendor';

/** Whose records: one person's, or (admins) everyone's. */
export interface Scope { userId?: Types.ObjectId; vendorId?: Types.ObjectId; isTest: boolean }
type Doc = Record<string, never> & { [k: string]: unknown };
interface Def {
  model: Model<never>;
  dateField: string;
  match: (s: Scope) => Record<string, unknown>;
  search: string[];
  userField?: string;
  columns: ReportColumn[];
  row: (d: Doc, who: (id: unknown) => string) => Record<string, string | number | null>;
  /** Columns summed in the footer (database field → column). Sign: negative values allowed. */
  totals?: Record<string, unknown>;
  sort: Record<string, string>;
}
const money = (key: string, label: string): ReportColumn => ({ key, label, money: true });
const date = (key: string, label: string): ReportColumn => ({ key, label, date: true });
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null);
const person: ReportColumn = { key: 'person', label: 'Account' };

const ledger = (direction?: 'credit' | 'debit'): Def => ({
  model: LedgerModel as never, dateField: 'createdAt', userField: 'userId', search: ['txnId', 'description'],
  match: (s) => ({ isTest: s.isTest, ...(s.userId ? { userId: s.userId } : {}), ...(direction ? { direction } : {}) }),
  columns: [{ key: 'txnId', label: 'Transaction' }, date('date', 'Date'), person, { key: 'wallet', label: 'Wallet' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, money('credit', 'Credit'), money('debit', 'Debit'), money('balance', 'Balance')],
  row: (d, who) => ({ txnId: d.txnId as string, date: iso(d.createdAt), person: who(d.userId), wallet: d.wallet as string, category: d.category as string, description: d.description as string, credit: d.direction === 'credit' ? (d.amountPaise as number) : 0, debit: d.direction === 'debit' ? (d.amountPaise as number) : 0, balance: d.balanceAfterPaise as number }),
  totals: { credit: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amountPaise', 0] }, debit: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amountPaise', 0] } }, sort: { date: '_id', txnId: 'txnId', credit: 'amountPaise', debit: 'amountPaise' },
});
const orders = (side: 'sales' | 'purchases'): Def => ({
  model: OrderModel as never, dateField: 'confirmedAt', userField: 'buyerUserId', search: ['orderNo', 'items.name'],
  match: (s) => ({ isTest: s.isTest, confirmedAt: { $ne: null }, ...(side === 'purchases' && s.userId ? { buyerUserId: s.userId } : {}), ...(side === 'sales' && (s.userId || s.vendorId) ? { vendorId: s.vendorId ?? null } : {}) }),
  columns: [{ key: 'orderNo', label: 'Order' }, date('date', 'Confirmed'), { key: 'person', label: 'Buyer' }, { key: 'item', label: 'Item' }, { key: 'status', label: 'Status' }, money('taxable', 'Taxable'), money('gst', 'GST'), money('total', 'Total'), money('paid', 'Paid'), money('refunded', 'Refunded')],
  row: (d, who) => ({ orderNo: d.orderNo as string, date: iso(d.confirmedAt), person: who(d.buyerUserId), item: (d.items as { name: string }[])[0]?.name ?? '', status: d.status as string, taxable: d.subtotalPaise as number, gst: d.gstPaise as number, total: d.totalPaise as number, paid: d.paidPaise as number, refunded: d.refundedPaise as number }),
  totals: { taxable: '$subtotalPaise', gst: '$gstPaise', total: '$totalPaise', paid: '$paidPaise', refunded: '$refundedPaise' }, sort: { date: 'confirmedAt', orderNo: 'orderNo', total: 'totalPaise', status: 'status' },
});

const DEFS: Record<ReportKey, Def> = {
  credit: ledger('credit'), debit: ledger('debit'), wallet: ledger(), sales: orders('sales'), purchases: orders('purchases'),
  earnings: {
    model: CommissionModel as never, dateField: 'createdAt', userField: 'earnerUserId', search: ['orderNo', 'ruleName'], match: (s) => ({ isTest: s.isTest, ...(s.userId ? { earnerUserId: s.userId } : {}) }),
    columns: [date('date', 'Date'), person, { key: 'orderNo', label: 'Sale' }, { key: 'level', label: 'Level', number: true }, { key: 'status', label: 'Status' }, money('gross', 'Gross'), money('reversed', 'Reversed'), money('tds', 'TDS'), money('net', 'Net paid')],
    row: (d, who) => ({ date: iso(d.createdAt), person: who(d.earnerUserId), orderNo: d.orderNo as string, level: d.level as number, status: d.status as string, gross: d.grossPaise as number, reversed: d.reversedPaise as number, tds: d.tdsPaise as number, net: d.netPaise as number }),
    totals: { gross: '$grossPaise', reversed: '$reversedPaise', tds: '$tdsPaise', net: '$netPaise' }, sort: { date: 'createdAt', level: 'level', gross: 'grossPaise', status: 'status' },
  },
  tds: {
    model: TdsModel as never, dateField: 'createdAt', userField: 'userId', search: ['source', 'financialYear'], match: (s) => ({ isTest: s.isTest, ...(s.userId ? { userId: s.userId } : {}) }),
    columns: [date('date', 'Date'), person, { key: 'fy', label: 'FY' }, { key: 'source', label: 'Source' }, { key: 'pan', label: 'PAN' }, money('gross', 'Gross'), { key: 'rate', label: 'Rate %', number: true }, money('tds', 'TDS')],
    row: (d, who) => ({ date: iso(d.createdAt), person: who(d.userId), fy: d.financialYear as string, source: d.source as string, pan: (d.panMasked as string) ?? '', gross: d.grossPaise as number, rate: d.ratePct as number, tds: d.tdsPaise as number }),
    totals: { gross: '$grossPaise', tds: '$tdsPaise' }, sort: { date: 'createdAt', gross: 'grossPaise', tds: 'tdsPaise' },
  },
  withdrawals: {
    model: WithdrawalModel as never, dateField: 'createdAt', userField: 'userId', search: ['requestNo', 'utr'], match: (s) => ({ isTest: s.isTest, ...(s.userId ? { userId: s.userId } : {}) }),
    columns: [{ key: 'no', label: 'Request' }, date('date', 'Date'), person, { key: 'bank', label: 'Bank' }, { key: 'status', label: 'Status' }, money('amount', 'Amount'), money('fee', 'Fee'), money('net', 'Net'), { key: 'utr', label: 'UTR' }],
    row: (d, who) => { const b = d.bank as { bankName: string; accountLast4: string }; return { no: d.requestNo as string, date: iso(d.createdAt), person: who(d.userId), bank: `${b.bankName} XX${b.accountLast4}`, status: d.status as string, amount: d.amountPaise as number, fee: d.feePaise as number, net: d.netPaise as number, utr: (d.utr as string) ?? '' }; },
    totals: { amount: '$amountPaise', fee: '$feePaise', net: '$netPaise' }, sort: { date: 'createdAt', amount: 'amountPaise', status: 'status' },
  },
  invoices: {
    model: InvoiceModel as never, dateField: 'issuedAt', search: ['invoiceNo', 'orderNo', 'buyer.name', 'seller.name'], match: (s) => ({ isTest: s.isTest, ...(s.vendorId ? { vendorId: s.vendorId } : s.userId ? { buyerUserId: s.userId } : {}) }),
    columns: [{ key: 'no', label: 'Number' }, date('date', 'Date'), { key: 'type', label: 'Type' }, { key: 'seller', label: 'Seller' }, { key: 'buyer', label: 'Buyer' }, money('taxable', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('total', 'Total')],
    row: (d) => { const g = d.type === 'credit_note' ? -1 : 1; return { no: d.invoiceNo as string, date: iso(d.issuedAt), type: (d.type as string).replace('_', ' '), seller: (d.seller as { name: string }).name, buyer: (d.buyer as { name: string }).name, taxable: g * (d.taxablePaise as number), cgst: g * (d.cgstPaise as number), sgst: g * (d.sgstPaise as number), igst: g * (d.igstPaise as number), total: g * (d.totalPaise as number) }; },
    totals: Object.fromEntries([['taxable', 'taxablePaise'], ['cgst', 'cgstPaise'], ['sgst', 'sgstPaise'], ['igst', 'igstPaise'], ['total', 'totalPaise']].map(([k, f]) => [k, { $cond: [{ $eq: ['$type', 'credit_note'] }, { $multiply: [`$${f}`, -1] }, `$${f}`] }])), sort: { date: 'issuedAt', no: 'invoiceNo', total: 'totalPaise' },
  },
  settlements: {
    model: SettlementModel as never, dateField: 'createdAt', userField: 'userId', search: ['orderNo'], match: (s) => ({ isTest: s.isTest, ...(s.userId ? { userId: s.userId } : {}) }),
    columns: [date('date', 'Date'), { key: 'person', label: 'Vendor' }, { key: 'orderNo', label: 'Order' }, money('gross', 'Sale'), money('fee', 'Platform fee'), money('net', 'Credited'), money('reversed', 'Reversed')],
    row: (d, who) => ({ date: iso(d.createdAt), person: who(d.userId), orderNo: d.orderNo as string, gross: d.grossPaise as number, fee: d.feePaise as number, net: d.netPaise as number, reversed: d.reversedPaise as number }),
    totals: { gross: '$grossPaise', fee: '$feePaise', net: '$netPaise', reversed: '$reversedPaise' }, sort: { date: 'createdAt', gross: 'grossPaise' },
  },
  rewards: {
    model: RewardModel as never, dateField: 'createdAt', userField: 'userId', search: ['title', 'reason'], match: (s) => ({ isTest: s.isTest, ...(s.userId ? { userId: s.userId } : {}) }),
    columns: [date('date', 'Date'), person, { key: 'title', label: 'Reward' }, { key: 'kind', label: 'Kind' }, money('amount', 'Amount'), money('tds', 'TDS')],
    row: (d, who) => ({ date: iso(d.createdAt), person: who(d.userId), title: d.title as string, kind: d.kind as string, amount: d.amountPaise as number, tds: d.tdsPaise as number }), totals: { amount: '$amountPaise', tds: '$tdsPaise' }, sort: { date: 'createdAt', amount: 'amountPaise' },
  },
  members: {
    model: UserModel as never, dateField: 'createdAt', userField: '_id', search: ['name', 'email', 'mobile'], match: () => ({ roles: 'member' }),
    columns: [person, { key: 'email', label: 'Email' }, { key: 'mobile', label: 'Mobile' }, { key: 'status', label: 'Status' }, date('date', 'Joined'), date('login', 'Last login')],
    row: (d, who) => ({ person: who(d._id), email: d.email as string, mobile: d.mobile as string, status: d.status as string, date: iso(d.createdAt), login: iso(d.lastLoginAt) }), sort: { date: 'createdAt', person: 'name', status: 'status' },
  },
};

export interface Query { from?: Date; to?: Date; q?: RegExp; people?: Types.ObjectId[]; sort?: string; dir: 1 | -1; skip: number; limit: number }
export async function runReport(key: ReportKey, scope: Scope, q: Query) {
  const def = DEFS[key];
  const and: Record<string, unknown>[] = [def.match(scope)];
  if (q.from || q.to) and.push({ [def.dateField]: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } });
  if (q.q) and.push({ $or: [...def.search.map((f) => ({ [f]: q.q })), ...(q.people && def.userField ? [{ [def.userField]: { $in: q.people } }] : [])] });
  const match = { $and: and };
  const field = (q.sort && def.sort[q.sort]) || def.dateField;
  const M = def.model as unknown as Model<Doc>;
  const [rows, total, sums] = await Promise.all([
    M.find(match as never).sort({ [field]: q.dir, _id: q.dir }).skip(q.skip).limit(q.limit).lean<Doc[]>(),
    M.countDocuments(match as never),
    def.totals ? M.aggregate([{ $match: match }, { $group: { _id: null, ...Object.fromEntries(Object.entries(def.totals).map(([k, e]) => [k, { $sum: e }])) } }] as PipelineStage[]) : [],
  ]);
  const ids = def.userField ? rows.map((r) => r[def.userField!]) : [];
  const [users, members, vendors] = await Promise.all([UserModel.find({ _id: { $in: ids } }, { name: 1 }).lean(), MemberModel.find({ userId: { $in: ids } }, { userId: 1, memberId: 1 }).lean(), VendorModel.find({ userId: { $in: ids } }, { userId: 1, businessName: 1 }).lean()]);
  const label = new Map(users.map((u) => { const id = String(u._id); const code = members.find((m) => String(m.userId) === id)?.memberId; const biz = key === 'settlements' ? vendors.find((v) => String(v.userId) === id)?.businessName : undefined; return [id, `${biz ?? u.name}${code ? ` (${code})` : ''}`]; }));
  const who = (id: unknown) => label.get(String(id)) ?? '';
  const { _id, ...totals } = (sums[0] ?? {}) as Record<string, number>;
  void _id;
  // A person's own report doesn't need a column repeating their name.
  const columns = scope.userId && key !== 'sales' && def.columns.some((c) => c.key === 'person') ? def.columns.filter((c) => c.key !== 'person') : def.columns;
  return { title: REPORTS[key], columns, data: rows.map((r) => def.row(r, who)), total, totals, sortable: Object.keys(def.sort) };
}

/* ================================================================ Exports */
const show = (c: ReportColumn, v: string | number | null | undefined) => (v == null ? '' : c.money ? (Number(v) / 100).toFixed(2) : c.date ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : String(v));
export interface Built { title: string; columns: ReportColumn[]; data: Record<string, string | number | null>[]; totals: Record<string, number>; subtitle: string }

export async function toXlsx(r: Built): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'JustReference';
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: c.date ? 20 : c.money ? 14 : 24, ...(c.money ? { style: { numFmt: '#,##0.00' } } : c.date ? { style: { numFmt: 'dd mmm yyyy hh:mm' } } : {}) }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const IST = 5.5 * 3_600_000;
  // Values are written as typed cells, never formulas, so text starting with "=" stays text.
  for (const d of r.data) ws.addRow(Object.fromEntries(r.columns.map((c) => { const v = d[c.key]; return [c.key, v == null ? '' : c.money ? Number(v) / 100 : c.date ? new Date(new Date(v).getTime() + IST) : c.number ? Number(v) : String(v)]; })));
  if (Object.keys(r.totals).length && r.data.length) {
    const t = ws.addRow(Object.fromEntries(r.columns.map((c, i) => [c.key, c.key in r.totals ? r.totals[c.key]! / 100 : i === 0 ? 'Total' : ''])));
    t.font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const latin = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-').replace(/₹/g, 'Rs. ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
export function toPdf(r: Built): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true, info: { Title: r.title, Author: 'JustReference' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
    const W = doc.page.width - 60;
    const weight = (c: ReportColumn) => (c.money ? 1 : c.date ? 1.35 : c.number ? 0.6 : 1.4);
    const sum = r.columns.reduce((a, c) => a + weight(c), 0);
    const widths = r.columns.map((c) => (W * weight(c)) / sum);
    const line = (cells: string[], bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#222');
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c || ' ', { width: widths[i]! - 6 })));
      if (doc.y + h > doc.page.height - 45) { doc.addPage(); header(); doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#222'); }
      const y = doc.y;
      let x = 30;
      cells.forEach((c, i) => { doc.text(c, x, y, { width: widths[i]! - 6, align: r.columns[i]!.money || r.columns[i]!.number ? 'right' : 'left' }); x += widths[i]!; });
      doc.y = y + h + 4;
      doc.moveTo(30, doc.y - 2).lineTo(30 + W, doc.y - 2).lineWidth(0.4).strokeColor('#ddd').stroke();
    };
    const header = () => line(r.columns.map((c) => c.label), true);
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f1e46').text(r.title, 30, 30).font('Helvetica').fontSize(8.5).fillColor('#555').text(latin(r.subtitle)).moveDown(0.6);
    header();
    for (const d of r.data) line(r.columns.map((c) => latin(show(c, d[c.key]))));
    if (Object.keys(r.totals).length && r.data.length) line(r.columns.map((c, i) => (c.key in r.totals ? show({ ...c, money: true }, r.totals[c.key]) : i === 0 ? 'Total' : '')), true);
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(7).fillColor('#888').text(`Page ${i + 1} of ${pages.count}`, 30, doc.page.height - 24, { width: W, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
export const cell = show;
