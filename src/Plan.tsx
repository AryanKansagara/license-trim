import { useMemo, useState } from 'react'
import { compare, decisionOf, recKey, renewal, snapshotOf, type Snapshot } from './engine/rules.ts'
import { changesCsv, changeScript } from './engine/script.ts'
import { skuNames, type TabProps } from './Project.tsx'
import { deleteSnapshotCloud } from './sync.ts'
import { uuid } from './store.ts'
import { Code, download, Empty, fmtDate, fmtUsd, Link, signed, toast } from './ui.tsx'

export default function Plan(props: TabProps & { tab: 'renewal' | 'script' | 'history' }) {
  if (props.tab === 'renewal') return <Renewal {...props} />
  if (props.tab === 'script') return <Script {...props} />
  return <History {...props} />
}

const slug = (s: string) => s.replace(/\s*\(synthetic\)/, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()

// ---------- Renewal planner ----------

function Renewal({ project, model, update }: TabProps) {
  const [scope, setScope] = useState<'approved' | 'all' | 'none'>('approved')
  const a = model.analysis
  const apply = useMemo(() => new Set(a.recs.filter(r => scope === 'all' || (scope === 'approved' && decisionOf(r, project.decisions) === 'approved')).map(recKey)), [a, scope, project.decisions])
  const headroom = project.settings.headroom
  const rows = renewal(a, model.catalog, project.seats, apply, headroom)
  const tot = rows.reduce((t, r) => ({ now: t.now + (r.annualNow ?? r.assigned * r.sku.price * 12), commit: t.commit + r.annualCommit }), { now: 0, commit: 0 })
  const setSeats = (id: string, v: string) => {
    const seats = { ...project.seats }
    if (v === '') delete seats[id]
    else seats[id] = Math.max(0, Math.round(+v || 0))
    void update({ seats })
  }
  return (
    <div className="stack">
      <div className="card pad stack-sm">
        <h2 className="h4">Seats to commit at renewal</h2>
        <p className="small muted measure">Under New Commerce (CSP) annual terms you can only reduce seats at renewal, and Enterprise Agreements true-up once a year. Commit = seats needed after the chosen changes plus headroom, rounded up. Enter purchased seats (or import the SKU file from the Graph script) to see the change.</p>
        <div className="row gap wrap">
          <div className="seg" role="group" aria-label="Changes to include">
            <button type="button" aria-pressed={scope === 'approved'} onClick={() => setScope('approved')}>Approved changes</button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All recommendations</button>
            <button type="button" aria-pressed={scope === 'none'} onClick={() => setScope('none')}>No changes</button>
          </div>
          <label className="field inline"><span>Headroom</span><input type="number" className="short" min={0} max={50} value={Math.round(headroom * 100)} onChange={e => void update({ settings: { ...project.settings, headroom: Math.min(50, Math.max(0, +e.target.value || 0)) / 100 } })} /> %</label>
        </div>
      </div>
      <div className="table-wrap card">
        <table className="table">
          <thead><tr><th>SKU</th><th className="r">Assigned now</th><th className="r">After changes</th><th className="r">Purchased</th><th className="r">Commit</th><th className="r">Change</th><th className="r">Annual at commit</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sku.id}>
                <td>{r.sku.name}<div className="small muted">{fmtUsd(r.sku.price, 2)}/user/mo</div></td>
                <td className="r num">{r.assigned}</td>
                <td className="r num">{r.after}</td>
                <td className="r"><input aria-label={`Purchased ${r.sku.name}`} className="short r" type="number" min={0} value={project.seats[r.sku.id] ?? ''} placeholder="–" onChange={e => setSeats(r.sku.id, e.target.value)} /></td>
                <td className="r num strong">{r.commit}</td>
                <td className={`r num ${r.change !== null && r.change < 0 ? 'save-t' : ''}`}>{r.change === null ? '–' : signed(r.change, n => String(n))}</td>
                <td className="r num">{fmtUsd(r.annualCommit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6}>Annual at commit vs {Object.keys(project.seats).length ? 'purchased' : 'assigned'} today ({fmtUsd(tot.now)})</td><td className="r num">{fmtUsd(tot.commit)}</td></tr></tfoot>
        </table>
      </div>
      {tot.now > tot.commit && <p className="notice ok">Committing these counts saves <strong>{fmtUsd(tot.now - tot.commit)}</strong> a year against today.</p>}
      {rows.some(r => r.purchased !== null && r.purchased > r.assigned) && <p className="notice warn">Some SKUs have purchased seats nobody is assigned: shelfware you pay for whatever the users do.</p>}
    </div>
  )
}

// ---------- Change script ----------

function Script({ project, model }: TabProps) {
  const [view, setView] = useState<'change' | 'rollback' | 'csv'>('change')
  const approved = model.analysis.recs.filter(r => decisionOf(r, project.decisions) === 'approved')
  const opts = { tenant: project.name, generated: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }
  const change = useMemo(() => changeScript(approved, model.byId, opts), [approved, model])
  const rollback = useMemo(() => changeScript(approved, model.byId, { ...opts, rollback: true }), [approved, model])
  const csv = useMemo(() => changesCsv(model.analysis.recs, model.byId, r => decisionOf(r, project.decisions)), [model, project.decisions])
  const base = slug(project.name)
  if (!approved.length) return (
    <Empty title="Approve some changes first">
      <p className="muted">The script only contains approved recommendations. {model.analysis.recs.length} are waiting for a decision.</p>
      <Link href={`/app/p/${project.id}/recommendations`} className="btn primary">Review recommendations</Link>
    </Empty>
  )
  const monthly = approved.reduce((t, r) => t + r.monthly, 0)
  return (
    <div className="stack">
      <div className="card pad stack-sm">
        <div className="row between wrap gap">
          <div><strong>{approved.length} approved changes</strong> · <span className="save-t num">{fmtUsd(monthly * 12)}/yr</span></div>
          <div className="row gap-sm wrap">
            <button type="button" className="btn primary sm" onClick={() => download(`${base}-changes.ps1`, change, 'text/plain')}>Download change script</button>
            <button type="button" className="btn ghost sm" onClick={() => download(`${base}-rollback.ps1`, rollback, 'text/plain')}>Rollback script</button>
            <button type="button" className="btn ghost sm" onClick={() => download(`${base}-planned-changes.csv`, csv)}>Planned changes CSV</button>
          </div>
        </div>
        <ol className="small steps-sm">
          <li>Run <code>.\{base}-changes.ps1</code> with no switch. It connects, checks every user still holds what will be removed and that nothing is group-assigned, and writes a <code>-dryrun.csv</code> log. Nothing changes.</li>
          <li>Read the log. Then run <code>.\{base}-changes.ps1 -Apply</code>.</li>
          <li>Keep <code>{base}-rollback.ps1</code>: it adds back exactly what was removed (run it within 30 days to keep mailboxes).</li>
        </ol>
      </div>
      <div className="seg" role="group" aria-label="Artifact">
        <button type="button" aria-pressed={view === 'change'} onClick={() => setView('change')}>Change script</button>
        <button type="button" aria-pressed={view === 'rollback'} onClick={() => setView('rollback')}>Rollback</button>
        <button type="button" aria-pressed={view === 'csv'} onClick={() => setView('csv')}>CSV ({model.analysis.recs.length} rows)</button>
      </div>
      <Code code={view === 'change' ? change : view === 'rollback' ? rollback : csv} label={view === 'csv' ? 'CSV: every recommendation with its decision' : 'PowerShell (Microsoft.Graph)'} />
    </div>
  )
}

// ---------- History ----------

const LIVE = 'live'
const monthLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function History({ project, model, update }: TabProps) {
  const live = useMemo(() => snapshotOf(model.analysis, model.catalog, LIVE, `Now (${monthLabel(model.analysis.asOf)}, not saved)`, Date.now()), [model])
  const snaps = [...project.snapshots].sort((a, b) => a.createdAt - b.createdAt)
  const options: Snapshot[] = [...snaps, live]
  const [aId, setA] = useState(snaps.length ? snaps[snaps.length - 1].id : LIVE)
  const [bId, setB] = useState(LIVE)
  const A = options.find(s => s.id === aId) ?? options[0]
  const B = options.find(s => s.id === bId) ?? live
  const c = useMemo(() => compare(A, B), [A, B])
  const name = (upn: string) => model.analysis.users.find(v => v.user.upn === upn)?.user.name ?? upn

  const save = () => {
    const month = monthLabel(model.analysis.asOf)
    const old = project.snapshots.find(s => s.label === month)
    const snap = snapshotOf(model.analysis, model.catalog, uuid(), month, Date.now())
    if (old) void deleteSnapshotCloud(old.id)
    void update({ snapshots: [...project.snapshots.filter(s => s !== old), snap] })
    toast(old ? `Replaced the ${month} snapshot.` : `Saved the ${month} snapshot.`, { tone: 'ok' })
  }
  const remove = (s: Snapshot) => {
    const prev = project.snapshots
    void update({ snapshots: prev.filter(x => x.id !== s.id) })
    void deleteSnapshotCloud(s.id)
    toast(`Deleted snapshot ${s.label}.`, { undo: () => void update({ snapshots: prev }) })
  }

  return (
    <div className="stack">
      <div className="card pad row between wrap gap">
        <div>
          <h2 className="h4">Monthly snapshots</h2>
          <p className="small muted">A snapshot keeps every user's licences and the recommendations at that time. Importing new reports saves one for that month automatically.</p>
        </div>
        <button type="button" className="btn primary" onClick={save}>Save snapshot for {monthLabel(model.analysis.asOf)}</button>
      </div>
      {snaps.length > 0 && (
        <div className="snap-strip">
          {snaps.map(s => (
            <div key={s.id} className="card snap">
              <strong>{s.label}</strong>
              <span className="small muted">as of {fmtDate(s.asOf)}</span>
              <span className="num">{fmtUsd(s.spend)}/mo</span>
              <span className="small save-t num">{fmtUsd(s.identified)}/mo identified</span>
              <button type="button" className="btn danger-ghost sm" onClick={() => remove(s)}>Delete</button>
            </div>
          ))}
        </div>
      )}
      <div className="card pad stack">
        <div className="row gap wrap">
          <label className="field"><span>Compare</span><select value={aId} onChange={e => setA(e.target.value)}>{options.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="field"><span>with</span><select value={bId} onChange={e => setB(e.target.value)}>{options.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        </div>
        <div className="kpis">
          <div className="kpi"><span className="kpi-label">Monthly spend</span><strong className="kpi-value num">{fmtUsd(c.spendBefore)} → {fmtUsd(c.spendAfter)}</strong><span className="small muted">at {A.label} prices</span></div>
          <div className="kpi save"><span className="kpi-label">Savings realised</span><strong className="kpi-value num">{fmtUsd(c.realised * 12)}/yr</strong><span className="small muted">{c.followed.length} recommendations carried out</span></div>
          <div className="kpi"><span className="kpi-label">Still open</span><strong className="kpi-value num">{c.stillOpen}</strong><span className="small muted">recommended then, unchanged since</span></div>
          <div className="kpi"><span className="kpi-label">Accounts</span><strong className="kpi-value num">+{c.joined.length} / −{c.left.length}</strong><span className="small muted">joined / left</span></div>
        </div>
        {c.skus.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>SKU</th><th className="r">{A.label}</th><th className="r">{B.label}</th><th className="r">Change</th></tr></thead>
            <tbody>{c.skus.map(s => <tr key={s.id}><td>{model.byId.get(s.id)?.name ?? s.id}</td><td className="r num">{s.before}</td><td className="r num">{s.after}</td><td className="r num">{signed(s.after - s.before, n => String(n))}</td></tr>)}</tbody>
          </table></div>
        )}
        {[['Changes that followed a recommendation', c.followed], ['Other licence changes', c.other]].map(([title, list]) => (list as typeof c.followed).length > 0 && (
          <div key={title as string}>
            <h3 className="h5">{title as string}</h3>
            <ul className="change-list">
              {(list as typeof c.followed).map(ch => <li key={ch.upn}><span>{name(ch.upn)}</span><span className="small muted">{skuNames(ch.before, model) || 'none'} → {skuNames(ch.after, model) || 'none'}</span><span className={`num ${ch.monthly > 0 ? 'save-t' : ''}`}>{signed(-ch.monthly * 12, n => fmtUsd(n))}/yr</span></li>)}
            </ul>
          </div>
        ))}
        {A.id === B.id && <p className="muted">Pick two different snapshots to compare.</p>}
        {A.id !== B.id && !c.followed.length && !c.other.length && <p className="muted">No licence changes between these two.</p>}
      </div>
    </div>
  )
}
