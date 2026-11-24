import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BadgeCheck, Calendar, Clock, Download, FileText, Globe, MapPin, PackageX, Truck } from 'lucide-react';
import type { ListingDetail, ListingType } from '@jr/shared';
import { formatINR } from '@jr/shared/money';
import { Alert, Badge, ButtonLink, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/design-system';
import { useListing } from '@/features/catalog/api';
import { ListingCard, ListingImage, SampleTag, VendorLogo } from '@/features/catalog/components';
import { BuyBox } from '@/features/commerce/components';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

const SECTION: Record<ListingType, { label: string; to: string }> = {
  product: { label: 'Products', to: '/products' },
  service: { label: 'Services', to: '/services' },
  project: { label: 'Projects', to: '/projects' },
};

export function ListingDetailPage({ type }: { type: ListingType }) {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useListing(type, slug);
  const section = SECTION[type];

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div className="container-page py-10">
        <PageHeader breadcrumbs={[{ label: 'Home', to: '/' }, { label: section.label, to: section.to }, { label: 'Not found' }]} title="Listing not found" />
        <Card><EmptyState icon={PackageX} title="This listing isn’t available" description="It may have been removed or is being updated by the vendor." action={<ButtonLink to={section.to}>Browse {section.label.toLowerCase()}</ButtonLink>} /></Card>
      </div>
    );
  }
  if (error) return <div className="container-page py-10"><Card><ErrorState onRetry={() => refetch()} /></Card></div>;
  if (isLoading || !data) {
    return <div className="container-page grid gap-6 py-10 lg:grid-cols-[1.3fr_1fr]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>;
  }

  const l = data.listing;
  return (
    <div className="container-page py-8 sm:py-10">
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: section.label, to: section.to }, { label: l.category.name, to: `${section.to}?category=${l.category.slug}` }, { label: l.name }]}
        title={<span className="flex flex-wrap items-center gap-3">{l.name}{l.isSample && <SampleTag />}</span>}
        description={l.summary}
      />
      {l.isSample && <Alert tone="warn" className="mb-6">This is a <b>sample listing</b> created for testing. The business and prices are not real.</Alert>}

      <div className="grid gap-7 lg:grid-cols-[1.35fr_1fr]">
        <div className="grid content-start gap-6">
          <Gallery listing={l} />
          {l.description && (
            <Card className="p-6">
              <h2 className="text-[16px] font-bold">Description</h2>
              <div className="mt-3 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{l.description}</div>
            </Card>
          )}
          {(l.attributes.length > 0 || l.product?.sku) && (
            <Card className="p-6">
              <h2 className="text-[16px] font-bold">Specifications</h2>
              <dl className="mt-3 divide-y divide-line-2 text-[14px]">
                {l.product?.sku && <Row k="SKU" v={l.product.sku} />}
                {l.attributes.map((a) => <Row key={a.name} k={a.name} v={a.value} />)}
              </dl>
            </Card>
          )}
          {l.project && <ProjectDetails listing={l} />}
        </div>

        <div className="grid content-start gap-5 lg:sticky lg:top-24">
          <Card className="p-6">
            <div className="text-[30px] font-extrabold tracking-tight text-navy-950">
              {formatINR(l.pricePaise)} {l.priceNote && <span className="text-[14px] font-medium text-muted">{l.priceNote}</span>}
            </div>
            <p className="text-[13px] text-muted">{l.gstRatePct > 0 ? `+ ${l.gstRatePct}% GST, if the seller is GST registered` : 'GST exempt'}</p>
            <ul className="mt-4 grid gap-2 text-[14px] text-ink-2">
              <li className="flex items-center gap-2"><MapPin className="size-4 text-subtle" />{l.city}</li>
              {l.product && <li className="flex items-center gap-2"><Truck className="size-4 text-subtle" />{{ in_stock: 'In stock', out_of_stock: 'Out of stock', made_to_order: 'Made to order' }[l.product.availability]}{l.product.unit && ` · sold per ${l.product.unit}`}</li>}
              {l.service && <li className="flex items-center gap-2"><Calendar className="size-4 text-subtle" />{l.service.deliveryDays}-day turnaround</li>}
              {l.service?.remote && <li className="flex items-center gap-2"><Globe className="size-4 text-subtle" />Can be delivered remotely</li>}
              {l.project && <li className="flex items-center gap-2"><Clock className="size-4 text-subtle" />About {l.project.durationDays} days</li>}
            </ul>
            <BuyBox listing={l} />
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-3">
              <VendorLogo vendor={l.vendor} size={48} />
              <div className="min-w-0">
                <p className="text-[12.5px] text-muted">Sold by</p>
                <Link to={`/vendors/${l.vendor.slug}`} className="flex items-center gap-1.5 font-bold hover:text-brand-600">
                  <span className="truncate">{l.vendor.name}</span>{l.vendor.verified && <BadgeCheck className="size-4 flex-none text-success" aria-label="Verified" />}
                </Link>
                <p className="truncate text-[13px] text-muted">{[l.vendor.category, l.vendor.city].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
            <ButtonLink to={`/vendors/${l.vendor.slug}`} variant="outline" className="mt-4 w-full">View vendor profile</ButtonLink>
          </Card>
        </div>
      </div>

      {data.moreFromVendor.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-xl font-extrabold tracking-tight">More from {l.vendor.name}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{data.moreFromVendor.map((m) => <ListingCard key={m.id} listing={m} />)}</div>
        </section>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>;
}

function Gallery({ listing: l }: { listing: ListingDetail }) {
  const [active, setActive] = useState(0);
  const img = l.images[active];
  return (
    <Card className="overflow-hidden">
      <ListingImage src={img?.url} hint={`${l.category.name} ${l.subcategory?.name ?? ''}`} type={l.type} alt={l.name} className="h-72 sm:h-96" />
      {l.images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-3">
          {l.images.map((m, i) => (
            <button key={m.id} type="button" onClick={() => setActive(i)} aria-label={`Photo ${i + 1}`} aria-current={i === active}
              className={cn('size-16 flex-none overflow-hidden rounded-lg border-2', i === active ? 'border-brand-500' : 'border-transparent opacity-75 hover:opacity-100')}>
              <img src={m.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function ProjectDetails({ listing: l }: { listing: ListingDetail }) {
  const p = l.project!;
  return (
    <Card className="p-6">
      <h2 className="text-[16px] font-bold">Project & payment plan</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[['Project cost', formatINR(l.pricePaise)], ['Advance payment', formatINR(p.advancePaise)], ['Balance payment', formatINR(p.balancePaise)]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-canvas p-3.5"><div className="text-[12.5px] text-muted">{k}</div><div className="mt-0.5 text-[17px] font-bold text-navy-950">{v}</div></div>
        ))}
      </div>
      <p className="mt-3 text-[13.5px] text-muted">
        Duration about <b className="text-ink">{p.durationDays} days</b>. {p.allowFullPayment ? <Badge tone="green">Full payment upfront accepted</Badge> : 'Paid in advance + balance only.'}
      </p>
      {p.specialInstructions && <><h3 className="mt-5 text-[14px] font-bold">Special instructions</h3><p className="mt-1 text-[14px] whitespace-pre-line text-ink-2">{p.specialInstructions}</p></>}
      {p.terms && <><h3 className="mt-5 text-[14px] font-bold">Terms & conditions</h3><p className="mt-1 text-[14px] whitespace-pre-line text-ink-2">{p.terms}</p></>}
      {p.documents.length > 0 && (
        <>
          <h3 className="mt-5 text-[14px] font-bold">Documents</h3>
          <ul className="mt-2 grid gap-2">
            {p.documents.map((d) => (
              <li key={d.id}>
                <a href={`/api/v1/catalog/listings/project/${l.slug}/documents/${d.id}`} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[14px] hover:bg-canvas">
                  <FileText className="size-4 text-brand-600" /><span className="flex-1">{d.name}</span><Download className="size-4 text-subtle" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
