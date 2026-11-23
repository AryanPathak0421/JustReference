import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { LISTING_STATUSES, LISTING_TYPES, PRODUCT_AVAILABILITY } from '@jr/shared';

/**
 * Categories for all three listing types. `parentId: null` = category; set = subcategory.
 * (The brief's six category/subcategory tables collapse into this one collection.)
 */
const categorySchema = new Schema(
  {
    kind: { type: String, enum: LISTING_TYPES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
categorySchema.index({ kind: 1, slug: 1 }, { unique: true });
categorySchema.index({ kind: 1, parentId: 1, sortOrder: 1 });
export type Category = InferSchemaType<typeof categorySchema>;
export const CategoryModel = model('Category', categorySchema);

const mediaSchema = new Schema({ key: { type: String, required: true }, name: String }, { _id: true });

/**
 * Products, services and projects share one collection, distinguished by `type`, so orders (Phase 4)
 * can reference any listing. Type-specific fields live in the `product` / `service` / `project` sub-objects.
 */
const listingSchema = new Schema(
  {
    type: { type: String, enum: LISTING_TYPES, required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    summary: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 5000 },
    city: { type: String, required: true },
    pricePaise: { type: Number, required: true, min: 0 },
    priceNote: String,
    gstRatePct: { type: Number, default: 18 },
    attributes: [{ _id: false, name: String, value: String }],
    images: { type: [mediaSchema], default: [] },
    product: {
      sku: String,
      availability: { type: String, enum: PRODUCT_AVAILABILITY },
      stockQty: Number,
      unit: String,
    },
    service: { deliveryDays: Number, remote: Boolean },
    project: {
      durationDays: Number,
      advancePaise: Number,
      allowFullPayment: Boolean,
      specialInstructions: String,
      terms: String,
      documents: { type: [mediaSchema], default: undefined },
    },
    status: { type: String, enum: LISTING_STATUSES, default: 'draft' },
    rejectionReason: String,
    featured: { type: Boolean, default: false },
    /**
     * Denormalised "vendor is approved" flag, kept in sync when a vendor is approved/suspended,
     * so public queries don't need to join vendors. Public = status published AND vendorActive.
     */
    vendorActive: { type: Boolean, default: false },
    submittedAt: Date,
    publishedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isSample: { type: Boolean, default: false },
  },
  { timestamps: true },
);
listingSchema.index({ type: 1, slug: 1 }, { unique: true });
listingSchema.index({ type: 1, status: 1, vendorActive: 1, featured: -1, publishedAt: -1 });
listingSchema.index({ vendorId: 1, type: 1, status: 1 });
listingSchema.index({ categoryId: 1, status: 1 });
listingSchema.index({ subcategoryId: 1, status: 1 });
listingSchema.index({ status: 1, submittedAt: 1 });
listingSchema.index({ name: 'text', summary: 'text', description: 'text' }, { weights: { name: 5, summary: 2, description: 1 } });

export type Listing = InferSchemaType<typeof listingSchema>;
export type ListingDoc = HydratedDocument<Listing>;
export const ListingModel = model('Listing', listingSchema);
