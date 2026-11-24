import { Router, type Request } from 'express';
import type { Model } from 'mongoose';
import { z } from 'zod';
import { adSchema, announcementSchema, CMS_PAGES, cmsPageSchema, postSchema, testimonialSchema, type AdRow, type AnnouncementRow, type CmsPage, type PostRow, type TestimonialRow } from '@jr/shared';
import { authenticate, requirePermission } from '../middleware/auth';
import { AdModel, AnnouncementModel, CmsPageModel, PostModel, TestimonialModel } from '../models/comms';
import { notFound } from '../core/errors';
import { assertObjectId, paged, paginationSchema, parse } from '../core/http';
import { uniqueSlug } from '../services/slug';
import { audit } from '../services/audit';

const pageKey = z.enum(CMS_PAGES);
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
/* eslint-disable @typescript-eslint/no-explicit-any */
const toPost = (p: any): PostRow => ({ id: String(p._id), slug: p.slug, title: p.title, excerpt: p.excerpt, body: p.body, published: p.published, publishedAt: p.publishedAt?.toISOString() ?? null });
const toTestimonial = (t: any): TestimonialRow => ({ id: String(t._id), name: t.name, role: t.role, quote: t.quote, active: t.active });
const toAnnouncement = (a: any): AnnouncementRow => ({ id: String(a._id), title: a.title, body: a.body, audience: a.audience, pinned: a.pinned, active: a.active, createdAt: a.createdAt.toISOString() });
const toAd = (a: any): AdRow => ({ id: String(a._id), title: a.title, text: a.text ?? '', link: a.link ?? '', placement: a.placement, validFrom: a.validFrom, validTo: a.validTo, active: a.active });

/* ================================================================ Public & signed-in reading */
export const contentRouter = Router();
contentRouter.get('/pages/:key', async (req, res) => {
  const key = parse(pageKey, req.params.key);
  const p = await CmsPageModel.findOne({ key, published: true }).lean();
  if (!p) throw notFound('Page');
  res.json({ key, title: p.title, body: p.body, published: true, updatedAt: p.updatedAt.toISOString() } satisfies CmsPage);
});
contentRouter.get('/posts', async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const [rows, total] = await Promise.all([PostModel.find({ published: true }).sort({ publishedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(), PostModel.countDocuments({ published: true })]);
  res.json(paged(rows.map((r) => ({ ...toPost(r), body: '' })), q.page, q.pageSize, total));
});
contentRouter.get('/posts/:slug', async (req, res) => {
  const p = await PostModel.findOne({ slug: String(req.params.slug), published: true }).lean();
  if (!p) throw notFound('Post');
  res.json(toPost(p));
});
contentRouter.get('/testimonials', async (_req, res) => void res.json({ data: (await TestimonialModel.find({ active: true }).sort({ createdAt: -1 }).limit(6).lean()).map(toTestimonial) }));
const liveAds = (placement: string) => AdModel.find({ placement, active: true, validFrom: { $lte: istToday() }, validTo: { $gte: istToday() } }).sort({ createdAt: -1 }).limit(20).lean();
contentRouter.get('/ads', async (_req, res) => void res.json({ data: (await liveAds('home')).map(toAd) }));
contentRouter.get('/ads/member', authenticate, async (_req, res) => void res.json({ data: (await liveAds('member')).map(toAd) }));
contentRouter.get('/announcements', authenticate, async (req, res) => {
  const rows = await AnnouncementModel.find({ active: true, audience: { $in: req.auth!.user.roles } }).sort({ pinned: -1, createdAt: -1 }).limit(50).lean();
  res.json({ data: rows.map(toAnnouncement) });
});

/* ================================================================ Admin */
export const adminContentRouter = Router();
const manage = requirePermission('content.manage');
adminContentRouter.get('/content/pages', manage, async (_req, res) => {
  const rows = await CmsPageModel.find().lean();
  res.json({ data: CMS_PAGES.map((key): CmsPage => { const p = rows.find((r) => r.key === key); return { key, title: p?.title ?? key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), body: p?.body ?? '', published: p?.published ?? false, updatedAt: p?.updatedAt.toISOString() ?? null }; }) });
});
adminContentRouter.put('/content/pages/:key', manage, async (req, res) => {
  const key = parse(pageKey, req.params.key);
  const input = parse(cmsPageSchema, req.body);
  await CmsPageModel.findOneAndUpdate({ key }, input, { upsert: true });
  await audit(req, { action: 'content.page', entity: 'page', entityId: key, summary: `${input.published ? 'Published' : 'Saved (hidden)'} page ${key}` });
  res.json({ ok: true });
});

/** List / create / edit / delete for a simple content type. */
function crud<S extends z.ZodType>(path: string, M: Model<any>, schema: S, view: (d: any) => unknown, prepare: (input: any, existing: any) => Promise<Record<string, unknown>> | Record<string, unknown> = (i) => i) {
  adminContentRouter.get(`/content/${path}`, manage, async (_req, res) => void res.json({ data: (await M.find().sort({ createdAt: -1 }).limit(300).lean()).map(view) }));
  adminContentRouter.post(`/content/${path}`, manage, async (req, res) => {
    const d = await M.create(await prepare(parse(schema, req.body), null));
    await audit(req, { action: `content.${path}`, entity: path, entityId: String(d._id), summary: `Added to ${path}` });
    res.status(201).json(view(d));
  });
  const find = async (req: Request) => { const d = await M.findById(assertObjectId(req.params.id, 'Item')); if (!d) throw notFound('Item'); return d; };
  adminContentRouter.put(`/content/${path}/:id`, manage, async (req, res) => {
    const d = await find(req);
    d.set(await prepare(parse(schema, req.body), d));
    await d.save();
    await audit(req, { action: `content.${path}`, entity: path, entityId: String(d._id), summary: `Edited an item in ${path}` });
    res.json(view(d));
  });
  adminContentRouter.delete(`/content/${path}/:id`, manage, async (req, res) => {
    const d = await find(req);
    await d.deleteOne();
    await audit(req, { action: `content.${path}`, entity: path, entityId: String(d._id), summary: `Deleted an item from ${path}` });
    res.status(204).end();
  });
}
crud('posts', PostModel, postSchema, toPost, async (i, d) => ({ ...i, slug: d?.slug ?? (await uniqueSlug(PostModel, i.title)), publishedAt: i.published ? (d?.publishedAt ?? new Date()) : d?.publishedAt }));
crud('testimonials', TestimonialModel, testimonialSchema, toTestimonial);
crud('announcements', AnnouncementModel, announcementSchema, toAnnouncement);
crud('ads', AdModel, adSchema, toAd);
