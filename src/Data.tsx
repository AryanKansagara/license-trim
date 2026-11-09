import { useEffect, useMemo, useRef, useState } from 'react'
import { CATALOG_DATE, CATALOG_SOURCE, DEFAULT_CATALOG, skuIndex } from './engine/catalog.ts'
import { FIELD_LABEL, KIND_FIELDS, KIND_LABEL, parseText, type Detected, type Field, type Kind, type Parsed } from './engine/parse.ts'
import { DEFAULT_SETTINGS, seatsFromSkus, snapshotOf, type Settings } from './engine/rules.ts'
import { SAMPLES, sampleCombinedCsv } from './engine/sample.ts'
import { buildModel } from './projectData.ts'
import type { TabProps } from './Project.tsx'
import { deleteProject, putData, uuid, type ImportMeta } from './store.ts'
import { ask, download, fmtDate, fmtUsd, go, Link, Modal, toast } from './ui.tsx'

export default function Data(props: TabProps) {
  const { project, update } = props
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(location.search).get('import') === '1') { history.replaceState({}, '', location.pathname); if (!project.sampleId) setImporting(true) }
  }, [])
  const sample = SAMPLES.find(s => s.id === project.sampleId)
  return (
    <div className="stack-lg">
      <div className="card pad stack">
        <div className="row between wrap gap">
          <div>
            <h2 className="h4">Imported reports</h2>
            <p className="small muted">Re-importing a report of the same kind replaces it. Raw rows stay in this browser; they sync only if under 1.5 MB.</p>
          </div>
          {project.sampleId
            ? <button type="button" className="btn ghost" onClick={() => download(`${project.sampleId}-synthetic-export.csv`, sampleCombinedCsv(project.sampleId!, id => props.model.byId.get(id)?.part ?? id))}>Download sample as one CSV</button>
            : <button type="button" className="btn primary" onClick={() => setImporting(true)}>Import files</button>}
        </div>
        {project.sampleId && <p className="notice">{sample?.name} is synthetic and read-only. Create a tenant from the Tenants page to import your own exports; the downloaded CSV is a valid import file to try the flow.</p>}
        {project.imports.length > 0 ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Report</th><th>File</th><th className="r">Rows</th><th className="r">Issues</th><th>Report date</th><th>Imported</th></tr></thead>
            <tbody>{[...project.imports].sort((a, b) => a.kind.localeCompare(b.kind)).map(i => <tr key={i.id}><td>{i.format}</td><td className="small break">{i.fileName}</td><td className="r num">{i.rows}</td><td className="r num">{i.issues}</td><td className="small">{i.refreshDate ? fmtDate(i.refreshDate) : '–'}</td><td className="small">{new Date(i.at).toLocaleDateString()}</td></tr>)}</tbody>
          </table></div>
        ) : <p className="muted">Nothing imported yet. <Link href="/docs">Which reports to export</Link>.</p>}
        <Coverage kinds={project.imports.map(i => i.kind)} />
      </div>
      <TenantSettings {...props} />
      <PriceList {...props} />
      <div className="card pad stack-sm">
        <h2 className="h4">Tenant</h2>
        <label className="field"><span>Name</span><input defaultValue={project.name} onBlur={e => { const n = e.target.value.trim(); if (n && n !== project.name) { void update({ name: n }); toast('Renamed.') } }} /></label>
        <div><button type="button" className="btn danger-ghost" onClick={async () => {
          if (!await ask('Delete this tenant?', `Deletes ${project.name}, its imported reports, decisions and snapshots from this device${''} and from the cloud if you are signed in. You can undo for a few seconds.`, 'Delete tenant')) return
          const undo = await deleteProject(project.id)
          go('/app')
          toast(`Deleted ${project.name}.`, { undo: () => void undo() })
        }}>Delete tenant</button></div>
      </div>
      {importing && <ImportModal {...props} onClose={() => setImporting(false)} />}
    </div>
  )
}

const COVER: { kinds: Kind[]; label: string; why: string }[] = [
  { kinds: ['users', 'combined', 'active'], label: 'Licences per user', why: 'required' },
  { kinds: ['signins', 'combined'], label: 'Entra sign-ins', why: 'inactive detection' },
  { kinds: ['active', 'email', 'teams', 'combined'], label: 'Workload activity', why: 'inactive and Teams-only' },
  { kinds: ['mailbox', 'combined'], label: 'Mailbox usage', why: 'shared mailboxes, quotas' },
  { kinds: ['apps', 'combined'], label: 'Microsoft 365 Apps', why: 'desktop app downgrades' },
  { kinds: ['copilot'], label: 'Copilot usage', why: 'idle Copilot seats' },
]
function Coverage({ kinds }: { kinds: Kind[] }) {
  return (
    <ul className="coverage" aria-label="Evidence coverage">
      {COVER.map(c => { const ok = c.kinds.some(k => kinds.includes(k)); return <li key={c.label} className={ok ? 'ok' : ''}><span aria-hidden="true">{ok ? '✓' : '○'}</span> {c.label} <span className="muted small">({c.why}){ok ? '' : ': not imported'}</span></li> })}
    </ul>
  )
}

// ---------- Import ----------

interface Staged { id: string; fileName: string; text: string; detected: Detected; parsed: Parsed }

const idx = skuIndex(DEFAULT_CATALOG)

function ImportModal({ project, ds, update, onClose }: TabProps & { onClose(): void }) {
  const [staged, setStaged] = useState<Staged[]>([])
  const [drag, setDrag] = useState(false)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const stage = (fileName: string, text: string) => {
    const { detected, parsed } = parseText(text, idx)
    setStaged(s => [...s, { id: uuid(), fileName, text, detected, parsed }])
  }
  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.size > 40_000_000) { toast(`${f.name} is over 40 MB; split it or use the Graph script.`, { tone: 'error' }); continue }
      if (/\.xlsx?$/i.test(f.name)) { toast(`${f.name}: export as CSV from the admin center (Export > CSV).`, { tone: 'error' }); continue }
      stage(f.name, await f.text())
    }
  }
  const remap = (s: Staged, patch: { kind?: Kind; columns?: Partial<Record<Field, number>> }) => {
    const { detected, parsed } = parseText(s.text, idx, { kind: patch.kind ?? s.detected.kind, columns: patch.columns ?? s.detected.columns })
    setStaged(list => list.map(x => x.id === s.id ? { ...x, detected, parsed } : x))
  }
  const usable = staged.filter(s => s.parsed.rows.length || s.parsed.skus.length)

  const commit = async () => {
    setBusy(true)
    try {
      let sources = [...ds.sources]
      let imports: ImportMeta[] = [...project.imports]
      let seats = project.seats
      for (const s of usable) {
        const k = s.detected.kind
        imports = imports.filter(i => i.kind !== k)
        imports.push({ id: uuid(), kind: k, fileName: s.fileName, format: s.detected.format, rows: s.parsed.rows.length || s.parsed.skus.length, issues: s.parsed.issues.length, refreshDate: s.parsed.refreshDate, at: Date.now() })
        if (k === 'skus') { seats = { ...seats, ...seatsFromSkus(s.parsed.skus, DEFAULT_CATALOG) }; continue }
        sources = sources.filter(x => x.kind !== k)
        sources.push({ kind: k, rows: s.parsed.rows, refreshDate: s.parsed.refreshDate, covers: s.parsed.covers })
      }
      const next = { ...ds, sources }
      await putData(project.id, next)
      // One snapshot per reporting month, taken automatically the first time that month is imported.
      const m = buildModel({ ...project, seats }, next)
      const month = new Date(m.analysis.asOf + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      const snapshots = sources.length && !project.snapshots.some(x => x.label === month) ? [...project.snapshots, snapshotOf(m.analysis, m.catalog, uuid(), month, Date.now())] : project.snapshots
      await update({ imports, seats, snapshots, dataMissing: false })
      toast(`Imported ${usable.length} report${usable.length === 1 ? '' : 's'}. ${m.analysis.recs.length} recommendations.`, { tone: 'ok' })
      onClose()
      go(`/app/p/${project.id}/overview`)
    } catch (e) {
      toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' })
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="Import Microsoft 365 exports" wide>
      <div className="stack">
        <div className={`drop${drag ? ' on' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files) }}>
          <p><strong>Drop CSV files here</strong> or <button type="button" className="linkish" onClick={() => input.current?.click()}>choose files</button>. Several at once is fine: each is recognised by its columns.</p>
          <p className="small muted">Active users export, usage reports (Active users, Email, Mailbox usage, Teams, OneDrive, SharePoint, Microsoft 365 Apps, Copilot), Entra sign-ins, or the one-CSV Graph export. <Link href="/docs" target="_blank">Export steps</Link></p>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" multiple hidden onChange={e => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
        </div>
        <details>
          <summary className="small">Or paste CSV text</summary>
          <textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder="User principal name,Display name,Licenses,..." aria-label="Paste CSV" />
          <button type="button" className="btn ghost sm" disabled={!paste.trim()} onClick={() => { stage('pasted.csv', paste); setPaste('') }}>Add pasted text</button>
        </details>
        {staged.map(s => <StagedCard key={s.id} s={s} onKind={k => remap(s, { kind: k, columns: undefined })} onCol={(f, i) => remap(s, { columns: { ...s.detected.columns, [f]: i } })} onRemove={() => setStaged(l => l.filter(x => x.id !== s.id))} />)}
        <div className="row end gap">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={!usable.length || busy} onClick={() => void commit()}>{busy ? 'Importing' : `Import ${usable.length || ''} report${usable.length === 1 ? '' : 's'}`}</button>
        </div>
      </div>
    </Modal>
  )
}

function StagedCard({ s, onKind, onCol, onRemove }: { s: Staged; onKind(k: Kind): void; onCol(f: Field, i: number | undefined): void; onRemove(): void }) {
  const p = s.parsed
  const errors = p.issues.filter(i => i.level === 'error').length
  const warnings = p.issues.length - errors
  const [showMap, setShowMap] = useState(false)
  const n = p.rows.length || p.skus.length
  return (
    <div className="card pad staged stack-sm">
      <div className="row between wrap gap-sm">
        <div><strong className="break">{s.fileName}</strong><div className="small muted">{n} {s.detected.kind === 'skus' ? 'SKUs' : 'users'}{p.refreshDate ? ` · report refreshed ${fmtDate(p.refreshDate)}` : ''}</div></div>
        <div className="row gap-sm">
          <label className="field inline"><span className="sr-only">Report type</span>
            <select value={s.detected.kind} onChange={e => onKind(e.target.value as Kind)}>{(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
          </label>
          <button type="button" className="icon-btn" aria-label={`Remove ${s.fileName}`} onClick={onRemove}>&times;</button>
        </div>
      </div>
      <div className="row gap-sm wrap small">
        <span className={`pill ${n ? 'c-high' : 'c-low'}`}>{n ? 'Ready' : 'Nothing to import'}</span>
        {errors > 0 && <span className="pill c-low">{errors} error{errors === 1 ? '' : 's'}</span>}
        {warnings > 0 && <span className="pill c-medium">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
        {p.concealed > 0 && <span className="pill c-low">{p.concealed} concealed names</span>}
        <button type="button" className="linkish" aria-expanded={showMap} onClick={() => setShowMap(v => !v)}>{showMap ? 'Hide' : 'Check'} column mapping</button>
      </div>
      {p.concealed > 0 && <p className="notice warn small">This report has concealed user names, so it cannot be joined to users. In the Microsoft 365 admin center go to Settings → Org settings → Services → Reports, clear "Display concealed user, group, and site names in all reports", wait a few minutes and export again.</p>}
      {showMap && (
        <div className="map-grid">
          {KIND_FIELDS[s.detected.kind].map(f => (
            <label key={f} className="field"><span>{FIELD_LABEL[f]}</span>
              <select value={s.detected.columns[f] ?? ''} onChange={e => onCol(f, e.target.value === '' ? undefined : +e.target.value)}>
                <option value="">Not in this file</option>
                {s.detected.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {p.issues.length > 0 && (
        <details>
          <summary className="small">Validation report ({p.issues.length})</summary>
          <ul className="issues small">{p.issues.slice(0, 200).map((i, k) => <li key={k} className={i.level}><span className="mono">Line {i.line}</span> {i.message}</li>)}</ul>
        </details>
      )}
    </div>
  )
}

// ---------- Settings and prices ----------

function TenantSettings({ project, update }: TabProps) {
  const s = project.settings
  const set = (patch: Partial<Settings>) => void update({ settings: { ...s, ...patch } })
  const num = (k: keyof Settings, label: string, min: number, max: number, hint?: string) => (
    <label className="field"><span>{label}</span><input type="number" min={min} max={max} value={s[k] as number} onChange={e => set({ [k]: Math.min(max, Math.max(min, +e.target.value || min)) })} />{hint && <small className="muted">{hint}</small>}</label>
  )
  return (
    <div className="card pad stack-sm">
      <div className="row between wrap"><h2 className="h4">Rules for this tenant</h2><button type="button" className="btn ghost sm" onClick={() => { const prev = s; set(DEFAULT_SETTINGS); toast('Rules reset to defaults.', { undo: () => set(prev) }) }}>Reset rules</button></div>
      <div className="map-grid">
        {num('inactiveDays', 'Inactive after (days)', 14, 365, 'No sign-in and no workload activity')}
        {num('copilotDays', 'Copilot idle after (days)', 7, 180)}
        {num('lightSends', 'E5 light user: max emails sent', 0, 1000, 'In the report period')}
        {num('lightMsgs', 'E5 light user: max Teams messages', 0, 5000)}
      </div>
      <label className="check"><input type="checkbox" checked={s.keepE5} onChange={e => set({ keepE5: e.target.checked })} /> Keep E5 for everyone (security policy relies on E5 for all users)</label>
      <label className="check"><input type="checkbox" checked={s.allowFrontline} onChange={e => set({ allowFrontline: e.target.checked })} /> Allow moves to F1/F3 (users must qualify as frontline workers)</label>
    </div>
  )
}

function PriceList({ project, update }: TabProps) {
  const [q, setQ] = useState('')
  const rows = useMemo(() => DEFAULT_CATALOG.filter(k => !q || `${k.name} ${k.part}`.toLowerCase().includes(q.toLowerCase())), [q])
  const setPrice = (id: string, v: string) => {
    const prices = { ...project.prices }
    const def = DEFAULT_CATALOG.find(k => k.id === id)!.price
    if (v === '' || +v === def) delete prices[id]
    else prices[id] = Math.max(0, +v)
    void update({ prices })
  }
  const edited = Object.keys(project.prices).length
  return (
    <div className="card pad stack-sm">
      <div className="row between wrap gap-sm">
        <div><h2 className="h4">Price list</h2><p className="small muted measure">List prices as of {fmtDate(CATALOG_DATE)}. {CATALOG_SOURCE}</p></div>
        <div className="row gap-sm">
          <input type="search" placeholder="Filter SKUs" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter SKUs" />
          {edited > 0 && <button type="button" className="btn ghost sm" onClick={() => { const prev = project.prices; void update({ prices: {} }); toast('Prices reset to list.', { undo: () => void update({ prices: prev }) }) }}>Reset {edited} edited</button>}
        </div>
      </div>
      <div className="table-wrap price-wrap"><table className="table">
        <thead><tr><th>SKU</th><th>Part number</th><th className="r">List</th><th className="r">Your price</th></tr></thead>
        <tbody>{rows.map(k => (
          <tr key={k.id} className={k.id in project.prices ? 'edited' : ''}>
            <td>{k.name}{k.note && <div className="small muted">{k.note}</div>}</td>
            <td className="mono small">{k.part}</td>
            <td className="r num">{fmtUsd(k.price, 2)}</td>
            <td className="r"><input aria-label={`Price for ${k.name}`} className="short r" type="number" min={0} step={0.25} value={project.prices[k.id] ?? k.price} onChange={e => setPrice(k.id, e.target.value)} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  )
}
