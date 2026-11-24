import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatINR } from '@jr/shared/money';
import { Card, CardHeader, Segmented, Skeleton } from '@/design-system';

const BLUE = '#2f5bea';
const VIOLET = '#6d4ae8';
const axis = { fontSize: 11.5, fill: '#94a3b8' };

type Range = '3M' | '6M' | '12M';
const RANGE_N: Record<Range, number> = { '3M': 3, '6M': 6, '12M': 12 };

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-[12.5px] text-muted">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}

function MoneyTooltip({ active, payload, label, names }: { active?: boolean; payload?: { value: number; dataKey: string; color: string }[]; label?: string; names: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] shadow-card">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-muted">
          <i className="inline-block size-2 rounded-full" style={{ background: p.color }} />
          {names[p.dataKey]}: <b className="text-ink">{formatINR(p.value)}</b>
        </p>
      ))}
    </div>
  );
}

/** Two-series money trend (area + dashed line) with a range switcher. Values are paise. */
export function MoneyTrendCard({ title, data, names, loading }: { title: string; data?: { month: string; a: number; b: number }[]; names: { a: string; b: string }; loading?: boolean }) {
  const [range, setRange] = useState<Range>('12M');
  const rows = data?.slice(-RANGE_N[range]) ?? [];
  return (
    <Card className="p-5">
      <CardHeader
        title={title}
        description={`Last ${RANGE_N[range]} months`}
        actions={<Segmented label="Range" value={range} onChange={setRange} options={(['3M', '6M', '12M'] as Range[]).map((r) => ({ value: r, label: r }))} />}
      />
      <Legend items={[[names.a, BLUE], ...(names.b ? [[names.b, VIOLET] as [string, string]] : [])]} />
      {loading ? <Skeleton className="h-60 w-full" /> : (
        <div className="h-60" role="img" aria-label={`${title} chart`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={BLUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatINR(v, { compact: true })} />
              <Tooltip content={<MoneyTooltip names={names} />} cursor={{ stroke: '#cfd6e4' }} />
              <Area type="monotone" dataKey="a" stroke={BLUE} strokeWidth={2.5} fill="url(#fillA)" activeDot={{ r: 5, strokeWidth: 2.5, fill: '#fff' }} />
              {names.b && <Area type="monotone" dataKey="b" stroke={VIOLET} strokeWidth={2} strokeDasharray="5 5" fill="none" activeDot={{ r: 4 }} />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/** Grouped bar chart for counts (e.g. user growth). */
export function CountBarsCard({ title, description, data, keys, loading }: { title: string; description?: string; data?: Record<string, string | number>[]; keys: { key: string; label: string }[]; loading?: boolean }) {
  const colors = [BLUE, VIOLET];
  return (
    <Card className="p-5">
      <CardHeader title={title} description={description} />
      <Legend items={keys.map((k, i) => [k.label, colors[i % 2]!])} />
      {loading ? <Skeleton className="h-60 w-full" /> : (
        <div className="h-60" role="img" aria-label={`${title} chart`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3}>
              <CartesianGrid stroke="#eef1f6" vertical={false} />
              <XAxis dataKey="month" tick={axis} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
              <Tooltip cursor={{ fill: '#f7f8fb' }} contentStyle={{ borderRadius: 8, border: '1px solid #e6e9f0', fontSize: 12.5 }} />
              {keys.map((k, i) => <Bar key={k.key} dataKey={k.key} name={k.label} fill={colors[i % 2]} radius={[5, 5, 0, 0]} maxBarSize={18} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
