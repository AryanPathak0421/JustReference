import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { ScrollReset } from '@/lib/ScrollReset';
import { BadgeCheck, LockKeyhole, WalletCards } from 'lucide-react';
import { Logo } from '@/design-system';
import { useAuth } from '@/features/auth/AuthProvider';
import { homePath, safeNext } from '@/features/auth/guards';

const POINTS = [
  { icon: BadgeCheck, title: 'Verified vendors', text: 'Every business is KYC and GST checked before it can sell.' },
  { icon: LockKeyhole, title: 'Secure by design', text: 'OTP verification, encrypted bank details and audited payouts.' },
  { icon: WalletCards, title: 'Transparent wallet', text: 'Every reward, refund and payout is recorded in your ledger.' },
];

/** Split layout for login, registration and password recovery. */
export function AuthLayout() {
  const { status, user } = useAuth();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  // Already signed in? Skip the login/sign-up screens.
  if (status === 'authenticated' && user && (pathname === '/login' || pathname === '/register')) {
    return <Navigate to={safeNext(params.get('next'), user) ?? homePath(user)} replace />;
  }
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-navy-950 p-12 text-white lg:flex lg:flex-col">
        <div aria-hidden className="absolute -top-40 -right-40 size-[520px] rounded-full bg-[radial-gradient(circle,rgb(109_74_232/0.35),transparent_65%)]" />
        <div aria-hidden className="absolute -bottom-48 -left-32 size-[520px] rounded-full bg-[radial-gradient(circle,rgb(47_91_234/0.3),transparent_65%)]" />
        <Logo light className="relative" />
        <div className="relative mt-auto mb-auto max-w-md">
          <h2 className="text-4xl leading-tight font-extrabold tracking-tight">Find it, buy it, <span className="text-[#a5b8ff]">refer it.</span></h2>
          <p className="mt-4 text-[16px] text-[#b8c3e0]">One account for buying, selling, hiring and earning on India&apos;s reference-powered marketplace.</p>
          <ul className="mt-10 grid gap-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 flex-none place-items-center rounded-xl bg-white/8 text-[#a5b8ff] ring-1 ring-white/10"><Icon className="size-5" /></span>
                <div><p className="font-semibold">{title}</p><p className="text-[14px] text-[#9fb0d6]">{text}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[13px] text-[#8a99c2]">© {new Date().getFullYear()} JustReference.in</p>
      </aside>
      <main className="flex flex-col px-4 py-8 sm:px-10">
        <div className="lg:hidden"><Logo /></div>
        <div className="mx-auto my-auto w-full max-w-[420px] py-10 animate-fade-in">
          <Outlet />
        </div>
      </main>
      <ScrollReset />
    </div>
  );
}
