import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight, BarChart3, Briefcase, Building2, CheckCircle2, GitBranch, Gavel, HardHat, Headphones, Link2, Lock, Package, ReceiptIndianRupee,
  Search, Share2, ShieldCheck, TrendingUp, UserPlus, Wallet, WalletCards,
} from 'lucide-react';
import { Avatar, ButtonLink, Card, ErrorState, IconTile, SampleDataBadge, SectionHeading, Segmented } from '@/design-system';
import { useFeatured } from '@/features/catalog/api';
import { ListingCard, ListingCardSkeleton, VendorCard } from '@/features/catalog/components';
import { useQuery } from '@tanstack/react-query';
import { AdCard } from '@/pages/comms/AdCard';
import { homeAds, listPosts, listTestimonials } from '@/features/comms/api';
import { Skeleton } from '@/design-system';

type SearchScope = 'products' | 'services' | 'projects' | 'vendors';

function Hero() {
  const [scope, setScope] = useState<SearchScope>('products');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/${scope}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
  };

  return (
    <section className="relative overflow-hidden bg-[radial-gradient(900px_400px_at_85%_-10%,rgb(109_74_232/0.10),transparent_60%),radial-gradient(800px_420px_at_5%_0%,rgb(47_91_234/0.10),transparent_60%)] pt-14 pb-16 sm:pt-20 sm:pb-18">
      <div className="container-page grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="animate-fade-in">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white py-1.5 pr-3 pl-1.5 text-[13px] font-semibold text-navy-800 shadow-xs">
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[12px] text-brand-600">New</span>
            Products, services &amp; projects in one marketplace
          </span>
          <h1 className="mt-5 mb-4.5 text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] text-navy-950 sm:text-[56px]">
            Find it, buy it, <span className="text-gradient">refer it.</span>
          </h1>
          <p className="max-w-[540px] text-[17px] text-muted sm:text-lg">
            Discover verified vendors across India, hire for projects, and earn rewards when people you refer do business on JustReference.
          </p>

          <form onSubmit={submit} role="search" className="mt-8 max-w-[580px] rounded-card border border-line bg-white p-2 shadow-pop">
            <Segmented
              label="Search in"
              value={scope}
              onChange={setScope}
              className="mb-2 border-0 bg-transparent"
              options={[{ value: 'products', label: 'Products' }, { value: 'services', label: 'Services' }, { value: 'projects', label: 'Projects' }, { value: 'vendors', label: 'Vendors' }]}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex h-12 flex-1 items-center gap-2.5 rounded-[10px] bg-canvas px-3 text-muted focus-within:ring-4 focus-within:ring-brand-50">
                <Search className="size-[18px] flex-none" aria-hidden />
                <span className="sr-only">Search {scope}</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “solar installation”, “CCTV”, “GST filing”…" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none" />
              </label>
              <button type="submit" className="h-12 rounded-[10px] bg-navy-900 px-6 font-semibold text-white transition hover:bg-navy-700">Search</button>
            </div>
          </form>

          {/* Platform stats come from GET /public/stats in Phase 2 — hidden until real numbers exist. */}
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-muted">
            {['Verified vendors only', 'Secure, verified payments', 'GST invoices on every order'].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" />{t}</li>
            ))}
          </ul>
        </div>

        <div className="relative hidden h-[440px] lg:block" aria-hidden>
          <Card className="absolute top-5 right-5 left-8 p-6 shadow-pop">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12.5px] font-medium text-muted">Your earnings this month</div>
                <div className="text-[30px] font-extrabold tracking-tight text-navy-950">₹24,860</div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-0.5 text-xs font-semibold text-success"><TrendingUp className="size-3.5" />18%</span>
            </div>
            <div className="mt-5 flex h-24 items-end gap-2">
              {[38, 52, 44, 66, 58, 80, 72, 94].map((h, i) => (
                <i key={i} className={i % 2 ? 'flex-1 rounded-t-md rounded-b-sm bg-gradient-to-b from-brand-500 to-navy-800' : 'flex-1 rounded-t-md rounded-b-sm bg-brand-100'} style={{ height: `${h}%` }} />
              ))}
            </div>
            <SampleDataBadge label="Illustration" className="mt-4" />
          </Card>
          <Card className="absolute bottom-10 left-0 w-64 p-4.5 shadow-pop">
            <div className="text-[12.5px] font-medium text-muted">Referral network</div>
            <div className="mt-0.5 font-bold">12 direct · 47 total</div>
            <div className="mt-2.5 flex -space-x-2">
              {['Aditi Kulkarni', 'Rohan Sen', 'Pooja Menon'].map((n) => <span key={n} className="rounded-full ring-2 ring-white"><Avatar name={n} size={34} /></span>)}
              <span className="grid size-[34px] place-items-center rounded-full bg-navy-800 text-[12px] font-bold text-white ring-2 ring-white">+9</span>
            </div>
          </Card>
          <Card className="absolute right-0 bottom-0 flex w-66 items-center gap-3 p-4.5 shadow-pop">
            <IconTile icon={CheckCircle2} tone="green" />
            <div><div className="text-[14px] font-bold">Order confirmed</div><div className="text-[12.5px] text-muted">Solar rooftop install · ₹1.8L</div></div>
          </Card>
        </div>
      </div>
    </section>
  );
}

const CATEGORIES = [
  { icon: Package, tone: 'blue', title: 'Products', text: 'Electronics, energy, office and everyday supplies', to: '/products' },
  { icon: Briefcase, tone: 'violet', title: 'Services', text: 'IT, tax & legal, marketing, home services and more', to: '/services' },
  { icon: HardHat, tone: 'green', title: 'Projects', text: 'Construction, interiors, IT builds and installations', to: '/projects' },
  { icon: Building2, tone: 'amber', title: 'Business directory', text: 'Find and contact verified businesses near you', to: '/directory' },
] as const;

function FeaturedSections() {
  const { data, isLoading: loading, error, refetch: reload } = useFeatured();
  return (
    <>
      <section className="border-y border-line-2 bg-canvas py-16 sm:py-22">
        <div className="container-page">
          <SectionHeading
            kicker="Featured"
            title="Popular projects & services"
            action={<div className="flex items-center gap-3"><Link to="/projects" className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-brand-600 hover:gap-2.5 transition-all">View all <ArrowRight className="size-4" /></Link></div>}
          />
          {error ? <ErrorState onRetry={reload} /> : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {loading || !data ? Array.from({ length: 3 }, (_, i) => <ListingCardSkeleton key={i} />) : data.listings.map((l) => <ListingCard key={l.id} listing={l} />)}
            </div>
          )}
        </div>
      </section>

      <section className="py-16 sm:py-22">
        <div className="container-page">
          <SectionHeading
            kicker="Featured vendors"
            title="Businesses buyers trust"
            action={<Link to="/vendors" className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-brand-600 hover:gap-2.5 transition-all">Explore vendors <ArrowRight className="size-4" /></Link>}
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {loading || !data
              ? Array.from({ length: 4 }, (_, i) => <Card key={i} className="grid gap-3 p-5"><Skeleton className="h-13 w-13" /><Skeleton className="h-4 w-2/3" /></Card>)
              : data.vendors.map((v, i) => <VendorCard key={v.id} vendor={v} index={i} />)}
          </div>
        </div>
      </section>
    </>
  );
}

const STEPS = [
  { title: 'Create your free account', text: 'Sign up with your email or mobile number and verify with a one-time code. Joining through a friend’s link connects you to them.' },
  { title: 'Discover & do business', text: 'Buy products, book services or post a project and compare vendor bids. Pay securely and track every order.' },
  { title: 'Share & earn rewards', text: 'Share your referral link. When people you refer make eligible purchases, rewards are credited to your wallet.' },
];

const BENEFITS = [
  { icon: ShieldCheck, tone: 'blue', title: 'Verified vendors', text: 'KYC and GST checks before any business can sell on the platform.' },
  { icon: Lock, tone: 'violet', title: 'Secure payments', text: 'Payments are confirmed server-side with the gateway, never just in your browser.' },
  { icon: WalletCards, tone: 'green', title: 'Built-in wallet', text: 'Rewards, refunds and payouts in one place, with a full transaction history.' },
  { icon: Gavel, tone: 'amber', title: 'Competitive bids', text: 'Post a project and compare proposals, timelines and prices side by side.' },
  { icon: Headphones, tone: 'navy', title: 'Real support', text: 'Raise a ticket and track it to resolution with replies from our team.' },
  { icon: BarChart3, tone: 'blue', title: 'Clear reports', text: 'Download earnings, purchase and tax reports as PDF or Excel any time.' },
] as const;

export function HomePage() {
  const testimonials = useQuery({ queryKey: ['testimonials'], queryFn: listTestimonials }).data?.data ?? [];
  const posts = useQuery({ queryKey: ['posts', 'home'], queryFn: () => listPosts(1, 3) }).data?.data ?? [];
  const ads = useQuery({ queryKey: ['home-ads'], queryFn: homeAds }).data?.data ?? [];

  return (
    <>
      <Hero />

      <section className="py-16 sm:py-22">
        <div className="container-page">
          <SectionHeading kicker="Explore" title="Browse by category" description="Products to buy, services to book and projects to commission, all from vetted businesses." />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CATEGORIES.map((c) => (
              <Link key={c.title} to={c.to} className="group">
                <Card hover className="h-full p-5.5">
                  <IconTile icon={c.icon} tone={c.tone} size="lg" />
                  <h3 className="mt-4 flex items-center gap-1.5 text-[16px] font-bold">{c.title}<ArrowRight className="size-4 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" /></h3>
                  <p className="mt-1 text-[13.5px] text-muted">{c.text}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <FeaturedSections />

      <section className="border-y border-line-2 bg-canvas py-16 sm:py-22">
        <div className="container-page">
          <SectionHeading center kicker="How it works" title="Three steps to get started" />
          <ol className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Card className="h-full p-7">
                  <span className="mb-4.5 grid size-8 place-items-center rounded-full bg-brand-50 text-[13px] font-bold text-brand-600">{i + 1}</span>
                  <h3 className="text-lg font-bold">{s.title}</h3>
                  <p className="mt-2 text-[14.5px] text-muted">{s.text}</p>
                </Card>
              </li>
            ))}
          </ol>
          <div className="mt-8 text-center"><ButtonLink to="/how-it-works" variant="outline" rightIcon={<ArrowRight className="size-4" />}>Learn more</ButtonLink></div>
        </div>
      </section>

      <section className="py-16 sm:py-22">
        <div className="container-page">
          <div className="relative grid items-center gap-12 overflow-hidden rounded-xl2 bg-navy-950 p-7 text-white sm:p-14 lg:grid-cols-2">
            <div aria-hidden className="absolute -top-30 -right-30 size-[420px] rounded-full bg-[radial-gradient(circle,rgb(109_74_232/0.35),transparent_65%)]" />
            <div className="relative">
              <div className="text-[13px] font-bold tracking-[0.08em] text-[#a5b8ff] uppercase">Referral program</div>
              <h2 className="mt-2 text-[28px] leading-tight font-extrabold tracking-tight sm:text-4xl">Your network is worth more than you think</h2>
              <p className="mt-3 text-[#b8c3e0]">Every member gets a personal referral link. See who joined through you, the business they do, and your earnings in real time.</p>
              <ul className="mt-6 grid gap-3.5">
                {[[Link2, 'One-tap share to WhatsApp, SMS and email'], [GitBranch, 'Clear view of direct and indirect referrals'], [ReceiptIndianRupee, 'Every reward recorded in a transparent ledger']].map(([Icon, t]) => {
                  const I = Icon as typeof Link2;
                  return <li key={t as string} className="flex gap-3 text-[15px] text-[#dfe6fb]"><I className="mt-0.5 size-[18px] flex-none text-[#7c9bff]" />{t as string}</li>;
                })}
              </ul>
              <ButtonLink to="/register" variant="white" className="mt-7" rightIcon={<ArrowRight className="size-4" />}>Get my referral link</ButtonLink>
            </div>
            <div className="relative grid gap-3">
              {[[Share2, 'You share your link', 'justreference.in/r/YOURCODE'], [UserPlus, 'A friend joins & buys', 'Linked to you automatically'], [Wallet, 'Reward credited to your wallet', 'Withdraw to your bank account']].map(([Icon, t, s]) => {
                const I = Icon as typeof Share2;
                return (
                  <div key={t as string} className="flex items-center gap-3.5 rounded-[14px] border border-white/10 bg-white/6 px-4.5 py-4">
                    <span className="grid size-10 flex-none place-items-center rounded-[10px] bg-[#7c9bff]/15 text-[#a5b8ff]"><I className="size-[18px]" /></span>
                    <div><b className="block text-[15px]">{t as string}</b><span className="text-[13px] text-[#9fb0d6]">{s as string}</span></div>
                  </div>
                );
              })}
              <p className="text-[12.5px] text-[#8a99c2]">Reward amounts and eligibility are set by JustReference and shown in your dashboard.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16 sm:pb-22">
        <div className="container-page">
          <SectionHeading kicker="Why JustReference" title="Built for buyers, vendors and members" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <Card key={b.title} className="p-6.5">
                <IconTile icon={b.icon} tone={b.tone} />
                <h3 className="mt-4 text-[16.5px] font-bold">{b.title}</h3>
                <p className="mt-1.5 text-[14.5px] text-muted">{b.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {ads.length > 0 && <section className="pb-12"><div className="container-page grid gap-4 sm:grid-cols-2">{ads.slice(0, 4).map((a) => <AdCard key={a.id} ad={a} />)}</div></section>}

      {testimonials.length > 0 && <section className="border-y border-line-2 bg-canvas py-16 sm:py-22">
        <div className="container-page">
          <SectionHeading kicker="Testimonials" title="What our community says" />
          <div className="grid gap-5 md:grid-cols-3">
            {testimonials.map((t) => (
              <Card key={t.id} className="flex flex-col gap-4.5 p-7">
                <blockquote className="text-[15.5px] leading-relaxed text-ink-2">“{t.quote}”</blockquote>
                <figcaption className="mt-auto flex items-center gap-3">
                  <Avatar name={t.name} size={40} />
                  <div><b className="block text-[14.5px]">{t.name}</b><span className="text-[13px] text-muted">{t.role}</span></div>
                </figcaption>
              </Card>
            ))}
          </div>
        </div>
      </section>}

      {posts.length > 0 && <section className="py-16 sm:py-22">
        <div className="container-page">
          <SectionHeading
            kicker="From the blog"
            title="Guides & updates"
            action={<div className="flex items-center gap-3"><Link to="/blog" className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-brand-600">Read the blog <ArrowRight className="size-4" /></Link></div>}
          />
          <div className="grid gap-5 md:grid-cols-3">
            {posts.map((p) => (
              <Link key={p.slug} to={`/blog/${p.slug}`} className="group">
                <Card hover className="h-full overflow-hidden">
                  <div className="p-4.5">
                    <time dateTime={p.publishedAt!} className="text-[12.5px] font-medium text-muted">
                      {new Date(p.publishedAt!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </time>
                    <h3 className="mt-1.5 text-[16px] leading-snug font-bold group-hover:text-brand-600">{p.title}</h3>
                    <p className="mt-1.5 text-[14px] text-muted">{p.excerpt}</p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>}

      <section>
        <div className="container-page">
          <div className="rounded-xl2 bg-[radial-gradient(600px_300px_at_20%_0%,rgb(255_255_255/0.12),transparent_60%),linear-gradient(135deg,var(--color-navy-800),var(--color-brand-600)_60%,var(--color-accent-600))] px-6 py-12 text-center text-white sm:p-16">
            <h2 className="text-[28px] leading-tight font-extrabold tracking-tight sm:text-[40px]">Grow your business with every reference</h2>
            <p className="mx-auto mt-3 mb-7 max-w-xl text-[17px] text-[#dbe4ff]">Join as a member to buy and earn, or register your business to reach new customers.</p>
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink to="/register" variant="white" size="lg">Join as a member</ButtonLink>
              <ButtonLink to="/register?type=vendor" variant="glass" size="lg">Register your business</ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
