import { useEffect, useMemo, useState } from 'react'
import { effectiveCatalog, type Sku } from './engine/catalog.ts'
import { analyze, join, snapshotOf, type Analysis, type Joined, type Snapshot } from './engine/rules.ts'
import { SAMPLES, sampleSources } from './engine/sample.ts'
import { KIND_LABEL } from './engine/parse.ts'
import { getDefaults, getData, getProjects, saveProject, useProjects, uuid, type Dataset, type Project } from './store.ts'

export const today = () => new Date().toISOString().slice(0, 10)
const EMPTY: Dataset = { sources: [] }

export function sampleDataset(id: string): Dataset {
  return { sources: sampleSources(id), seats: SAMPLES.find(s => s.id === id)!.seats }
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const ds = sampleDataset(sampleId)
  const now = Date.now()
  const cat = effectiveCatalog(def.prices)
  const d = getDefaults()
  // Last month's snapshot, taken before some of the clean-up happened, so History has something to compare.
  const prev = analyze(join(sampleSources(sampleId, true), def.prevAsOf), cat, d.settings)
  const snapshots: Snapshot[] = [snapshotOf(prev, cat, uuid(), 'September 2026', Date.parse(def.prevAsOf + 'T12:00:00Z'))]
  return saveProject({
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, prices: def.prices, settings: d.settings, seats: def.seats, decisions: {}, snapshots, sampleId,
    imports: ds.sources.map(s => ({ id: uuid(), kind: s.kind, fileName: `synthetic ${KIND_LABEL[s.kind].split(': ').pop()!.toLowerCase()}`, format: KIND_LABEL[s.kind], rows: s.rows.length, issues: 0, refreshDate: s.refreshDate, at: now })),
  })
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, prices: {}, settings: getDefaults().settings, seats: {}, decisions: {}, snapshots: [], imports: [] })
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleDataset(project.sampleId)); return }
    void getData(project.id).then(d => { if (live) setDs(d ?? EMPTY) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project ? saveProject({ ...project, ...patch }) : undefined
  return { loading: list === null || (project !== null && ds === null), project, ds, update }
}

export interface Model { catalog: Sku[]; byId: Map<string, Sku>; joined: Joined; analysis: Analysis }

export function buildModel(p: Project, ds: Dataset): Model {
  const catalog = effectiveCatalog(p.prices)
  const fallback = p.sampleId ? SAMPLES.find(s => s.id === p.sampleId)!.asOf : today()
  const joined = join(ds.sources, fallback)
  return { catalog, byId: new Map(catalog.map(k => [k.id, k])), joined, analysis: analyze(joined, catalog, p.settings) }
}

export function useModel(p: Project | null, ds: Dataset | null): Model | null {
  return useMemo(() => p && ds ? buildModel(p, ds) : null, [p?.prices, p?.settings, ds])
}

/** Group label for a set of licences: the base plan if any, else the main add-on. */
export function planOf(ids: string[], byId: Map<string, Sku>): string {
  const skus = ids.map(id => byId.get(id)).filter((k): k is Sku => !!k && (k.price > 0 || k.suite))
  const suite = skus.filter(k => k.suite).sort((a, b) => b.price - a.price)[0]
  if (suite) return suite.id.replace(/-nt$/, '')
  if (skus.some(k => k.mailboxGB > 0)) return 'exo'
  return skus.length ? 'other' : 'none'
}

export const PLAN_GROUPS: { id: string; label: string }[] = [
  { id: 'e5', label: 'Microsoft 365 E5' }, { id: 'e3', label: 'Microsoft 365 E3' }, { id: 'o365e3', label: 'Office 365 E3' }, { id: 'o365e1', label: 'Office 365 E1' },
  { id: 'bp', label: 'Business Premium' }, { id: 'bs', label: 'Business Standard' }, { id: 'bb', label: 'Business Basic' },
  { id: 'f3', label: 'F3' }, { id: 'f1', label: 'F1' }, { id: 'exo', label: 'Exchange Online' }, { id: 'other', label: 'Add-ons only' }, { id: 'none', label: 'No paid licence' },
]
