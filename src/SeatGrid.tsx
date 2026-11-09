import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Status } from './engine/rules.ts'
import { PLAN_GROUPS, planOf, type Model } from './projectData.ts'
import { fmtUsd } from './ui.tsx'

const STATUS_ORDER: Status[] = ['active', 'new', 'unlicensed', 'inactive', 'disabled', 'shared', 'room']
const STATUS_LABEL: Record<Status, string> = { active: 'Active', new: 'New account', unlicensed: 'No paid licence', inactive: 'Inactive', disabled: 'Sign-in blocked', shared: 'Shared mailbox', room: 'Room or equipment' }

interface Tile { upn: string; name: string; plan: string; status: Status | 'removed' | 'changed'; detail: string }

export function useCountUp(target: number, ms = 1400) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setV(target); from.current = target; return }
    const start = performance.now(), a = from.current
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(a + (target - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = target }
  }, [target, ms])
  return v
}

export function SeatGrid({ model, applied, size = 16, gap = 4, onPick, label }: { model: Model; applied: boolean; size?: number; gap?: number; onPick?: (upn: string) => void; label?: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const tiles = useMemo(() => {
    const out: Tile[] = []
    for (const v of model.analysis.users) {
      const rec = v.rec
      const now = planOf(v.user.licenses, model.byId)
      if (applied && rec) {
        const to = planOf(rec.to, model.byId)
        out.push({ upn: v.user.upn, name: v.user.name ?? v.user.upn, plan: to, status: to === 'none' ? 'removed' : 'changed', detail: `${rec.findings[0].text} Saves ${fmtUsd(rec.annual)}/yr.` })
      } else {
        out.push({ upn: v.user.upn, name: v.user.name ?? v.user.upn, plan: now, status: v.status, detail: rec ? `${rec.findings[0].text} Could save ${fmtUsd(rec.annual)}/yr.` : STATUS_LABEL[v.status] })
      }
    }
    const g = (p: string) => PLAN_GROUPS.findIndex(x => x.id === p)
    const st = (s: Tile['status']) => s === 'changed' ? 0 : s === 'removed' ? 99 : STATUS_ORDER.indexOf(s) + 1
    return out.sort((a, b) => g(a.plan) - g(b.plan) || st(a.status) - st(b.status) || a.upn.localeCompare(b.upn))
  }, [model, applied])

  const step = size + gap
  const cols = Math.max(4, Math.floor((width + gap) / step))
  const rows = Math.ceil(tiles.length / cols)
  const present = PLAN_GROUPS.filter(p => tiles.some(t => t.plan === p.id))
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const [focus, setFocus] = useState<Tile | null>(null)

  return (
    <div className="seatgrid">
      <div ref={wrap} className="seat-field" style={{ height: rows * step - gap }} role="img" aria-label={label ?? `${tiles.length} seats grouped by plan`} onMouseLeave={() => setFocus(null)}>
        {tiles.map((t, i) => {
          const x = (i % cols) * step, y = Math.floor(i / cols) * step
          const Tag = onPick ? 'button' : 'span'
          return (
            <Tag key={t.upn} type={onPick ? 'button' : undefined} className={`seat p-${t.plan} s-${t.status}`} title={`${t.name}: ${t.detail}`}
              aria-label={onPick ? `${t.name}, ${t.detail}` : undefined} onClick={onPick ? () => onPick(t.upn) : undefined} onMouseEnter={() => setFocus(t)} onFocus={() => setFocus(t)}
              style={{ width: size, height: size, transform: `translate(${x}px, ${y}px)`, transitionDelay: reduce ? '0ms' : `${Math.min(Math.floor(i / cols) * 22 + (i % cols) * 3, 900)}ms` }} />
          )
        })}
      </div>
      <div className="seat-foot">
        <ul className="seat-legend" aria-label="Plans">
          {present.map(p => <li key={p.id}><i className={`seat p-${p.id} s-active`} aria-hidden="true" />{p.label} <span className="muted">{tiles.filter(t => t.plan === p.id).length}</span></li>)}
          <li><i className="seat p-e3 s-inactive" aria-hidden="true" />Inactive</li>
          <li><i className="seat p-e3 s-disabled" aria-hidden="true" />Blocked</li>
          <li><i className="seat p-e3 s-shared" aria-hidden="true" />Shared / room</li>
        </ul>
        <p className="seat-focus small" aria-live="polite">{focus ? <><strong>{focus.name}</strong> · {focus.detail}</> : <span className="muted">Hover a seat to see who it is and why.</span>}</p>
      </div>
    </div>
  )
}
