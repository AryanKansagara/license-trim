import { useEffect, useState } from 'react'
import { decisionOf } from './engine/rules.ts'
import { SAMPLES } from './engine/sample.ts'
import { buildModel, createBlankProject, createSampleProject, sampleDataset } from './projectData.ts'
import { deleteProject, getData, getDefaults, useProjects, type Project } from './store.ts'
import { Empty, fmtDate, fmtNum, fmtUsd, go, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

interface Summary { users: number; spend: number; saving: number; approved: number; recs: number; asOf: string | null }

async function summarise(p: Project): Promise<Summary | null> {
  const ds = p.sampleId ? sampleDataset(p.sampleId) : await getData(p.id)
  if (!ds || !ds.sources.length) return null
  const m = buildModel(p, ds)
  const a = m.analysis
  return { users: a.totals.users, spend: a.totals.monthlySpend, saving: a.totals.monthlySaving, approved: a.recs.filter(r => decisionOf(r, p.decisions) === 'approved').reduce((t, r) => t + r.monthly, 0), recs: a.recs.length, asOf: a.asOf }
}

export default function Workspace() {
  const list = useProjects()
  const [naming, setNaming] = useState(false)
  const [sums, setSums] = useState<Record<string, Summary | null>>({})
  const msp = getDefaults().msp
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.get('import') === '1') { history.replaceState({}, '', '/app'); setNaming(true) }
    const s = q.get('sample'), tab = q.get('tab')
    if (s && SAMPLES.some(x => x.id === s)) void createSampleProject(s).then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
  }, [])
  useEffect(() => {
    if (!list) return
    let live = true
    void Promise.all(list.map(async p => [p.id, await summarise(p)] as const)).then(r => { if (live) setSums(Object.fromEntries(r)) })
    return () => { live = false }
  }, [list])

  const create = async (name: string) => {
    const p = await createBlankProject(name || 'My tenant')
    go(`/app/p/${p.id}/data?import=1`)
  }
  const sample = async (id: string) => { const p = await createSampleProject(id); go(`/app/p/${p.id}`) }

  if (list === null) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  const rolled = Object.values(sums).filter((s): s is Summary => !!s)
  const roll = rolled.reduce((t, s) => ({ users: t.users + s.users, spend: t.spend + s.spend, saving: t.saving + s.saving, approved: t.approved + s.approved }), { users: 0, spend: 0, saving: 0, approved: 0 })
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{msp ? 'MSP workspace' : 'Workspace'}</p>
          <h1>{msp ? 'Client tenants' : 'Tenants'}</h1>
          <p className="muted">{msp ? 'One project per client tenant, rolled up below.' : 'One project per Microsoft 365 tenant. Managing several? Each one gets its own project and the roll-up adds them up.'}</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setNaming(true)}>New tenant</button>
      </div>

      {list.length === 0 ? (
        <Empty title="No tenants yet" icon={<div className="empty-seats" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} />)}</div>}>
          <p className="muted">Open a synthetic 180-person tenant to see every finding, or import your own admin center exports.</p>
          <div className="row gap center-x wrap">
            <button type="button" className="btn primary" onClick={() => void sample('fabrikam')}>Try the sample</button>
            <button type="button" className="btn outline" onClick={() => setNaming(true)}>Import your data</button>
          </div>
        </Empty>
      ) : (
        <>
          {list.length > 1 && (
            <div className="card pad rollup">
              <h2 className="h5">Roll-up across {list.length} tenants</h2>
              <div className="kpis">
                <div className="kpi"><span className="kpi-label">Accounts</span><strong className="kpi-value num">{fmtNum(roll.users)}</strong></div>
                <div className="kpi"><span className="kpi-label">Licence spend</span><strong className="kpi-value num">{fmtUsd(roll.spend * 12)}/yr</strong></div>
                <div className="kpi save"><span className="kpi-label">Savings identified</span><strong className="kpi-value num">{fmtUsd(roll.saving * 12)}/yr</strong><span className="small muted">{roll.spend ? Math.round(roll.saving / roll.spend * 100) : 0}% of spend</span></div>
                <div className="kpi"><span className="kpi-label">Approved</span><strong className="kpi-value num">{fmtUsd(roll.approved * 12)}/yr</strong></div>
              </div>
            </div>
          )}
          <div className="proj-grid">
            {list.map(p => {
              const s = sums[p.id]
              return (
                <article key={p.id} className="card proj">
                  <Link href={`/app/p/${p.id}`} className="proj-link">
                    <h3>{p.name.replace(' (synthetic)', '')} {p.sampleId && <SyntheticBadge />}</h3>
                    {s ? (
                      <>
                        <p className="small muted">{fmtNum(s.users)} accounts · as of {fmtDate(s.asOf)} · {p.snapshots.length} snapshot{p.snapshots.length === 1 ? '' : 's'}</p>
                        <div className="proj-nums"><div><span className="small muted">Spend</span><strong className="num">{fmtUsd(s.spend * 12)}/yr</strong></div><div><span className="small muted">Savings</span><strong className="num save-t">{fmtUsd(s.saving * 12)}/yr</strong></div></div>
                        <div className="progress" title={`${fmtUsd(s.approved * 12)} approved`}><div style={{ width: `${s.saving ? s.approved / s.saving * 100 : 0}%` }} /></div>
                      </>
                    ) : <p className="small muted">{s === null ? (p.dataMissing ? 'Reports are on another device' : 'No reports imported yet') : 'Calculating'}</p>}
                  </Link>
                  <div className="row gap-sm proj-actions">
                    <Link href={`/app/p/${p.id}/recommendations`} className="btn ghost sm">Review</Link>
                    <Link href={`/app/p/${p.id}/report`} className="btn ghost sm">Cost report</Link>
                    <button type="button" className="btn danger-ghost sm" onClick={async () => {
                      const undo = await deleteProject(p.id)
                      toast(`Deleted ${p.name}.`, { undo: () => void undo() })
                    }}>Delete</button>
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      <div className="samples">
        <h2 className="h5">Synthetic tenants</h2>
        <div className="proj-grid">
          {SAMPLES.map(s => (
            <button key={s.id} type="button" className="card sample-card" onClick={() => void sample(s.id)}>
              <span className="row gap-sm"><strong>{s.name.replace(' (synthetic)', '')}</strong> <SyntheticBadge /></span>
              <span className="muted small">{s.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <Modal open={naming} onClose={() => setNaming(false)} title="New tenant">
        <form onSubmit={e => { e.preventDefault(); void create(String(new FormData(e.currentTarget).get('name') ?? '').trim()) }} className="stack">
          <label className="field"><span>Tenant or client name</span><input name="name" autoFocus placeholder="Contoso Ltd" /></label>
          <p className="muted small">Next you will import the Active users export and the usage reports, or the single CSV from the Graph script in the docs.</p>
          <div className="row end gap"><button type="button" className="btn ghost" onClick={() => setNaming(false)}>Cancel</button><button className="btn primary">Create and import</button></div>
        </form>
      </Modal>
    </section>
  )
}
