import { money, moneyShort } from '@/lib/format'

export type Point = { label: string; value: number; sub?: string }

/** กราฟแท่งแนวตั้ง วาดด้วย SVG ตรง ๆ ไม่ต้องพึ่งไลบรารีภายนอก */
export function BarChart({ data, height = 180 }: { data: Point[]; height?: number }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-mute">ยังไม่มีข้อมูลในช่วงนี้</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)
  const width = Math.max(data.length * 26, 320)
  const gap = 4
  const barWidth = (width - gap * (data.length - 1)) / data.length

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="กราฟยอดขายรายวัน"
      >
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <line
            key={r}
            x1={0}
            x2={width}
            y1={height - height * r}
            y2={height - height * r}
            stroke="#222d4d"
            strokeWidth={1}
          />
        ))}
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * (height - 8), d.value > 0 ? 3 : 0)
          return (
            <rect
              key={d.label + i}
              x={i * (barWidth + gap)}
              y={height - h}
              width={barWidth}
              height={h}
              rx={2}
              fill="url(#barGrad)"
            >
              <title>{`${d.label}: ${money(d.value)} บาท`}</title>
            </rect>
          )
        })}
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c8cff" />
            <stop offset="100%" stopColor="#4353f0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-mute">
        <span>{data[0]?.label}</span>
        <span>สูงสุด {moneyShort(max)} บาท</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  )
}

/** แถบเปรียบเทียบแนวนอน ใช้กับอันดับเกม / อันดับลูกค้า */
export function RankBars({ data, unit = 'บาท' }: { data: Point[]; unit?: string }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-mute">ยังไม่มีข้อมูล</p>
  }
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <ul className="space-y-3">
      {data.map((d, i) => (
        <li key={d.label + i}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-200">
              <span className="mr-2 text-xs text-mute">{i + 1}.</span>
              {d.label}
            </span>
            <span className="shrink-0 font-medium text-white">
              {money(d.value)} <span className="text-xs font-normal text-mute">{unit}</span>
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-linear-to-r from-brand-400 to-brand-600"
              style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }}
            />
          </div>
          {d.sub ? <p className="mt-1 text-xs text-mute">{d.sub}</p> : null}
        </li>
      ))}
    </ul>
  )
}
