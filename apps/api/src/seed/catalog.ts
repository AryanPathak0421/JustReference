/**
 * Catalog seeds.
 * - Default categories: a starting taxonomy for a fresh install (admins can edit or remove them).
 * - Sample catalog (seed:demo only): SAMPLE vendors and listings, flagged `isSample`, for local testing.
 */
import mongoose from 'mongoose';
import type { ListingType } from '@jr/shared';
import { CategoryModel, ListingModel } from '../models/catalog';
import { VendorModel } from '../models/vendor';
import { UserModel } from '../models/user';
import { hashSecret } from '../core/crypto';
import { createMemberRecord } from '../services/identity';
import { createVendorShell } from '../services/vendors';
import { slugify } from '../services/slug';

const DEFAULT_CATEGORIES: Record<ListingType, Record<string, string[]>> = {
  product: {
    Electronics: ['Security cameras', 'Smart home', 'Computers & accessories'],
    Energy: ['Solar panels', 'Inverters', 'Batteries'],
    Office: ['Furniture', 'Stationery'],
    'Food & grocery': ['Oils', 'Grains & pulses', 'Spices'],
  },
  service: {
    'IT & software': ['Web development', 'App development', 'IT support'],
    'Finance & legal': ['Tax compliance', 'Business registration', 'Accounting'],
    'Home services': ['Cleaning', 'Maintenance', 'Pest control'],
    Marketing: ['Digital marketing', 'Branding & design'],
    Events: ['Corporate events', 'Weddings'],
  },
  project: {
    Energy: ['Solar installation'],
    Interiors: ['Residential interiors', 'Commercial interiors'],
    'IT & software': ['Networking', 'App development'],
    Construction: ['Residential', 'Commercial'],
  },
};

export async function seedDefaultCategories() {
  if (await CategoryModel.exists({})) return false;
  for (const [kind, cats] of Object.entries(DEFAULT_CATEGORIES)) {
    let order = 0;
    for (const [name, subs] of Object.entries(cats)) {
      const parent = await CategoryModel.create({ kind, name, slug: slugify(name), sortOrder: order++ });
      await CategoryModel.insertMany(subs.map((s, i) => ({ kind, name: s, slug: slugify(s), parentId: parent._id, sortOrder: i })));
    }
  }
  return true;
}

const VENDORS = [
  { key: 'v1', name: 'SunGrid Energy', owner: 'Ravi Kulkarni', city: 'Pune', state: 'Maharashtra', category: 'Solar & energy' },
  { key: 'v2', name: 'Pixelcraft Labs', owner: 'Priya Nair', city: 'Bengaluru', state: 'Karnataka', category: 'IT services' },
  { key: 'v3', name: 'HomeNest Interiors', owner: 'Farah Siddiqui', city: 'Bengaluru', state: 'Karnataka', category: 'Interiors' },
  { key: 'v4', name: 'SecureVision', owner: 'Amit Bansal', city: 'Delhi', state: 'Delhi', category: 'CCTV & security' },
  { key: 'v5', name: 'GreenLeaf Organics', owner: 'Sunita Pawar', city: 'Nashik', state: 'Maharashtra', category: 'Food & grocery' },
  { key: 'v6', name: 'LedgerWise Associates', owner: 'Mehul Shah', city: 'Mumbai', state: 'Maharashtra', category: 'Accounting & tax' },
  { key: 'v7', name: 'BuildRight Contractors', owner: 'Srinivas Rao', city: 'Hyderabad', state: 'Telangana', category: 'Construction' },
  { key: 'v8', name: 'OfficeHub Supplies', owner: 'Kiran Patel', city: 'Ahmedabad', state: 'Gujarat', category: 'Office supplies' },
  { key: 'v9', name: 'SparkClean Services', owner: 'Lakshmi Iyer', city: 'Chennai', state: 'Tamil Nadu', category: 'Cleaning' },
  { key: 'v10', name: 'EventCraft Studio', owner: 'Rohit Sharma', city: 'Jaipur', state: 'Rajasthan', category: 'Events' },
];

type L = {
  type: ListingType; v: string; name: string; cat: string; sub: string; summary: string; price: number; note?: string; featured?: boolean;
  product?: { availability: string; unit?: string }; service?: { deliveryDays: number; remote: boolean };
  project?: { durationDays: number; advancePct: number };
};

const LISTINGS: L[] = [
  { type: 'product', v: 'v4', name: '4-Camera HD CCTV Kit with DVR', cat: 'Electronics', sub: 'Security cameras', summary: '1080p night-vision cameras, 1 TB DVR, mobile app viewing.', price: 14999, product: { availability: 'in_stock' } },
  { type: 'product', v: 'v1', name: 'Monocrystalline Solar Panel 540 W', cat: 'Energy', sub: 'Solar panels', summary: 'Tier-1 half-cut cells, 25-year performance warranty.', price: 14500, note: 'per panel', product: { availability: 'in_stock', unit: 'panel' } },
  { type: 'product', v: 'v8', name: 'Ergonomic Mesh Office Chair', cat: 'Office', sub: 'Furniture', summary: 'Adjustable lumbar support, 3D armrests, 5-year warranty.', price: 8499, product: { availability: 'in_stock' } },
  { type: 'product', v: 'v5', name: 'Organic Cold-Pressed Groundnut Oil (5 L)', cat: 'Food & grocery', sub: 'Oils', summary: 'Wood-pressed, unrefined, FSSAI certified.', price: 1890, product: { availability: 'in_stock' } },
  { type: 'product', v: 'v8', name: 'A4 Copier Paper 75 GSM (Box of 5 reams)', cat: 'Office', sub: 'Stationery', summary: '2,500 sheets, jam-free, bright white.', price: 1450, product: { availability: 'out_of_stock' } },
  { type: 'product', v: 'v1', name: '5 kVA Hybrid Solar Inverter', cat: 'Energy', sub: 'Inverters', summary: 'MPPT charge controller, Wi-Fi monitoring.', price: 62500, product: { availability: 'in_stock' } },
  { type: 'product', v: 'v4', name: 'Smart Video Doorbell', cat: 'Electronics', sub: 'Smart home', summary: 'Two-way talk, motion alerts, cloud recording.', price: 5999, product: { availability: 'in_stock' } },
  { type: 'product', v: 'v8', name: 'Modular Workstation Desk (4-seater)', cat: 'Office', sub: 'Furniture', summary: 'Laminated MDF with cable management and pedestals.', price: 48000, product: { availability: 'made_to_order' } },
  { type: 'service', v: 'v2', name: 'E-commerce Website Development', cat: 'IT & software', sub: 'Web development', summary: 'Custom storefront with payments, inventory and admin panel.', price: 45000, note: 'onwards', featured: true, service: { deliveryDays: 30, remote: true } },
  { type: 'service', v: 'v6', name: 'GST Registration & Monthly Filing', cat: 'Finance & legal', sub: 'Tax compliance', summary: 'Registration, GSTR-1/3B filing and reconciliation.', price: 1499, note: 'per month', service: { deliveryDays: 3, remote: true } },
  { type: 'service', v: 'v9', name: 'Deep Home Cleaning (2BHK)', cat: 'Home services', sub: 'Cleaning', summary: 'Kitchen, bathrooms, floors and windows, eco products.', price: 3499, service: { deliveryDays: 1, remote: false } },
  { type: 'service', v: 'v4', name: 'CCTV Annual Maintenance Contract', cat: 'Home services', sub: 'Maintenance', summary: 'Quarterly visits, priority breakdown support.', price: 6000, note: 'per year', service: { deliveryDays: 2, remote: false } },
  { type: 'service', v: 'v2', name: 'Social Media Marketing Package', cat: 'Marketing', sub: 'Digital marketing', summary: '20 posts, 2 reels and ad management per month.', price: 25000, note: 'per month', service: { deliveryDays: 30, remote: true } },
  { type: 'service', v: 'v10', name: 'Corporate Event Management', cat: 'Events', sub: 'Corporate events', summary: 'Venue, décor, AV and catering coordination.', price: 150000, note: 'onwards', service: { deliveryDays: 14, remote: false } },
  { type: 'service', v: 'v6', name: 'Company Incorporation (Pvt Ltd)', cat: 'Finance & legal', sub: 'Business registration', summary: 'DSC, DIN, name approval, MoA/AoA and PAN/TAN.', price: 8999, service: { deliveryDays: 10, remote: true } },
  { type: 'project', v: 'v1', name: '5 kW Rooftop Solar Installation', cat: 'Energy', sub: 'Solar installation', summary: 'Supply and install grid-tied system with net-metering paperwork.', price: 180000, note: 'est.', featured: true, project: { durationDays: 21, advancePct: 30 } },
  { type: 'project', v: 'v3', name: '2BHK Modular Interior Fit-out', cat: 'Interiors', sub: 'Residential interiors', summary: 'Kitchen, wardrobes, false ceiling and lighting.', price: 650000, note: 'est.', featured: true, project: { durationDays: 45, advancePct: 40 } },
  { type: 'project', v: 'v4', name: 'Office Network & CCTV Setup (50 seats)', cat: 'IT & software', sub: 'Networking', summary: 'Structured cabling, Wi-Fi 6, firewall and 16 cameras.', price: 420000, note: 'est.', project: { durationDays: 15, advancePct: 50 } },
  { type: 'project', v: 'v7', name: 'G+2 Residential Construction', cat: 'Construction', sub: 'Residential', summary: 'Turnkey build including structure, MEP and finishing.', price: 4500000, note: 'est.', project: { durationDays: 300, advancePct: 20 } },
  { type: 'project', v: 'v2', name: 'Restaurant Mobile Ordering App', cat: 'IT & software', sub: 'App development', summary: 'Android + iOS app with menu, cart, payments and admin.', price: 320000, note: 'est.', project: { durationDays: 60, advancePct: 40 } },
  { type: 'project', v: 'v3', name: 'Showroom Interior Renovation', cat: 'Interiors', sub: 'Commercial interiors', summary: '1,800 sq ft retail space, display units and lighting.', price: 1200000, note: 'est.', project: { durationDays: 40, advancePct: 30 } },
];

export async function seedSampleCatalog() {
  if (await VendorModel.exists({ isSample: true })) return false;
  const passwordHash = await hashSecret(`Sample-${Math.random().toString(36).slice(2)}-pw1`); // unusable
  const vendorIds = new Map<string, mongoose.Types.ObjectId>();
  let n = 0;
  for (const v of VENDORS) {
    n++;
    const id = await mongoose.connection.transaction(async (session) => {
      const [user] = await UserModel.create(
        [{ name: v.owner, email: `${slugify(v.name)}@example.test`, mobile: `9100000${String(100 + n).padStart(3, '0')}`, passwordHash, roles: ['vendor'], status: 'active', mobileVerifiedAt: new Date(), isSample: true }],
        { session },
      );
      await createMemberRecord(user!._id, { joinedVia: 'direct' }, session);
      const vendor = await createVendorShell(user!._id, v.name, session, {
        category: v.category, city: v.city, state: v.state, pincode: '400001', businessType: 'private_limited',
        officeAddress: `Sample address, ${v.city}`, description: `${v.name} is a sample vendor created for local testing.`,
        status: 'approved', approvedAt: new Date(), panMasked: 'AB••••••1F', isSample: true,
      } as never);
      return vendor._id;
    });
    vendorIds.set(v.key, id);
  }

  const cats = await CategoryModel.find().lean();
  const find = (kind: string, name: string, parent?: unknown) =>
    cats.find((c) => c.kind === kind && c.name === name && (parent ? String(c.parentId) === String(parent) : !c.parentId));
  const now = Date.now();
  for (const [i, l] of LISTINGS.entries()) {
    const cat = find(l.type, l.cat);
    const sub = cat && find(l.type, l.sub, cat._id);
    if (!cat) continue;
    const v = VENDORS.find((x) => x.key === l.v)!;
    const publishedAt = new Date(now - (LISTINGS.length - i) * 86_400_000);
    await ListingModel.create({
      type: l.type, vendorId: vendorIds.get(l.v), name: l.name, slug: slugify(l.name), categoryId: cat._id, subcategoryId: sub?._id ?? null,
      summary: l.summary, description: `${l.summary}\n\nThis is a SAMPLE listing created for local testing.`, city: v.city,
      pricePaise: l.price * 100, priceNote: l.note, gstRatePct: 18, status: 'published', vendorActive: true, featured: !!l.featured,
      publishedAt, submittedAt: publishedAt, isSample: true,
      product: l.product, service: l.service,
      project: l.project ? { durationDays: l.project.durationDays, advancePaise: Math.round((l.price * l.project.advancePct) / 100) * 100, allowFullPayment: true, terms: 'Sample terms: payment schedule and warranty to be confirmed in the contract.' } : undefined,
    });
  }
  return true;
}
