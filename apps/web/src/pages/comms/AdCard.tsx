import { Link } from 'react-router';

export function AdCard({ ad }: { ad: { title: string; text: string; link: string } }) {
  const body = <><span className="text-[11px] font-bold tracking-wide text-subtle uppercase">Advertisement</span><b className="mt-1 block text-[17px] text-navy-950">{ad.title}</b>{ad.text && <span className="mt-1 block text-[14px] text-ink-2">{ad.text}</span>}</>;
  const cls = 'block rounded-card border border-line bg-white p-6 hover:border-brand-500';
  return !ad.link ? <div className="rounded-card border border-line bg-white p-6">{body}</div> : ad.link.startsWith('/') ? <Link to={ad.link} className={cls}>{body}</Link> : <a href={ad.link} target="_blank" rel="noopener noreferrer nofollow sponsored" className={cls}>{body}</a>;
}

