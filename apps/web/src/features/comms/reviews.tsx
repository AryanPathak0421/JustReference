import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { Button, Card, CardHeader, Field, Textarea } from '@/design-system';
import { fmtDate } from '@/features/dashboard/widgets';
import { errorMessage } from '@/lib/api';
import { myReview, saveReview, vendorReviews } from './api';
import { Stars } from './components';

export function VendorReviews({ slug }: { slug: string }) {
  const { data } = useQuery({ queryKey: ['reviews', slug], queryFn: () => vendorReviews(slug) });
  if (!data?.count) return null;
  return (
    <Card className="mt-6 p-6"><h2 className="flex flex-wrap items-center gap-3 text-[18px] font-bold">Reviews <Stars value={data.average ?? 0} /> <span className="text-[14px] font-normal text-muted">{data.average} from {data.count}</span></h2>
      <ul className="mt-4 grid gap-4">{data.data.map((r) => <li key={r.id} className="border-t border-line-2 pt-4"><p className="flex flex-wrap items-center gap-2 text-[14px]"><Stars value={r.rating} /><b>{r.name}</b><span className="text-muted">{fmtDate(r.createdAt)}</span></p>{r.comment && <p className="mt-1 text-[14.5px] break-words text-ink-2">{r.comment}</p>}</li>)}</ul>
    </Card>
  );
}

export function ReviewBox({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const { data, isSuccess } = useQuery({ queryKey: ['my-review', orderId], queryFn: () => myReview(orderId) });
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setRating(data.rating); setComment(data.comment); } }, [data]);
  if (!isSuccess) return null;
  const go = async () => { setBusy(true); try { await saveReview(orderId, { rating, comment }); toast.success('Thank you. It appears once our team has checked it.'); qc.invalidateQueries({ queryKey: ['my-review', orderId] }); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <Card className="p-5"><CardHeader title={data ? 'Your review' : 'Rate this vendor'} description={data ? `Status: ${data.status}` : undefined} />
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => setRating(n)} className="p-1"><Star className={n <= rating ? 'size-6 fill-[#f5b301] text-[#f5b301]' : 'size-6 text-subtle'} /></button>)}</div>
      <Field label="Comment" className="mt-3">{({ id }) => <Textarea id={id} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
      <Button className="mt-3" size="sm" loading={busy} disabled={!rating} onClick={go}>{data ? 'Update review' : 'Send review'}</Button>
    </Card>
  );
}
