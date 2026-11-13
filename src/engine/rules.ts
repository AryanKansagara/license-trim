// Join reports per user, detect waste, right-size plans, price the savings, plan the renewal, and compare snapshots.
import { E5_EXTRAS, resolveSku, skuIndex, type Feature, type Sku } from './catalog.ts'
import type { Kind, SkuSeats, UserRec } from './parse.ts'

export interface Settings {
  /** No sign-in and no workload activity for this many days = inactive. */
  inactiveDays: number
  /** Copilot seats with no Copilot activity for this many days are reclaimable. */
  copilotDays: number
  /** Keep E5 for everyone (the organisation relies on E5 security for every user). */
  keepE5: boolean
  /** An E5 user at or under these counts in the report period is a light user. */
  lightSends: number
  lightMsgs: number
  /** Mailbox headroom when checking a smaller plan's quota (1.25 = needs 25% spare). */
  mailHeadroom: number
  /** Allow moves to F1/F3 (frontline use rights). */
  allowFrontline: boolean
  /** Spare seats to commit at renewal, as a fraction. */
  headroom: number
}

export const DEFAULT_SETTINGS: Settings = { inactiveDays: 90, copilotDays: 30, keepE5: false, lightSends: 30, lightMsgs: 100, mailHeadroom: 1.25, allowFrontline: true, headroom: 0.05 }

export interface Source { kind: Kind; rows: UserRec[]; refreshDate: string | null; covers?: Kind[] }

export interface User extends UserRec { licenses: string[]; seen: Kind[] }

const PRIORITY: Kind[] = ['combined', 'users', 'signins', 'active', 'mailbox', 'email', 'teams', 'onedrive', 'sharepoint', 'apps', 'copilot']
const DATE_FIELDS = ['created', 'lastSignIn', 'exchange', 'onedrive', 'sharepoint', 'teams', 'apps', 'copilot'] as const
const ACTIVITY = ['exchange', 'onedrive', 'sharepoint', 'teams', 'apps', 'copilot'] as const

export interface Joined { users: User[]; asOf: string; has: Partial<Record<Kind, boolean>> }

/** Merge every report into one record per UPN. Later dates win; other fields come from the highest-priority report. */
export function join(sources: Source[], today: string): Joined {
  const byUpn = new Map<string, User>()
  const has: Partial<Record<Kind, boolean>> = {}
  let asOf: string | null = null
  const licSet = new Set<string>()
  const ordered = [...sources].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
  for (const s of ordered) {
    has[s.kind] = true
    for (const k of s.covers ?? []) has[k] = true
    if (s.refreshDate && (!asOf || s.refreshDate > asOf)) asOf = s.refreshDate
    for (const r of s.rows) {
      let u = byUpn.get(r.upn)
      if (!u) { u = { upn: r.upn, licenses: [], seen: [] }; byUpn.set(r.upn, u) }
      u.seen.push(s.kind)
      for (const [k, v] of Object.entries(r) as [keyof UserRec, unknown][]) {
        if (v === undefined || k === 'upn') continue
        // Sources are in priority order, so the first report that lists licences wins.
        if (k === 'licenses') { if (!licSet.has(u.upn)) { u.licenses = [...new Set(v as string[])]; licSet.add(u.upn) } continue }
        if ((DATE_FIELDS as readonly string[]).includes(k)) { const cur = u[k] as string | undefined; if (!cur || (v as string) > cur) (u as unknown as Record<string, unknown>)[k] = v; continue }
        if ((u as unknown as Record<string, unknown>)[k] === undefined) (u as unknown as Record<string, unknown>)[k] = v
      }
    }
  }
  if (!asOf) {
    // No report refresh date: use the latest activity seen, else today.
    for (const u of byUpn.values()) for (const f of ['lastSignIn', ...ACTIVITY] as const) { const d = u[f]; if (d && (!asOf || d > asOf)) asOf = d }
  }
  return { users: [...byUpn.values()].sort((a, b) => a.upn.localeCompare(b.upn)), asOf: asOf ?? today, has }
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)

export function lastSeen(u: UserRec): string | null {
  let best: string | null = null
  for (const f of ['lastSignIn', ...ACTIVITY] as const) { const d = u[f]; if (d && (!best || d > best)) best = d }
  return best
}

// ---------- Recommendations ----------

export type Reason = 'disabled' | 'inactive' | 'shared' | 'room' | 'overlap' | 'copilot' | 'desktop' | 'teamsOnly' | 'e5'
export type Confidence = 'high' | 'medium' | 'low'

export const REASON_LABEL: Record<Reason, string> = {
  disabled: 'Disabled but licensed', inactive: 'Inactive', shared: 'Shared mailbox licensed', room: 'Room or equipment licensed',
  overlap: 'Duplicate licence', copilot: 'Unused Copilot', desktop: 'No desktop Office use', teamsOnly: 'Teams-only user', e5: 'E5 features unused',
}
const REASON_ORDER: Reason[] = ['disabled', 'inactive', 'shared', 'room', 'e5', 'teamsOnly', 'desktop', 'copilot', 'overlap']
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }

export interface Finding { reason: Reason; text: string; confidence: Confidence }

export interface Rec {
  upn: string
  name: string
  reason: Reason
  findings: Finding[]
  from: string[]
  to: string[]
  remove: string[]
  add: string[]
  monthly: number
  annual: number
  confidence: Confidence
  caveats: string[]
}

export type Status = 'active' | 'inactive' | 'disabled' | 'shared' | 'room' | 'new' | 'unlicensed'

export interface UserView { user: User; status: Status; lastSeen: string | null; monthly: number; rec: Rec | null }

export interface Analysis {
  asOf: string
  users: UserView[]
  recs: Rec[]
  totals: {
    users: number
    licensed: number
    monthlySpend: number
    monthlyAfter: number
    monthlySaving: number
    annualSaving: number
    byConfidence: Record<Confidence, number>
    byReason: Partial<Record<Reason, { count: number; monthly: number }>>
  }
  /** Seats assigned per SKU id, now and if every recommendation were applied. */
  skuCounts: Record<string, { now: number; after: number }>
}

const GB = 1024 ** 3
const minConf = (a: Confidence, b: Confidence): Confidence => CONF_RANK[a] <= CONF_RANK[b] ? a : b
const recent = (d: string | undefined, asOf: string, days: number) => !!d && daysBetween(d, asOf) < days
const union = (skus: Sku[]) => new Set(skus.flatMap(k => k.features))
const maxMailbox = (skus: Sku[]) => Math.max(0, ...skus.map(k => k.mailboxGB))

/** Is everything SKU `s` provides already provided by `others`? */
export function covered(s: Sku, others: Sku[]): boolean {
  if (!others.length) return false
  const f = union(others)
  return s.features.every(x => f.has(x)) && s.mailboxGB <= maxMailbox(others)
}

function compatible(from: Sku, to: Sku, allowFrontline: boolean) {
  if (from.family === 'business') return to.family === 'business'
  if (to.family === 'frontline') return allowFrontline
  return to.family === 'enterprise'
}

interface Ctx { asOf: string; s: Settings; byId: Map<string, Sku>; catalog: Sku[]; has: Partial<Record<Kind, boolean>> }

export function recommend(u: User, ctx: Ctx): Rec | null {
  const { asOf, s, byId, has } = ctx
  const held = u.licenses.map(id => byId.get(id)).filter((k): k is Sku => !!k)
  const paid = held.filter(k => k.price > 0)
  if (!paid.length) return null
  const free = held.filter(k => k.price === 0).map(k => k.id)
  const findings: Finding[] = []
  const caveats: string[] = []
  const finish = (to: string[]): Rec | null => {
    const from = u.licenses
    const remove = from.filter(x => !to.includes(x))
    const add = to.filter(x => !from.includes(x))
    if (!remove.length && !add.length) return null
    const monthly = round2(sum(from, byId) - sum(to, byId))
    if (monthly <= 0) return null
    findings.sort((a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason))
    const confidence = findings.reduce<Confidence>((c, f) => minConf(c, f.confidence), 'high')
    return { upn: u.upn, name: u.name ?? u.upn, reason: findings[0].reason, findings, from, to, remove, add, monthly, annual: round2(monthly * 12), confidence, caveats }
  }
  const usedGB = u.mailboxBytes !== undefined ? u.mailboxBytes / GB : undefined

  // 1. Shared, room and equipment mailboxes do not need a user licence (with size and archive exceptions).
  if (u.recipientType === 'shared') {
    const needs = (usedGB ?? 0) > 50 || !!u.hasArchive
    const exo2 = byId.get('exo2')
    if (needs) {
      if (!exo2 || (usedGB ?? 0) > 100 || sum(u.licenses, byId) <= exo2.price) return null
      findings.push({ reason: 'shared', text: `Shared mailbox ${usedGB !== undefined ? `(${usedGB.toFixed(1)} GB${u.hasArchive ? ', archive on' : ''}) ` : ''}needs only Exchange Online (Plan 2), not a full user plan.`, confidence: 'high' })
      return finish([...free, 'exo2'])
    }
    findings.push({ reason: 'shared', text: `Shared mailbox${usedGB !== undefined ? ` using ${usedGB.toFixed(1)} GB` : ''} with no archive: under 50 GB it needs no licence.`, confidence: usedGB !== undefined ? 'high' : 'medium' })
    if (usedGB === undefined) caveats.push('Mailbox size unknown: import the Mailbox usage report to confirm it is under 50 GB with no archive or litigation hold.')
    return finish(free)
  }
  if (u.recipientType === 'room' || u.recipientType === 'equipment') {
    findings.push({ reason: 'room', text: `${u.recipientType === 'room' ? 'Room' : 'Equipment'} mailbox holding a user licence. Resource mailboxes need no licence.`, confidence: 'high' })
    caveats.push('If this room has a Teams Rooms device, it needs Teams Rooms Basic or Pro instead of a user plan.')
    return finish(held.filter(k => k.features.includes('rooms') || k.price === 0).map(k => k.id))
  }

  // 2. Disabled accounts still holding paid licences.
  if (u.enabled === false) {
    findings.push({ reason: 'disabled', text: 'Sign-in is blocked but paid licences are still assigned.', confidence: 'high' })
    caveats.push('Removing the licence deletes the mailbox after 30 days. Convert it to a shared mailbox or place it on hold first if it must be kept.')
    return finish(free)
  }

  // 3. Inactive: no sign-in and no workload activity in N days.
  const seenSignIn = !!has.signins
  const seenUsage = !!(has.active || has.email || has.teams || has.onedrive || has.sharepoint || has.apps || has.mailbox)
  const last = lastSeen(u)
  const isNew = recent(u.created, asOf, s.inactiveDays)
  if ((seenSignIn || seenUsage) && !isNew && (!last || daysBetween(last, asOf) >= s.inactiveDays)) {
    const both = seenSignIn && seenUsage
    findings.push({ reason: 'inactive', text: last ? `No sign-in or activity for ${daysBetween(last, asOf)} days (last seen ${last}).` : `No sign-in or activity on record${u.created ? ` since the account was created on ${u.created}` : ''}.`, confidence: both ? 'high' : 'medium' })
    if (!both) caveats.push(seenSignIn ? 'Based on sign-in data only; import usage reports to confirm.' : 'Based on usage reports only; import Entra sign-in data to confirm.')
    caveats.push('Check for leave or seasonal staff before removing. Removing the licence deletes the mailbox after 30 days.')
    return finish(free)
  }

  // 4. Active user: drop what is unused, then the cheapest plan that still covers what they use.
  const drop = new Set<Feature>()
  const within = (d: string | undefined) => recent(d, asOf, s.inactiveDays)
  const desktopKnown = has.apps ? u.desktop : undefined
  if (desktopKnown === false) drop.add('desktop')
  const mailActive = within(u.exchange) || (u.sends ?? 0) > 0
  let mailNeed: number | null = null // null = keep the current quota (size unknown)
  if (usedGB !== undefined) {
    mailNeed = mailActive || usedGB >= 0.1 ? Math.max(usedGB * s.mailHeadroom, 0.5) : 0
    if (mailNeed === 0) drop.add('mail')
  }
  if (u.hasArchive === false) drop.add('archive')
  if (drop.has('mail') && drop.has('desktop') && !within(u.onedrive) && !within(u.sharepoint)) drop.add('webapps')
  const isE5 = paid.some(k => k.features.includes('mdeP2') && k.suite)
  let e5Conf: Confidence | null = null
  if (isE5 && !s.keepE5 && u.sends !== undefined && u.sends <= s.lightSends && (u.teamsMsgs ?? 0) <= s.lightMsgs && !(u.calls && u.calls > 0)) {
    for (const f of E5_EXTRAS) drop.add(f)
    e5Conf = u.teamsMsgs !== undefined ? 'medium' : 'low'
  }
  const copilotIdle = !!has.copilot && !recent(u.created, asOf, s.copilotDays) && (!u.copilot || daysBetween(u.copilot, asOf) >= s.copilotDays)
  if (copilotIdle) drop.add('copilot')

  let kept = [...paid].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
  const removeRedundant = (only?: (k: Sku) => boolean) => {
    for (const k of [...kept]) {
      if (only && !only(k)) continue
      const others = kept.filter(x => x !== k)
      if (covered(k, others)) {
        const by = others.filter(o => k.features.some(f => o.features.includes(f)) || (k.mailboxGB && o.mailboxGB)).map(o => o.name)
        findings.push({ reason: 'overlap', text: `${k.name} is already included in ${by.join(' + ') || 'another assigned plan'}.`, confidence: 'high' })
        kept = others
      }
    }
  }
  // Add-ons whose every feature is unused.
  for (const k of [...kept]) {
    if (k.suite || k.mailboxGB) continue
    const unusedCopilot = k.features.includes('copilot') && drop.has('copilot')
    const unusedApps = k.features.includes('desktop') && drop.has('desktop')
    if (unusedCopilot || unusedApps) {
      if (k.features.includes('copilot')) findings.push({ reason: 'copilot', text: u.copilot ? `No Copilot activity since ${u.copilot}.` : 'Copilot assigned but never used.', confidence: 'high' })
      else findings.push({ reason: 'desktop', text: `${k.name} assigned but no desktop Office use in the report period.`, confidence: 'medium' })
      kept = kept.filter(x => x !== k)
    }
  }
  // Two base plans: the one the other already covers goes first. Add-ons are checked after right-sizing,
  // so a standalone add-on the user bought (say Power BI Pro under E5) survives a move to E3.
  removeRedundant(k => k.suite)
  const suites = kept.filter(k => k.suite).sort((a, b) => b.price - a.price)
  const suite = suites[0]
  if (suite) {
    const addons = kept.filter(k => k !== suite)
    const addonF = union(addons)
    const needs = suite.features.filter(f => !drop.has(f) && !addonF.has(f))
    const quota = mailNeed === null ? suite.mailboxGB : mailNeed
    const best = ctx.catalog
      .filter(t => t.suite && t.price < suite.price && compatible(suite, t, s.allowFrontline))
      .filter(t => needs.every(f => t.features.includes(f)) && Math.max(t.mailboxGB, maxMailbox(addons)) >= quota)
      .sort((a, b) => a.price - b.price)[0]
    if (best) {
      const lost = suite.features.filter(f => !best.features.includes(f) && !addonF.has(f))
      if (lost.some(f => (E5_EXTRAS as Feature[]).includes(f))) {
        findings.push({ reason: 'e5', text: `Light user (${u.sends} emails sent${u.teamsMsgs !== undefined ? `, ${u.teamsMsgs} Teams messages` : ''}, no calls): no evidence of Teams Phone, Power BI Pro or advanced security workloads.`, confidence: e5Conf ?? 'low' })
        caveats.push('Confirm no E5-only security policy (Entra ID P2 risk-based access, Defender for Endpoint P2) targets this user.')
      }
      if (best.family === 'frontline' || lost.includes('mail')) {
        findings.push({ reason: 'teamsOnly', text: `Uses Teams${usedGB !== undefined ? ` and ${usedGB.toFixed(1)} GB of mailbox` : ''} but no desktop Office apps${lost.includes('mail') ? ' and no email' : ''}.`, confidence: 'medium' })
        if (best.family === 'frontline') caveats.push(`${best.name} carries frontline-worker use rights; confirm the user qualifies.`)
      } else if (lost.includes('desktop')) {
        findings.push({ reason: 'desktop', text: `No Office desktop app use on Windows or Mac in the report period${usedGB !== undefined ? `; mailbox ${usedGB.toFixed(1)} GB fits ${best.mailboxGB} GB` : ''}.`, confidence: 'medium' })
      }
      if (!findings.length) findings.push({ reason: 'desktop', text: `${best.name} covers everything this user uses.`, confidence: 'low' })
      kept = [...addons, best].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
    }
  }
  removeRedundant()
  if (!findings.length) return null
  return finish([...free, ...kept.map(k => k.id)])
}

const sum = (ids: string[], byId: Map<string, Sku>) => ids.reduce((t, id) => t + (byId.get(id)?.price ?? 0), 0)
export const round2 = (n: number) => Math.round(n * 100) / 100

export function analyze(j: Joined, catalog: Sku[], s: Settings = DEFAULT_SETTINGS): Analysis {
  const byId = new Map(catalog.map(k => [k.id, k]))
  const ctx: Ctx = { asOf: j.asOf, s, byId, catalog, has: j.has }
  const users: UserView[] = []
  const recs: Rec[] = []
  const skuCounts: Analysis['skuCounts'] = {}
  const byConfidence: Record<Confidence, number> = { high: 0, medium: 0, low: 0 }
  const byReason: Analysis['totals']['byReason'] = {}
  let spend = 0, after = 0, licensed = 0
  for (const u of j.users) {
    const rec = recommend(u, ctx)
    const monthly = round2(sum(u.licenses, byId))
    const last = lastSeen(u)
    const status: Status = u.recipientType === 'shared' ? 'shared' : u.recipientType === 'room' || u.recipientType === 'equipment' ? 'room'
      : u.enabled === false ? 'disabled' : !u.licenses.some(id => (byId.get(id)?.price ?? 0) > 0) ? 'unlicensed'
      : rec?.reason === 'inactive' ? 'inactive' : recent(u.created, j.asOf, s.inactiveDays) && !last ? 'new' : 'active'
    users.push({ user: u, status, lastSeen: last, monthly, rec })
    if (monthly > 0) licensed++
    spend += monthly
    after += rec ? monthly - rec.monthly : monthly
    for (const id of u.licenses) (skuCounts[id] ??= { now: 0, after: 0 }).now++
    for (const id of rec ? rec.to : u.licenses) (skuCounts[id] ??= { now: 0, after: 0 }).after++
    if (rec) {
      recs.push(rec)
      byConfidence[rec.confidence] = round2(byConfidence[rec.confidence] + rec.monthly)
      const r = (byReason[rec.reason] ??= { count: 0, monthly: 0 })
      r.count++; r.monthly = round2(r.monthly + rec.monthly)
    }
  }
  recs.sort((a, b) => b.monthly - a.monthly || a.upn.localeCompare(b.upn))
  const saving = round2(spend - after)
  return {
    asOf: j.asOf, users, recs, skuCounts,
    totals: { users: j.users.length, licensed, monthlySpend: round2(spend), monthlyAfter: round2(after), monthlySaving: saving, annualSaving: round2(saving * 12), byConfidence, byReason },
  }
}

// ---------- Decisions ----------

export type Decision = 'approved' | 'rejected'
/** A decision is tied to the exact change it approved; if the recommendation changes, it goes back to pending. */
export const recKey = (r: Rec) => `${r.upn}|${[...r.from].sort().join('+')}>${[...r.to].sort().join('+')}`
export function decisionOf(r: Rec, decisions: Record<string, Decision>): Decision | 'pending' {
  return decisions[recKey(r)] ?? 'pending'
}

// ---------- Renewal planner ----------

export interface RenewalRow { sku: Sku; assigned: number; after: number; purchased: number | null; commit: number; change: number | null; annualNow: number | null; annualCommit: number }

/** Seats to commit per SKU at true-up: seats needed after the chosen changes plus headroom. */
export function renewal(a: Analysis, catalog: Sku[], seats: Record<string, number>, apply: Set<string>, headroom: number): RenewalRow[] {
  const byId = new Map(catalog.map(k => [k.id, k]))
  const counts = new Map<string, { assigned: number; after: number }>()
  for (const v of a.users) {
    for (const id of v.user.licenses) { const c = counts.get(id) ?? { assigned: 0, after: 0 }; c.assigned++; counts.set(id, c) }
    for (const id of v.rec && apply.has(recKey(v.rec)) ? v.rec.to : v.user.licenses) { const c = counts.get(id) ?? { assigned: 0, after: 0 }; c.after++; counts.set(id, c) }
  }
  for (const id of Object.keys(seats)) if (!counts.has(id)) counts.set(id, { assigned: 0, after: 0 })
  const rows: RenewalRow[] = []
  for (const [id, c] of counts) {
    const sku = byId.get(id)
    if (!sku || sku.price === 0) continue
    const purchased = seats[id] ?? null
    const commit = c.after === 0 ? 0 : Math.ceil(c.after * (1 + headroom))
    rows.push({ sku, ...c, purchased, commit, change: purchased === null ? null : commit - purchased, annualNow: purchased === null ? null : round2(purchased * sku.price * 12), annualCommit: round2(commit * sku.price * 12) })
  }
  return rows.sort((x, y) => y.annualCommit - x.annualCommit || x.sku.name.localeCompare(y.sku.name))
}

/** Map Get-MgSubscribedSku rows (by skuPartNumber) to catalogue ids. */
export function seatsFromSkus(rows: SkuSeats[], catalog: Sku[]): Record<string, number> {
  const out: Record<string, number> = {}
  const idx = skuIndex(catalog)
  for (const r of rows) { const k = resolveSku(r.part, idx); if (k) out[k.id] = (out[k.id] ?? 0) + r.purchased }
  return out
}

// ---------- Snapshots and compare ----------

export interface Snapshot {
  id: string
  label: string
  createdAt: number
  asOf: string
  /** Paid and free licences per user at the time. */
  users: Record<string, string[]>
  /** Recommended target per user at the time. */
  recs: Record<string, string[]>
  prices: Record<string, number>
  spend: number
  identified: number
}

export function snapshotOf(a: Analysis, catalog: Sku[], id: string, label: string, createdAt: number): Snapshot {
  const users: Record<string, string[]> = {}, recs: Record<string, string[]> = {}
  for (const v of a.users) users[v.user.upn] = v.user.licenses
  for (const r of a.recs) recs[r.upn] = r.to
  const prices: Record<string, number> = {}
  for (const k of catalog) prices[k.id] = k.price
  return { id, label, createdAt, asOf: a.asOf, users, recs, prices, spend: a.totals.monthlySpend, identified: a.totals.monthlySaving }
}

export interface Change { upn: string; before: string[]; after: string[]; monthly: number; followed: boolean }
export interface Comparison { spendBefore: number; spendAfter: number; realised: number; followed: Change[]; other: Change[]; joined: string[]; left: string[]; skus: { id: string; before: number; after: number }[]; stillOpen: number }

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** What changed between two snapshots, and how much of it followed the earlier recommendations. Priced at the earlier snapshot's prices. */
export function compare(a: Snapshot, b: Snapshot): Comparison {
  const cost = (ids: string[]) => ids.reduce((t, id) => t + (a.prices[id] ?? b.prices[id] ?? 0), 0)
  const followed: Change[] = [], other: Change[] = []
  const upns = new Set([...Object.keys(a.users), ...Object.keys(b.users)])
  const joined: string[] = [], left: string[] = []
  const skuMap = new Map<string, { before: number; after: number }>()
  let stillOpen = 0
  for (const upn of upns) {
    const before = a.users[upn], after = b.users[upn]
    for (const id of before ?? []) { const s = skuMap.get(id) ?? { before: 0, after: 0 }; s.before++; skuMap.set(id, s) }
    for (const id of after ?? []) { const s = skuMap.get(id) ?? { before: 0, after: 0 }; s.after++; skuMap.set(id, s) }
    if (!before) { joined.push(upn); continue }
    const now = after ?? []
    if (!after) left.push(upn)
    const target = a.recs[upn]
    if (sameSet(before, now)) { if (target) stillOpen++; continue }
    const monthly = round2(cost(before) - cost(now))
    const ok = !!target && (sameSet(target, now) || (!after && target.every(id => (a.prices[id] ?? 0) === 0)))
    ;(ok ? followed : other).push({ upn, before, after: now, monthly, followed: ok })
  }
  const sorter = (x: Change, y: Change) => y.monthly - x.monthly || x.upn.localeCompare(y.upn)
  return {
    spendBefore: round2(cost(Object.values(a.users).flat())),
    spendAfter: round2(cost(Object.values(b.users).flat())),
    realised: round2(followed.reduce((t, c) => t + c.monthly, 0)),
    followed: followed.sort(sorter), other: other.sort(sorter), joined, left, stillOpen,
    skus: [...skuMap].map(([id, v]) => ({ id, ...v })).filter(x => x.before !== x.after).sort((x, y) => (y.before - y.after) - (x.before - x.after)),
  }
}
