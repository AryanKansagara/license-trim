import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { REASON_LABEL, type Confidence, type Reason, type Status, type UserView } from './engine/rules.ts'
import { buildModel, useModel, useProject, type Model } from './projectData.ts'
import { SeatGrid } from './SeatGrid.tsx'
import { Empty, fmtDate, fmtNum, fmtUsd, go, Link, Modal, SyntheticBadge } from './ui.tsx'
import { decisionOf, recKey } from './engine/rules.ts'
import type { Dataset, Project } from './store.ts'

const Recs = lazy(() => import('./Recs.tsx'))
const Plan = lazy(() => import('./Plan.tsx'))
const Data = lazy(() => import('./Data.tsx'))

const TABS = [['overview', 'Overview'], ['recommendations', 'Recommendations'], ['users', 'Users'], ['renewal', 'Renewal'], ['script', 'Change script'], ['history', 'History'], ['data', 'Data']] as const

export const CONF_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' }
export const STATUS_LABEL: Record<Status, string> = { active: 'Active', new: 'New', unlicensed: 'Unlicensed', inactive: 'Inactive', disabled: 'Blocked', shared: 'Shared mailbox', room: 'Room / equipment' }

export interface TabProps { project: Project; ds: Dataset; model: Model; update: (p: Partial<Project>) => unknown; openUser: (upn: string) => void }

export default function ProjectView({ id, tab }: { id: string; tab: string }) {
  const { loading, project, ds, update } = useProject(id)
  const model = useModel(project, ds)
  const [user, setUser] = useState<string | null>(null)
  useEffect(() => { if (project) document.title = `${project.name} · License Trim` }, [project?.name])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input,textarea,select,dialog')) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) go(`/app/p/${id}/${TABS[n - 1][0]}`, { keepScroll: true })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [id])

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Loading tenant</div>
  if (!project || !ds || !model) return (
    <section className="page narrow center">
      <h1>Tenant not found</h1>
      <p className="muted">It may have been deleted on this device, or it has not synced here yet.</p>
      <Link href="/app" className="btn primary">All tenants</Link>
    </section>
  )
  const hasData = ds.sources.length > 0
  const pending = model.analysis.recs.filter(r => decisionOf(r, project.decisions) === 'pending').length
  const props: TabProps = { project, ds, model, update, openUser: setUser }
  const current = TABS.some(t => t[0] === tab) ? tab : 'overview'
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow"><Link href="/app">Tenants</Link> / {project.sampleId ? 'Synthetic sample' : 'Tenant'}</p>
          <h1>{project.name.replace(' (synthetic)', '')} {project.sampleId && <SyntheticBadge />}</h1>
          <p className="muted small">{hasData ? `${fmtNum(model.analysis.totals.users)} accounts · usage as of ${fmtDate(model.analysis.asOf)} · ${project.imports.length} reports imported` : 'No reports imported yet'}</p>
        </div>
        <div className="row gap-sm wrap">
          {hasData && <Link href={`/app/p/${id}/report`} className="btn ghost">Cost report</Link>}
          {hasData && <Link href={`/app/p/${id}/script`} className="btn primary">Change script</Link>}
        </div>
      </div>
      <nav className="tabs" aria-label="Tenant sections">
        {TABS.map(([k, l], i) => (
          <Link key={k} href={`/app/p/${id}/${k}`} aria-current={current === k ? 'page' : undefined} title={`Shortcut: ${i + 1}`}>
            {l}{k === 'recommendations' && hasData && pending > 0 && <span className="count">{pending}</span>}
          </Link>
        ))}
      </nav>
      {project.dataMissing && !project.sampleId && <div className="notice warn">This tenant synced from another device without its report data (over the sync size limit). Decisions, prices and history are here; import the reports again to see users.</div>}
      <Suspense fallback={<div className="boot" role="status"><span className="spinner" /> Loading</div>}>
        {!hasData && current !== 'data' ? (
          <Empty title="Import your Microsoft 365 exports" icon={<div className="empty-seats" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} />)}</div>}>
            <p className="muted">Start with the Active users export, or the one-CSV Graph script. Each extra usage report sharpens the recommendations.</p>
            <div className="row gap center-x wrap">
              <Link href={`/app/p/${id}/data?import=1`} className="btn primary">Import files</Link>
              <Link href="/docs" className="btn ghost">How to export</Link>
            </div>
          </Empty>
        ) : (
          <>
            {current === 'overview' && <Overview {...props} />}
            {current === 'recommendations' && <Recs {...props} />}
            {current === 'users' && <Users {...props} />}
            {(current === 'renewal' || current === 'script' || current === 'history') && <Plan {...props} tab={current} />}
            {current === 'data' && <Data {...props} />}
          </>
        )}
      </Suspense>
      <UserDrawer model={model} project={project} upn={user} onClose={() => setUser(null)} />
    </section>
  )
}

// ---------- Overview ----------

function Overview({ project, model, openUser }: TabProps) {
  const a = model.analysis, t = a.totals
  const [after, setAfter] = useState(false)
  const approved = a.recs.filter(r => decisionOf(r, project.decisions) === 'approved')
  const approvedMonthly = approved.reduce((s, r) => s + r.monthly, 0)
  const reasons = (Object.entries(t.byReason) as [Reason, { count: number; monthly: number }][]).sort((x, y) => y[1].monthly - x[1].monthly)
  const maxR = Math.max(1, ...reasons.map(r => r[1].monthly))
  const skuRows = Object.entries(a.skuCounts).map(([id, c]) => ({ sku: model.byId.get(id)!, ...c })).filter(r => r.sku && r.sku.price > 0).sort((x, y) => y.now * y.sku.price - x.now * x.sku.price)
  const inactive = a.users.filter(u => u.status === 'inactive').length
  return (
    <div className="stack-lg">
      <div className="kpis">
        <Kpi label="Monthly licence spend" value={fmtUsd(t.monthlySpend)} sub={`${fmtNum(t.licensed)} licensed accounts at list price`} />
        <Kpi label="Savings identified" value={`${fmtUsd(t.annualSaving)}/yr`} sub={`${fmtUsd(t.monthlySaving)} a month · ${t.monthlySpend ? Math.round(t.monthlySaving / t.monthlySpend * 100) : 0}% of spend`} tone="save" />
        <Kpi label="Approved so far" value={`${fmtUsd(approvedMonthly * 12)}/yr`} sub={`${approved.length} of ${a.recs.length} recommendations`} />
        <Kpi label="Inactive accounts" value={fmtNum(inactive)} sub={`No sign-in or activity in ${project.settings.inactiveDays} days`} />
      </div>
      <div className="card pad">
        <div className="row between wrap gap-sm">
          <h2 className="h4">Every seat in the tenant</h2>
          <div className="seg" role="group" aria-label="Seat view">
            <button type="button" aria-pressed={!after} onClick={() => setAfter(false)}>Today</button>
            <button type="button" aria-pressed={after} onClick={() => setAfter(true)}>After recommendations</button>
          </div>
        </div>
        <SeatGrid model={model} applied={after} size={18} gap={4} onPick={openUser} />
      </div>
      <div className="grid-2">
        <div className="card pad">
          <h2 className="h4">Savings by finding</h2>
          <ul className="bars">
            {reasons.map(([r, v]) => (
              <li key={r}>
                <Link href={`/app/p/${project.id}/recommendations?reason=${r}`} className="bar-label">{REASON_LABEL[r]} <span className="muted">· {v.count}</span></Link>
                <div className="bar-track"><div className={`bar-fill r-${r}`} style={{ width: `${v.monthly / maxR * 100}%` }} /></div>
                <span className="num">{fmtUsd(v.monthly * 12)}</span>
              </li>
            ))}
          </ul>
          {!reasons.length && <p className="muted">No savings found with the current settings.</p>}
        </div>
        <div className="card pad">
          <h2 className="h4">Savings by confidence</h2>
          <div className="conf-bar" role="img" aria-label={`High ${fmtUsd(t.byConfidence.high * 12)}, medium ${fmtUsd(t.byConfidence.medium * 12)}, low ${fmtUsd(t.byConfidence.low * 12)} a year`}>
            {(['high', 'medium', 'low'] as const).map(c => t.byConfidence[c] > 0 && <div key={c} className={`c-${c}`} style={{ flex: t.byConfidence[c] }} />)}
          </div>
          <dl className="conf-legend">
            {(['high', 'medium', 'low'] as const).map(c => <div key={c}><dt><i className={`dot c-${c}`} />{CONF_LABEL[c]}</dt><dd className="num">{fmtUsd(t.byConfidence[c] * 12)}/yr</dd></div>)}
          </dl>
          <p className="small muted">High: the data leaves no doubt (blocked, inactive on two sources, duplicate, shared mailbox under 50 GB). Medium: usage supports it but someone should confirm (E5 to E3, Teams-only to F3, no desktop use). Low: partial data.</p>
        </div>
      </div>
      <div className="card pad">
        <h2 className="h4">Spend by SKU</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>SKU</th><th className="r">Price</th><th className="r">Assigned</th><th className="r">After</th><th className="r">Monthly now</th><th className="r">Monthly after</th></tr></thead>
            <tbody>
              {skuRows.map(r => <tr key={r.sku.id}><td>{r.sku.name}</td><td className="r num">{fmtUsd(r.sku.price, 2)}</td><td className="r num">{r.now}</td><td className="r num">{r.after}</td><td className="r num">{fmtUsd(r.now * r.sku.price)}</td><td className="r num">{fmtUsd(r.after * r.sku.price)}</td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="r num">{fmtUsd(t.monthlySpend)}</td><td className="r num">{fmtUsd(t.monthlyAfter)}</td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'save' }) {
  return <div className={`kpi card${tone ? ' ' + tone : ''}`}><span className="kpi-label">{label}</span><strong className="kpi-value num">{value}</strong>{sub && <span className="small muted">{sub}</span>}</div>
}

// ---------- Users ----------

function Users({ model, openUser }: TabProps) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [limit, setLimit] = useState(100)
  const rows = useMemo(() => model.analysis.users.filter(v => (status === 'all' || v.status === status) && (!q || `${v.user.upn} ${v.user.name ?? ''} ${v.user.department ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [model, q, status])
  const counts = useMemo(() => { const c: Partial<Record<Status, number>> = {}; for (const v of model.analysis.users) c[v.status] = (c[v.status] ?? 0) + 1; return c }, [model])
  return (
    <div className="stack">
      <div className="row gap-sm wrap">
        <label className="field grow"><span className="sr-only">Search users</span><input type="search" placeholder="Search name, UPN or department" value={q} onChange={e => setQ(e.target.value)} /></label>
        <label className="field"><span className="sr-only">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as Status | 'all')}>
            <option value="all">All statuses ({model.analysis.users.length})</option>
            {(Object.keys(STATUS_LABEL) as Status[]).filter(s => counts[s]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]} ({counts[s]})</option>)}
          </select>
        </label>
      </div>
      <div className="table-wrap card">
        <table className="table">
          <thead><tr><th>User</th><th>Status</th><th>Licences</th><th>Last seen</th><th className="r">Mailbox</th><th>Desktop apps</th><th className="r">Monthly</th><th>Recommendation</th></tr></thead>
          <tbody>
            {rows.slice(0, limit).map(v => (
              <tr key={v.user.upn} className="click" onClick={() => openUser(v.user.upn)}>
                <td><button type="button" className="linkish" onClick={e => { e.stopPropagation(); openUser(v.user.upn) }}>{v.user.name ?? v.user.upn}</button><div className="small muted break">{v.user.upn}</div></td>
                <td><span className={`pill st-${v.status}`}>{STATUS_LABEL[v.status]}</span></td>
                <td className="small">{skuNames(v.user.licenses, model) || <span className="muted">None</span>}</td>
                <td className="small nowrap">{fmtDate(v.lastSeen)}</td>
                <td className="r small num">{gb(v.user.mailboxBytes)}</td>
                <td className="small">{v.user.desktop === undefined ? <span className="muted">Unknown</span> : v.user.desktop ? 'Yes' : 'No'}</td>
                <td className="r num">{fmtUsd(v.monthly, 2)}</td>
                <td className="small">{v.rec ? <><span className={`pill c-${v.rec.confidence}`}>{REASON_LABEL[v.rec.reason]}</span> <span className="save-t num">−{fmtUsd(v.rec.monthly, 2)}</span></> : <span className="muted">None</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="btn ghost" onClick={() => setLimit(l => l + 200)}>Show more ({rows.length - limit} left)</button>}
      {!rows.length && <p className="muted center">No users match.</p>}
    </div>
  )
}

export const gb = (b: number | undefined) => b === undefined ? '–' : `${(b / 1024 ** 3).toFixed(1)} GB`
export const skuNames = (ids: string[], m: Model) => ids.map(id => m.byId.get(id)?.name.replace('Microsoft 365 ', 'M365 ').replace('Microsoft ', '') ?? id).join(' + ')

// ---------- User drawer ----------

function UserDrawer({ model, project, upn, onClose }: { model: Model; project: Project; upn: string | null; onClose(): void }) {
  const v: UserView | undefined = upn ? model.analysis.users.find(x => x.user.upn === upn) : undefined
  const u = v?.user
  return (
    <Modal open={!!v} onClose={onClose} title={u?.name ?? u?.upn ?? 'User'} wide>
      {v && u && (
        <div className="stack">
          <p className="muted small break">{u.upn}{u.department ? ` · ${u.department}` : ''} · <span className={`pill st-${v.status}`}>{STATUS_LABEL[v.status]}</span></p>
          <div className="grid-2">
            <dl className="facts">
              <div><dt>Licences</dt><dd>{skuNames(u.licenses, model) || 'None'}</dd></div>
              <div><dt>Monthly cost</dt><dd className="num">{fmtUsd(v.monthly, 2)}</dd></div>
              <div><dt>Account</dt><dd>{u.enabled === false ? 'Sign-in blocked' : u.enabled ? 'Enabled' : 'Unknown'}{u.created ? `, created ${fmtDate(u.created)}` : ''}</dd></div>
              <div><dt>Mailbox</dt><dd>{gb(u.mailboxBytes)}{u.hasArchive ? ', archive on' : ''}{u.recipientType && u.recipientType !== 'user' ? ` (${u.recipientType})` : ''}</dd></div>
              <div><dt>Desktop apps</dt><dd>{u.desktop === undefined ? 'Unknown (no Apps usage report)' : u.desktop ? 'Used on Windows or Mac' : 'Not used'}</dd></div>
              <div><dt>Counts in period</dt><dd>{u.sends ?? '–'} emails sent · {u.teamsMsgs ?? '–'} Teams messages · {u.calls ?? '–'} calls</dd></div>
            </dl>
            <dl className="facts">
              {([['Last sign-in', u.lastSignIn], ['Exchange', u.exchange], ['Teams', u.teams], ['OneDrive', u.onedrive], ['SharePoint', u.sharepoint], ['Microsoft 365 Apps', u.apps], ['Copilot', u.copilot]] as const).map(([l, d]) => (
                <div key={l}><dt>{l}</dt><dd>{fmtDate(d)}</dd></div>
              ))}
            </dl>
          </div>
          {v.rec ? (
            <div className={`rec-box c-${v.rec.confidence}`}>
              <div className="row between wrap gap-sm"><strong>{REASON_LABEL[v.rec.reason]}: {skuNames(v.rec.from, model)} → {skuNames(v.rec.to, model) || 'no paid licence'}</strong><span className="save-t num">−{fmtUsd(v.rec.annual)}/yr</span></div>
              <ul className="small">{v.rec.findings.map((f, i) => <li key={i}>{f.text}</li>)}</ul>
              {v.rec.caveats.length > 0 && <ul className="small muted">{v.rec.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
              <p className="small">Confidence: {CONF_LABEL[v.rec.confidence]} · Decision: {decisionOf(v.rec, project.decisions)} · <Link href={`/app/p/${project.id}/recommendations?q=${encodeURIComponent(u.upn)}`} onClick={onClose}>Review</Link></p>
            </div>
          ) : <p className="muted">No change recommended: this user's licences match their use.</p>}
          <p className="small muted">Seen in: {u.seen.join(', ')}</p>
        </div>
      )}
    </Modal>
  )
}

export { buildModel, recKey }
