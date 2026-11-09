import { useEffect, useMemo, useRef, useState } from 'react'
import { decisionOf, recKey, REASON_LABEL, type Confidence, type Decision, type Reason, type Rec } from './engine/rules.ts'
import { CONF_LABEL, skuNames, type TabProps } from './Project.tsx'
import { fmtUsd, toast } from './ui.tsx'

type DFilter = 'all' | 'pending' | Decision

export default function Recs({ project, model, update, openUser }: TabProps) {
  const q0 = new URLSearchParams(location.search)
  const [q, setQ] = useState(q0.get('q') ?? '')
  const [reason, setReason] = useState<Reason | 'all'>((q0.get('reason') as Reason) ?? 'all')
  const [conf, setConf] = useState<Confidence | 'all'>('all')
  const [dec, setDec] = useState<DFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const search = useRef<HTMLInputElement>(null)
  const recs = model.analysis.recs
  const decisions = project.decisions
  const rows = useMemo(() => recs.filter(r =>
    (reason === 'all' || r.reason === reason) && (conf === 'all' || r.confidence === conf) && (dec === 'all' || decisionOf(r, decisions) === dec) &&
    (!q || `${r.upn} ${r.name}`.toLowerCase().includes(q.toLowerCase()))), [recs, reason, conf, dec, q, decisions])

  const setMany = (list: Rec[], d: Decision | null, msg: string) => {
    const prev = project.decisions
    const next = { ...prev }
    for (const r of list) { if (d) next[recKey(r)] = d; else delete next[recKey(r)] }
    void update({ decisions: next })
    toast(msg, { undo: () => void update({ decisions: prev }) })
  }
  const decide = (r: Rec, d: Decision) => {
    const next = { ...project.decisions }
    if (next[recKey(r)] === d) delete next[recKey(r)]
    else next[recKey(r)] = d
    void update({ decisions: next })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select')) { e.preventDefault(); search.current?.focus() }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const reasons = [...new Set(recs.map(r => r.reason))]
  const sum = (l: Rec[]) => l.reduce((t, r) => t + r.monthly, 0)
  const approved = recs.filter(r => decisionOf(r, decisions) === 'approved')
  const pendingHigh = rows.filter(r => r.confidence === 'high' && decisionOf(r, decisions) === 'pending')

  return (
    <div className="stack">
      <div className="card pad row between wrap gap">
        <div>
          <strong className="num">{approved.length}</strong> of {recs.length} approved · <span className="save-t num">{fmtUsd(sum(approved) * 12)}/yr</span> approved of <span className="num">{fmtUsd(sum(recs) * 12)}/yr</span> identified
          <div className="progress" aria-hidden="true"><div style={{ width: `${recs.length ? approved.length / recs.length * 100 : 0}%` }} /></div>
        </div>
        <div className="row gap-sm wrap">
          <button type="button" className="btn primary sm" disabled={!pendingHigh.length} onClick={() => setMany(pendingHigh, 'approved', `Approved ${pendingHigh.length} high-confidence changes.`)}>Approve {pendingHigh.length} high confidence</button>
          <button type="button" className="btn ghost sm" disabled={!rows.length} onClick={() => setMany(rows, null, `Reset ${rows.length} decisions to pending.`)}>Reset shown</button>
        </div>
      </div>
      <div className="row gap-sm wrap">
        <label className="field grow"><span className="sr-only">Search</span><input ref={search} type="search" placeholder="Search user (press /)" value={q} onChange={e => setQ(e.target.value)} /></label>
        <label className="field"><span className="sr-only">Finding</span><select value={reason} onChange={e => setReason(e.target.value as Reason | 'all')}><option value="all">All findings</option>{reasons.map(r => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</select></label>
        <label className="field"><span className="sr-only">Confidence</span><select value={conf} onChange={e => setConf(e.target.value as Confidence | 'all')}><option value="all">Any confidence</option>{(['high', 'medium', 'low'] as const).map(c => <option key={c} value={c}>{CONF_LABEL[c]}</option>)}</select></label>
        <label className="field"><span className="sr-only">Decision</span><select value={dec} onChange={e => setDec(e.target.value as DFilter)}><option value="all">Any decision</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
      </div>
      <p className="small muted">{rows.length} shown · {fmtUsd(sum(rows) * 12)}/yr. Focus a row and press <kbd>A</kbd> to approve or <kbd>R</kbd> to reject.</p>
      <ul className="rec-list">
        {rows.map(r => {
          const d = decisionOf(r, decisions)
          const k = recKey(r)
          return (
            <li key={k} className={`rec card d-${d}`} tabIndex={0} onKeyDown={e => {
              if ((e.target as HTMLElement) !== e.currentTarget) return
              if (e.key === 'a') decide(r, 'approved')
              if (e.key === 'r') decide(r, 'rejected')
              if (e.key === 'Enter') setOpen(open === k ? null : k)
            }}>
              <div className="rec-main">
                <div className="rec-who">
                  <button type="button" className="linkish strong" onClick={() => openUser(r.upn)}>{r.name}</button>
                  <div className="small muted break">{r.upn}</div>
                </div>
                <div className="rec-change">
                  <span className={`pill c-${r.confidence}`} title={`${CONF_LABEL[r.confidence]} confidence`}>{REASON_LABEL[r.reason]}</span>
                  <div className="small">
                    <span className="from">{skuNames(r.remove, model)}</span>
                    {r.add.length > 0 && <> → <span className="to">{skuNames(r.add, model)}</span></>}
                    {!r.add.length && r.to.length === 0 && <span className="muted"> → no paid licence</span>}
                  </div>
                </div>
                <div className="rec-save r"><strong className="save-t num">{fmtUsd(r.annual)}</strong><div className="small muted num">{fmtUsd(r.monthly, 2)}/mo</div></div>
                <div className="rec-act" role="group" aria-label={`Decision for ${r.name}`}>
                  <button type="button" className={`btn sm ${d === 'approved' ? 'primary' : 'ghost'}`} aria-pressed={d === 'approved'} onClick={() => decide(r, 'approved')}>Approve</button>
                  <button type="button" className={`btn sm ${d === 'rejected' ? 'danger' : 'ghost'}`} aria-pressed={d === 'rejected'} onClick={() => decide(r, 'rejected')}>Reject</button>
                  <button type="button" className="icon-btn" aria-expanded={open === k} aria-label="Evidence" onClick={() => setOpen(open === k ? null : k)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ transform: open === k ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}><path d="m6 9 6 6 6-6" /></svg>
                  </button>
                </div>
              </div>
              {open === k && (
                <div className="rec-more small">
                  <ul>{r.findings.map((f, i) => <li key={i}><strong>{REASON_LABEL[f.reason]}</strong> ({CONF_LABEL[f.confidence].toLowerCase()}): {f.text}</li>)}</ul>
                  {r.caveats.length > 0 && <ul className="muted">{r.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                  <p className="muted">Now: {skuNames(r.from, model) || 'none'} · After: {skuNames(r.to, model) || 'no paid licence'}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {!rows.length && <p className="muted center">{recs.length ? 'Nothing matches these filters.' : 'No recommendations: every licence matches its use with the current settings.'}</p>}
    </div>
  )
}
