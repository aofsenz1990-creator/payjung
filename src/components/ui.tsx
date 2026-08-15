import { money, num } from '@/lib/format'
import { SALE_STATUS, type SaleStatus } from '@/lib/constants'

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-mute">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function StatCard({
  label,
  value,
  unit,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  tone?: 'default' | 'good' | 'bad' | 'warn'
}) {
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'bad'
        ? 'text-bad'
        : tone === 'warn'
          ? 'text-warn'
          : 'text-white'
  return (
    <div className="card">
      <p className="text-xs font-medium text-mute">{label}</p>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${toneClass}`}>
        {value}
        {unit ? <span className="ml-1 text-sm font-medium text-mute">{unit}</span> : null}
      </p>
      {hint ? <p className="mt-1 text-xs text-mute">{hint}</p> : null}
    </div>
  )
}

export function MoneyStat(props: {
  label: string
  amount: number
  hint?: string
  tone?: 'default' | 'good' | 'bad' | 'warn'
}) {
  return (
    <StatCard
      label={props.label}
      value={money(props.amount)}
      unit="บาท"
      hint={props.hint}
      tone={props.tone}
    />
  )
}

export function CountStat(props: { label: string; count: number; unit?: string; hint?: string }) {
  return <StatCard label={props.label} value={num(props.count)} unit={props.unit} hint={props.hint} />
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 px-4 py-10 text-center text-sm text-mute">
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'brand'
}) {
  const map = {
    neutral: 'bg-ink-800 text-slate-300',
    good: 'bg-good/15 text-good',
    bad: 'bg-bad/15 text-bad',
    warn: 'bg-warn/15 text-warn',
    brand: 'bg-brand-500/15 text-brand-400',
  } as const
  return <span className={`chip ${map[tone]}`}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const key = (status in SALE_STATUS ? status : 'paid') as SaleStatus
  const tone = key === 'paid' ? 'good' : key === 'pending' ? 'warn' : 'bad'
  return <Badge tone={tone}>{SALE_STATUS[key]}</Badge>
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-white">{children}</h2>
      {right}
    </div>
  )
}
