import { useState } from 'react'
import { DEFAULT_SETTINGS, type Settings as Rules } from './engine/rules.ts'
import { getDefaults, resetDefaults, setDefaults, type Defaults } from './store.ts'
import { setTheme, toast, useDark } from './ui.tsx'
import { useSync } from './sync.ts'

export default function Settings() {
  const [d, setD] = useState<Defaults>(getDefaults)
  const dark = useDark()
  const s = useSync()
  const save = (patch: Partial<Defaults>) => { const n = { ...d, ...patch }; setD(n); setDefaults(n) }
  const rule = (patch: Partial<Rules>) => save({ settings: { ...d.settings, ...patch } })
  return (
    <section className="page narrow">
      <p className="eyebrow">Settings</p>
      <h1>Settings</h1>
      <div className="card pad stack">
        <h2 className="h4">Defaults for new tenants</h2>
        <div className="map-grid">
          <label className="field"><span>Inactive after (days)</span><input type="number" min={14} max={365} value={d.settings.inactiveDays} onChange={e => rule({ inactiveDays: Math.max(14, +e.target.value || 90) })} /></label>
          <label className="field"><span>Copilot idle after (days)</span><input type="number" min={7} max={180} value={d.settings.copilotDays} onChange={e => rule({ copilotDays: Math.max(7, +e.target.value || 30) })} /></label>
          <label className="field"><span>Renewal headroom (%)</span><input type="number" min={0} max={50} value={Math.round(d.settings.headroom * 100)} onChange={e => rule({ headroom: Math.min(50, Math.max(0, +e.target.value || 0)) / 100 })} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={d.settings.keepE5} onChange={e => rule({ keepE5: e.target.checked })} /> Never recommend E5 to E3</label>
        <label className="check"><input type="checkbox" checked={d.settings.allowFrontline} onChange={e => rule({ allowFrontline: e.target.checked })} /> Allow F1/F3 recommendations</label>
        <label className="field"><span>Prepared by (on cost reports)</span><input value={d.preparer} onChange={e => save({ preparer: e.target.value })} placeholder="Sam Rivera, IT" /></label>
        <p className="muted small">Saved as you type. Existing tenants keep their own rules (Data tab).</p>
      </div>
      <div className="card pad stack">
        <h2 className="h4">MSP mode</h2>
        <label className="check"><input type="checkbox" checked={d.msp} onChange={e => save({ msp: e.target.checked })} /> I manage several client tenants (labels the workspace as clients; the roll-up shows whenever there are two or more tenants)</label>
      </div>
      <div className="card pad stack">
        <h2 className="h4">Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          <button type="button" aria-pressed={!dark} onClick={() => setTheme('light')}>Light</button>
          <button type="button" aria-pressed={dark} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>
      <div className="card pad stack">
        <h2 className="h4">Sync</h2>
        <p className="muted small">{s.user ? `Signed in as ${s.user.email}. Use the account menu in the header to sync, export, or delete cloud data.` : 'Signed out. Everything is stored in this browser. Sign in from the account menu to sync across devices.'}</p>
        <p className="small muted">Keyboard: <kbd>1</kbd>–<kbd>7</kbd> switch tenant tabs, <kbd>/</kbd> searches recommendations, <kbd>A</kbd>/<kbd>R</kbd> approve or reject the focused one, <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last destructive action.</p>
        <div><button type="button" className="btn ghost sm" onClick={() => { const prev = d; resetDefaults(); setD(getDefaults()); toast('Defaults restored.', { undo: () => { setDefaults(prev); setD(prev) } }) }}>Restore default settings</button></div>
        <p className="small muted">Default rules: {DEFAULT_SETTINGS.inactiveDays} days inactive, {DEFAULT_SETTINGS.copilotDays} days Copilot idle, {Math.round(DEFAULT_SETTINGS.headroom * 100)}% headroom.</p>
      </div>
    </section>
  )
}
