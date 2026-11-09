import { useMemo, useState } from 'react'
import { CATALOG_DATE, effectiveCatalog } from './engine/catalog.ts'
import { REASON_LABEL, type Reason } from './engine/rules.ts'
import { SAMPLES } from './engine/sample.ts'
import { changeScript } from './engine/script.ts'
import { buildModel, sampleDataset } from './projectData.ts'
import { SeatGrid, useCountUp } from './SeatGrid.tsx'
import type { Project } from './store.ts'
import { DEFAULT_SETTINGS } from './engine/rules.ts'
import { fmtDate, fmtUsd, Link, SyntheticBadge } from './ui.tsx'

const HERO_SAMPLE = SAMPLES[0]

const FINDS: { reason: Reason; body: string }[] = [
  { reason: 'inactive', body: 'No sign-in and no Exchange, Teams, OneDrive, SharePoint or Apps activity in 90 days (your call), joined from the sign-in log and usage reports.' },
  { reason: 'disabled', body: 'Sign-in blocked at offboarding, licence never removed. The most common waste, and the easiest to fix.' },
  { reason: 'shared', body: 'Shared, room and equipment mailboxes holding a user plan. Under 50 GB with no archive they need nothing.' },
  { reason: 'overlap', body: 'An E5 plus a standalone Teams Phone, Power BI Pro or Entra ID P1 it already includes. Two base plans on one person.' },
  { reason: 'e5', body: 'E5 on people who send a few emails a week and never place a call. E3 does the job unless policy says otherwise.' },
  { reason: 'teamsOnly', body: 'Site and workshop staff who live in Teams with a small mailbox and no desktop Office: F3 territory.' },
  { reason: 'desktop', body: 'Business Standard or Office 365 E3 bought for desktop apps that the Apps usage report says nobody opens.' },
  { reason: 'copilot', body: 'Copilot seats at $30 a month with no Copilot activity in the last 30 days.' },
]

export function Landing() {
  const model = useMemo(() => {
    const p = { prices: HERO_SAMPLE.prices, settings: DEFAULT_SETTINGS, sampleId: HERO_SAMPLE.id } as unknown as Project
    return buildModel(p, sampleDataset(HERO_SAMPLE.id))
  }, [])
  const [applied, setApplied] = useState(false)
  const t = model.analysis.totals
  const saved = useCountUp(applied ? t.annualSaving : 0, 1600)
  const spend = useCountUp((applied ? t.monthlyAfter : t.monthlySpend) * 12, 1600)
  const script = useMemo(() => {
    const top = ['inactive', 'overlap', 'e5'].map(r => model.analysis.recs.find(x => x.reason === r)!).filter(Boolean)
    const full = changeScript(top, model.byId, { tenant: HERO_SAMPLE.name, generated: HERO_SAMPLE.asOf })
    const a = full.indexOf('$changes = @(')
    return full.slice(a, full.indexOf('$log =', a)).trim()
  }, [model])
  const by = t.byReason
  const cat = effectiveCatalog()

  return (
    <>
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="eyebrow">Microsoft 365 licence optimisation for IT admins and MSPs</p>
            <h1>Stop paying for seats nobody uses.</h1>
            <p className="lead">Drop in your admin center exports. License Trim joins sign-ins and workload usage per user, finds the inactive and over-licensed seats, right-sizes each plan to what the person actually uses, prices it at current list prices, and writes the Microsoft Graph PowerShell to make the change.</p>
            <div className="row gap wrap">
              <Link href={`/app?sample=${HERO_SAMPLE.id}`} className="btn primary lg">Try the sample tenant</Link>
              <Link href="/app?import=1" className="btn outline lg">Import your exports</Link>
            </div>
            <p className="muted small">Runs in your browser. No sign-in, no tenant consent, nothing uploaded.</p>
          </div>
          <div className="hero-card card">
            <div className="hero-card-head">
              <div>
                <div className="small muted">{HERO_SAMPLE.name.replace(' (synthetic)', '')} <SyntheticBadge /></div>
                <div className="small muted">{model.analysis.totals.users} accounts · usage as of {fmtDate(model.analysis.asOf)}</div>
              </div>
              <div className="hero-nums">
                <div><span className="small muted">Annual spend</span><strong className="num">{fmtUsd(spend)}</strong></div>
                <div><span className="small muted">Annual savings</span><strong className="num save">{fmtUsd(saved)}</strong></div>
              </div>
            </div>
            <SeatGrid model={model} applied={applied} size={15} gap={4} label={`Seat grid: ${t.users} accounts coloured by plan and activity${applied ? ', after recommendations' : ''}`} />
            <div className="row between wrap gap-sm hero-actions">
              <span className="small muted">{applied ? `${model.analysis.recs.length} changes applied in preview. ${fmtUsd(t.monthlySaving)} a month.` : `${model.analysis.recs.length} recommendations found by the engine on this tenant.`}</span>
              <button type="button" className="btn primary" onClick={() => setApplied(a => !a)} aria-pressed={applied}>{applied ? 'Reset' : 'Apply recommendations'}</button>
            </div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap-w">
          <p className="eyebrow">What it finds</p>
          <h2>Eight kinds of licence waste, each with the evidence</h2>
          <p className="muted measure">Every recommendation shows the dates and counts behind it and a confidence level. Numbers below are what the engine finds in the synthetic 180-person tenant above.</p>
          <div className="find-grid">
            {FINDS.map(f => (
              <article key={f.reason} className="card find">
                <div className="find-top"><h3 className="h5">{REASON_LABEL[f.reason]}</h3>{by[f.reason] && <span className="find-num">{by[f.reason]!.count} · {fmtUsd(by[f.reason]!.monthly * 12)}/yr</span>}</div>
                <p className="small muted">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band alt">
        <div className="wrap-w split">
          <div>
            <p className="eyebrow">From export to change</p>
            <h2>Approve, then run the script you can read</h2>
            <ol className="steps">
              <li><strong>Import.</strong> Active users export, the usage reports, Entra sign-ins, or one CSV from the Graph script in the docs. Format detection, column mapping and a validation report with line numbers.</li>
              <li><strong>Review.</strong> Approve or reject each recommendation. Mailbox size, desktop app use and frontline eligibility are checked before any downgrade.</li>
              <li><strong>Run.</strong> A <code>Set-MgUserLicense</code> script that dry-runs by default, skips group-assigned licences, and ships with a rollback script and a CSV of the planned changes.</li>
              <li><strong>Prove it.</strong> Import again next month. The snapshot compare shows the savings you actually realised.</li>
            </ol>
            <Link href="/docs" className="chev">How to export each report</Link>
          </div>
          <div className="code hero-code">
            <div className="code-head"><span>license-trim-changes.ps1 (excerpt)</span></div>
            <pre><code>{script}</code></pre>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap-w three">
          <article>
            <h3 className="h5">Dated, editable prices</h3>
            <p className="small muted">{cat.filter(k => k.price > 0).length} SKUs at US list prices as of {fmtDate(CATALOG_DATE)}: Business Basic to E5, F1 and F3, the no-Teams suites, Copilot and the common add-ons. Edit any price to your CSP quote or nonprofit pricing.</p>
          </article>
          <article>
            <h3 className="h5">Renewal planner</h3>
            <p className="small muted">Seats to commit per SKU at true-up or NCE renewal, from the approved changes plus your headroom, against what you bought.</p>
          </article>
          <article>
            <h3 className="h5">MSP mode</h3>
            <p className="small muted">One workspace per client tenant with a roll-up of spend and savings across all of them, and a printable cost report for each client's management.</p>
          </article>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap-w row between wrap gap">
          <div>
            <h2>See it on a tenant in ten seconds.</h2>
            <p>Two synthetic tenants are included: an engineering firm on E3/E5 and a nonprofit on Business Premium.</p>
          </div>
          <div className="row gap wrap">
            <Link href={`/app?sample=${HERO_SAMPLE.id}`} className="btn white lg">Open the sample</Link>
            <Link href="/docs" className="btn ghost-white lg">Read the docs</Link>
          </div>
        </div>
      </section>
    </>
  )
}
