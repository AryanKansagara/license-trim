import { useEffect, useMemo } from 'react'
import { CATALOG_DATE } from './engine/catalog.ts'
import { decisionOf, recKey, REASON_LABEL, renewal, type Reason } from './engine/rules.ts'
import { useModel, useProject } from './projectData.ts'
import { getDefaults } from './store.ts'
import { CONF_LABEL, skuNames } from './Project.tsx'
import { fmtDate, fmtNum, fmtUsd, Link } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const { loading, project, ds } = useProject(id)
  const model = useModel(project, ds)
  useEffect(() => { if (project) document.title = `Licence cost report · ${project.name}` }, [project?.name])
  const approvedSet = useMemo(() => model && project ? new Set(model.analysis.recs.filter(r => decisionOf(r, project.decisions) === 'approved').map(recKey)) : new Set<string>(), [model, project])
  if (loading) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  if (!project || !model) return <section className="page narrow center"><h1>Tenant not found</h1><Link href="/app" className="btn primary">All tenants</Link></section>
  const a = model.analysis, t = a.totals
  const approved = a.recs.filter(r => approvedSet.has(recKey(r)))
  const approvedM = approved.reduce((s, r) => s + r.monthly, 0)
  const reasons = (Object.entries(t.byReason) as [Reason, { count: number; monthly: number }][]).sort((x, y) => y[1].monthly - x[1].monthly)
  const skus = Object.entries(a.skuCounts).map(([k, c]) => ({ sku: model.byId.get(k)!, ...c })).filter(r => r.sku && r.sku.price > 0).sort((x, y) => y.now * y.sku.price - x.now * x.sku.price)
  const plan = renewal(a, model.catalog, project.seats, approvedSet, project.settings.headroom)
  const preparer = getDefaults().preparer
  return (
    <div className="report">
      <div className="report-bar no-print">
        <Link href={`/app/p/${id}`} className="btn ghost sm">Back to tenant</Link>
        <button type="button" className="btn primary sm" onClick={() => print()}>Print or save as PDF</button>
      </div>
      <article className="report-page">
        <header className="report-head">
          <div className="monogram" aria-hidden="true">LT</div>
          <div>
            <h1>Microsoft 365 licence cost review</h1>
            <p>{project.name.replace(' (synthetic)', '')}{project.sampleId ? ' (synthetic sample data)' : ''} · usage as of {fmtDate(a.asOf)} · prepared {fmtDate(new Date().toISOString().slice(0, 10))}{preparer ? ` by ${preparer}` : ''}</p>
          </div>
        </header>
        <section className="report-kpis">
          <div><span>Current licence spend</span><strong>{fmtUsd(t.monthlySpend * 12)}</strong><em>per year, {fmtNum(t.licensed)} licensed accounts</em></div>
          <div className="save"><span>Savings identified</span><strong>{fmtUsd(t.annualSaving)}</strong><em>per year, {t.monthlySpend ? Math.round(t.monthlySaving / t.monthlySpend * 100) : 0}% of spend</em></div>
          <div><span>Approved for action</span><strong>{fmtUsd(approvedM * 12)}</strong><em>{approved.length} of {a.recs.length} changes</em></div>
          <div><span>High-confidence savings</span><strong>{fmtUsd(t.byConfidence.high * 12)}</strong><em>per year, no judgement call needed</em></div>
        </section>
        <section>
          <h2>Where the money goes</h2>
          <table className="table">
            <thead><tr><th>Finding</th><th className="r">Accounts</th><th className="r">Per month</th><th className="r">Per year</th></tr></thead>
            <tbody>{reasons.map(([r, v]) => <tr key={r}><td>{REASON_LABEL[r]}</td><td className="r">{v.count}</td><td className="r">{fmtUsd(v.monthly)}</td><td className="r">{fmtUsd(v.monthly * 12)}</td></tr>)}</tbody>
            <tfoot><tr><td>Total</td><td className="r">{a.recs.length}</td><td className="r">{fmtUsd(t.monthlySaving)}</td><td className="r">{fmtUsd(t.annualSaving)}</td></tr></tfoot>
          </table>
        </section>
        <section>
          <h2>Spend by licence, now and after all recommendations</h2>
          <table className="table">
            <thead><tr><th>Licence</th><th className="r">List price</th><th className="r">Seats now</th><th className="r">Seats after</th><th className="r">Annual now</th><th className="r">Annual after</th></tr></thead>
            <tbody>{skus.map(r => <tr key={r.sku.id}><td>{r.sku.name}</td><td className="r">{fmtUsd(r.sku.price, 2)}</td><td className="r">{r.now}</td><td className="r">{r.after}</td><td className="r">{fmtUsd(r.now * r.sku.price * 12)}</td><td className="r">{fmtUsd(r.after * r.sku.price * 12)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}>Total</td><td className="r">{fmtUsd(t.monthlySpend * 12)}</td><td className="r">{fmtUsd(t.monthlyAfter * 12)}</td></tr></tfoot>
          </table>
        </section>
        <section className="break-before">
          <h2>Largest recommendations</h2>
          <table className="table">
            <thead><tr><th>User</th><th>Change</th><th>Why</th><th>Confidence</th><th className="r">Per year</th></tr></thead>
            <tbody>{a.recs.slice(0, 20).map(r => <tr key={r.upn}><td>{r.name}</td><td>{skuNames(r.remove, model)}{r.add.length ? ` → ${skuNames(r.add, model)}` : ' removed'}</td><td>{r.findings[0].text}</td><td>{CONF_LABEL[r.confidence]}</td><td className="r">{fmtUsd(r.annual)}</td></tr>)}</tbody>
          </table>
          {a.recs.length > 20 && <p className="small">Plus {a.recs.length - 20} more, listed in the planned-changes CSV.</p>}
        </section>
        <section>
          <h2>Renewal: seats to commit</h2>
          <p className="small">Approved changes applied, plus {Math.round(project.settings.headroom * 100)}% headroom.</p>
          <table className="table">
            <thead><tr><th>Licence</th><th className="r">Assigned</th><th className="r">Purchased</th><th className="r">Commit</th><th className="r">Annual at commit</th></tr></thead>
            <tbody>{plan.map(r => <tr key={r.sku.id}><td>{r.sku.name}</td><td className="r">{r.assigned}</td><td className="r">{r.purchased ?? '–'}</td><td className="r">{r.commit}</td><td className="r">{fmtUsd(r.annualCommit)}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="report-method small">
          <h2>Method</h2>
          <p>Licences, sign-ins and workload activity are joined per user from the Microsoft 365 admin center and Entra exports. Inactive means no sign-in and no Exchange, Teams, OneDrive, SharePoint or Apps activity for {project.settings.inactiveDays} days. Right-sizing picks the cheapest plan that still covers what each person used, checking mailbox size (with 25% headroom) and desktop app use. Prices are US list prices as of {fmtDate(CATALOG_DATE)}{Object.keys(project.prices).length ? `, with ${Object.keys(project.prices).length} prices adjusted to this agreement` : ''}; annual commitment, paid annually. Savings are at list price and before any partner discount.</p>
        </section>
      </article>
    </div>
  )
}
