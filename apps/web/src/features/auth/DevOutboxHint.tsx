import { FlaskConical } from 'lucide-react';

/** Development builds only: explains where OTPs go when the console messaging driver is active. */
export function DevOutboxHint() {
  if (!import.meta.env.DEV) return null;
  return (
    <p className="mt-4 flex items-start gap-2 rounded-xl border border-dashed border-[#f3e2bc] bg-warn-50/60 p-3 text-[12.5px] text-[#7a5212]">
      <FlaskConical className="mt-0.5 size-3.5 flex-none" />
      <span>
        Development: no SMS/WhatsApp provider is connected, so codes are stored in the{' '}
        <a href="/dev/outbox" target="_blank" rel="noreferrer" className="font-semibold underline">dev outbox</a> instead of being sent.
      </span>
    </p>
  );
}
