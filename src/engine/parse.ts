// Import pipeline: CSV text -> detected report -> column mapping -> per-user records + a validation report with line numbers.
import { resolveSku, type Sku } from './catalog.ts'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const t = text.replace(/^﻿/, '')
  const first = t.split('\n', 1)[0]
  const delim = (first.match(/\t/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim()))
}

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n') + '\n'
}

/** One user's facts from one or more reports. Dates are YYYY-MM-DD. */
export interface UserRec {
  upn: string
  name?: string
  department?: string
  enabled?: boolean
  created?: string
  lastSignIn?: string
  licenses?: string[]
  recipientType?: 'user' | 'shared' | 'room' | 'equipment'
  mailboxBytes?: number
  hasArchive?: boolean
  exchange?: string
  onedrive?: string
  sharepoint?: string
  teams?: string
  apps?: string
  copilot?: string
  /** Used Office desktop apps (Windows or Mac) in the report period. */
  desktop?: boolean
  sends?: number
  teamsMsgs?: number
  calls?: number
}

export interface SkuSeats { part: string; purchased: number; consumed: number }

export type Kind = 'users' | 'signins' | 'active' | 'email' | 'mailbox' | 'teams' | 'onedrive' | 'sharepoint' | 'apps' | 'copilot' | 'combined' | 'skus'

export const KIND_LABEL: Record<Kind, string> = {
  users: 'Admin center: Active users export',
  signins: 'Entra: users with lastSignInDateTime',
  active: 'Usage: Microsoft 365 active users',
  email: 'Usage: Email activity',
  mailbox: 'Usage: Mailbox usage',
  teams: 'Usage: Teams user activity',
  onedrive: 'Usage: OneDrive activity',
  sharepoint: 'Usage: SharePoint activity',
  apps: 'Usage: Microsoft 365 Apps usage',
  copilot: 'Usage: Microsoft 365 Copilot usage',
  combined: 'License Trim Graph export (one CSV)',
  skus: 'Subscribed SKUs (purchased seats)',
}

export type Field =
  | 'upn' | 'name' | 'department' | 'enabled' | 'blocked' | 'created' | 'lastSignIn' | 'lastNonInteractive' | 'licenses' | 'recipientType'
  | 'mailboxBytes' | 'hasArchive' | 'lastActivity' | 'exchange' | 'onedrive' | 'sharepoint' | 'teams' | 'apps' | 'copilot'
  | 'desktop' | 'win' | 'mac' | 'sends' | 'teamChat' | 'privateChat' | 'calls' | 'refresh' | 'part' | 'purchased' | 'consumed'

export const FIELD_LABEL: Record<Field, string> = {
  upn: 'User principal name', name: 'Display name', department: 'Department', enabled: 'Account enabled', blocked: 'Block credential (sign-in blocked)',
  created: 'Created date', lastSignIn: 'Last sign-in', lastNonInteractive: 'Last non-interactive sign-in', licenses: 'Licences / Assigned products',
  recipientType: 'Recipient type', mailboxBytes: 'Mailbox storage used (bytes)', hasArchive: 'Has archive', lastActivity: 'Last activity date',
  exchange: 'Exchange last activity', onedrive: 'OneDrive last activity', sharepoint: 'SharePoint last activity', teams: 'Teams last activity',
  apps: 'Microsoft 365 Apps last activity', copilot: 'Copilot last activity', desktop: 'Uses desktop apps', win: 'Windows (apps)', mac: 'Mac (apps)',
  sends: 'Send count', teamChat: 'Team chat message count', privateChat: 'Private chat message count', calls: 'Call count',
  refresh: 'Report refresh date', part: 'SKU part number', purchased: 'Purchased (prepaid) units', consumed: 'Consumed units',
}

const SYN: [Field, RegExp][] = [
  ['upn', /^(user ?principal ?name|upn|owner principal name|user)$/],
  ['name', /^(display ?name|owner display name|name)$/],
  ['department', /^department$/],
  ['enabled', /^(account ?enabled|enabled)$/],
  ['blocked', /^(block credential|sign ?in blocked|blockcredential)$/],
  ['created', /^(when created|created ?date ?time|created date|created)$/],
  ['lastSignIn', /^(last ?sign ?in ?date ?time|last ?successful ?sign ?in ?date ?time|last (interactive )?sign ?in|last successful sign ?in)$/],
  ['lastNonInteractive', /^(last ?non ?interactive ?sign ?in ?date ?time|last non ?interactive sign ?in)$/],
  ['licenses', /^(licenses|licences|assigned products|assigned ?licenses|skus)$/],
  ['recipientType', /^(recipient ?type( ?details)?|mailbox type)$/],
  ['mailboxBytes', /^(storage used \(byte\)|mailbox ?used ?bytes|total item size \(bytes\))$/],
  ['hasArchive', /^has ?archive$/],
  ['exchange', /^exchange ?last ?activity( date)?$/],
  ['onedrive', /^one ?drive ?last ?activity( date)?$/],
  ['sharepoint', /^share ?point ?last ?activity( date)?$/],
  ['teams', /^teams ?last ?activity( date)?$/],
  ['apps', /^apps ?last ?activity( date)?$/],
  ['copilot', /^copilot ?last ?activity( date)?$/],
  ['lastActivity', /^last ?activity ?date$/],
  ['desktop', /^(desktop ?apps|uses desktop apps)$/],
  ['win', /^windows$/],
  ['mac', /^mac$/],
  ['sends', /^(send ?count|email ?sends)$/],
  ['teamChat', /^(team chat message count|teams ?messages)$/],
  ['privateChat', /^private chat message count$/],
  ['calls', /^(call ?count|teams ?calls)$/],
  ['refresh', /^(report refresh date|report ?refresh ?date)$/],
  ['part', /^sku ?part ?number$/],
  ['purchased', /^(prepaid ?units|prepaid ?enabled|enabled units|purchased)$/],
  ['consumed', /^(consumed ?units|consumed)$/],
]

export const normHeader = (h: string) => h.toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()

export function guessColumns(headers: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {}
  headers.forEach((h, i) => {
    const n = normHeader(h)
    for (const [f, re] of SYN) if (out[f] === undefined && re.test(n)) { out[f] = i; break }
  })
  return out
}

export interface Detected { kind: Kind; format: string; headerRow: number; headers: string[]; columns: Partial<Record<Field, number>> }

export function detectKind(headers: string[]): Kind {
  const hs = headers.map(normHeader)
  const has = (re: RegExp) => hs.some(h => re.test(h))
  if (has(/^sku ?part ?number$/) && has(/consumed/)) return 'skus'
  if (has(/^licen[sc]es$/) && has(/last ?sign ?in/) && has(/mailbox ?used ?bytes|exchange ?last ?activity/)) return 'combined'
  if (has(/copilot/) && has(/last activity date/)) return 'copilot'
  if (has(/^exchange last activity date$/)) return 'active'
  if (has(/^send count$/)) return 'email'
  if (has(/prohibit send quota|^item count$/)) return 'mailbox'
  if (has(/chat message count/)) return 'teams'
  if (has(/^visited page count$/)) return 'sharepoint'
  if (has(/^viewed or edited file count$|^synced file count$/)) return 'onedrive'
  if (has(/^last activation date$|\(windows\)$/)) return 'apps'
  if (has(/^licen[sc]es$/)) return 'users'
  if (has(/last ?sign ?in|signinactivity/)) return 'signins'
  return 'users'
}

export function detect(rows: string[][]): Detected {
  // Some exports carry a title line above the header; pick the first row that looks like a header.
  let headerRow = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const c = guessColumns(rows[i])
    if (c.upn !== undefined || c.part !== undefined) { headerRow = i; break }
  }
  const headers = rows[headerRow] ?? []
  const kind = detectKind(headers)
  return { kind, format: KIND_LABEL[kind], headerRow, headers, columns: guessColumns(headers) }
}

/** Fields worth offering in the mapping UI for each report kind. */
export const KIND_FIELDS: Record<Kind, Field[]> = {
  users: ['upn', 'name', 'department', 'licenses', 'blocked', 'enabled', 'created'],
  signins: ['upn', 'name', 'enabled', 'lastSignIn', 'lastNonInteractive', 'created'],
  active: ['upn', 'name', 'refresh', 'licenses', 'exchange', 'onedrive', 'sharepoint', 'teams'],
  email: ['upn', 'refresh', 'lastActivity', 'sends'],
  mailbox: ['upn', 'refresh', 'lastActivity', 'mailboxBytes', 'hasArchive', 'recipientType'],
  teams: ['upn', 'refresh', 'lastActivity', 'teamChat', 'privateChat', 'calls'],
  onedrive: ['upn', 'refresh', 'lastActivity'],
  sharepoint: ['upn', 'refresh', 'lastActivity'],
  apps: ['upn', 'refresh', 'lastActivity', 'win', 'mac'],
  copilot: ['upn', 'refresh', 'lastActivity'],
  combined: ['upn', 'name', 'department', 'enabled', 'created', 'lastSignIn', 'lastNonInteractive', 'licenses', 'recipientType', 'mailboxBytes', 'hasArchive', 'exchange', 'onedrive', 'sharepoint', 'teams', 'apps', 'copilot', 'desktop', 'sends', 'teamChat', 'calls', 'refresh'],
  skus: ['part', 'purchased', 'consumed'],
}

/** Which workload a report's generic "Last Activity Date" belongs to. */
const ACTIVITY_OF: Partial<Record<Kind, 'exchange' | 'onedrive' | 'sharepoint' | 'teams' | 'apps' | 'copilot'>> = {
  email: 'exchange', mailbox: 'exchange', teams: 'teams', onedrive: 'onedrive', sharepoint: 'sharepoint', apps: 'apps', copilot: 'copilot',
}

// ---------- Value parsers ----------

/** "2026-10-28", "2026-10-28T13:22:11Z", "10/28/2026 1:22 PM" -> "2026-10-28". Empty or "Never" -> null. Undefined for junk. */
export function toDate(s: string | undefined): string | null | undefined {
  if (s === undefined) return null
  const t = s.trim()
  if (!t || /^(never|n\/a|none|null|-)$/i.test(t)) return null
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const a = +m[1], b = +m[2]
    const [mo, d] = a > 12 ? [b, a] : [a, b]
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return undefined
}

export function toBool(s: string | undefined): boolean | undefined {
  const t = (s ?? '').trim().toLowerCase()
  if (/^(true|yes|y|1|enabled)$/.test(t)) return true
  if (/^(false|no|n|0|disabled)$/.test(t)) return false
  return undefined
}

export function toNum(s: string | undefined): number | undefined {
  const t = (s ?? '').replace(/,/g, '').trim()
  if (t === '') return 0
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : undefined
}

export function toRecipient(s: string | undefined): UserRec['recipientType'] {
  const t = (s ?? '').toLowerCase()
  if (/shared/.test(t)) return 'shared'
  if (/room/.test(t)) return 'room'
  if (/equipment/.test(t)) return 'equipment'
  return t ? 'user' : undefined
}

export const splitLicenses = (s: string) => s.split(/\s*[+;|]\s*/).map(x => x.trim()).filter(x => x && !/^unlicen[sc]ed$/i.test(x))

/** The admin center can replace user names with 32-character hashes in usage reports. */
export const isConcealed = (upn: string) => /^[0-9a-f]{32}$/i.test(upn)

// ---------- Parse ----------

export interface Issue { line: number; message: string; level: 'error' | 'warning' }

export interface Parsed {
  kind: Kind
  rows: UserRec[]
  skus: SkuSeats[]
  issues: Issue[]
  refreshDate: string | null
  concealed: number
  unknownLicenses: Record<string, number>
  duplicates: number
  /** Report kinds whose evidence this file carries (the one-CSV export covers several). */
  covers: Kind[]
}

export function parseRows(rows: string[][], d: Detected, idx: Map<string, Sku>): Parsed {
  const out: Parsed = { kind: d.kind, rows: [], skus: [], issues: [], refreshDate: null, concealed: 0, unknownLicenses: {}, duplicates: 0, covers: [d.kind] }
  const c = d.columns
  const issue = (line: number, message: string, level: Issue['level'] = 'error') => { if (out.issues.length < 500) out.issues.push({ line, message, level }) }
  const get = (r: string[], f: Field) => c[f] === undefined ? undefined : r[c[f]!]
  if (d.kind === 'skus') {
    if (c.part === undefined) issue(d.headerRow + 1, 'No SkuPartNumber column found. Map it below.')
    for (let i = d.headerRow + 1; i < rows.length; i++) {
      const r = rows[i]
      if (!r.some(x => x)) continue
      const part = get(r, 'part') ?? ''
      const purchased = toNum(get(r, 'purchased')), consumed = toNum(get(r, 'consumed'))
      if (!part) { issue(i + 1, 'Missing SKU part number'); continue }
      if (purchased === undefined || consumed === undefined) { issue(i + 1, `Seat counts are not numbers for ${part}`); continue }
      out.skus.push({ part, purchased, consumed })
    }
    return out
  }
  if (d.kind === 'combined') {
    const map: [Field, Kind][] = [['lastSignIn', 'signins'], ['exchange', 'active'], ['mailboxBytes', 'mailbox'], ['sends', 'email'], ['teamChat', 'teams'], ['desktop', 'apps'], ['copilot', 'copilot']]
    for (const [f, k] of map) if (c[f] !== undefined) out.covers.push(k)
  }
  if (c.upn === undefined) { issue(d.headerRow + 1, 'No user principal name column found. Map it below; every report is joined on UPN.'); return out }
  const seen = new Set<string>()
  const firstLine: Record<string, number> = {}
  const act = ACTIVITY_OF[d.kind]
  for (let i = d.headerRow + 1; i < rows.length; i++) {
    const r = rows[i], ln = i + 1
    if (!r.some(x => x)) continue
    const upnRaw = get(r, 'upn') ?? ''
    if (!upnRaw) { issue(ln, 'Missing user principal name; row skipped'); continue }
    if (isConcealed(upnRaw)) { out.concealed++; if (out.concealed <= 3) issue(ln, `User name is concealed (${upnRaw.slice(0, 8)}…). Turn off "Display concealed user, group, and site names in all reports" and export again.`); continue }
    const upn = upnRaw.toLowerCase()
    if (!upn.includes('@')) issue(ln, `"${upnRaw}" does not look like a UPN`, 'warning')
    if (seen.has(upn)) { out.duplicates++; issue(ln, `${upn} appears more than once; the later row wins`, 'warning') }
    seen.add(upn)
    const u: UserRec = { upn }
    const name = get(r, 'name'); if (name) u.name = name
    const dep = get(r, 'department'); if (dep) u.department = dep
    const date = (f: Field): string | undefined => {
      const v = get(r, f)
      const p = toDate(v)
      if (p === undefined) { issue(ln, `${FIELD_LABEL[f]} "${v}" is not a date`, 'warning'); return undefined }
      return p ?? undefined
    }
    const num = (f: Field): number | undefined => {
      if (c[f] === undefined) return undefined
      const v = toNum(get(r, f))
      if (v === undefined) issue(ln, `${FIELD_LABEL[f]} "${get(r, f)}" is not a number`, 'warning')
      return v
    }
    if (c.enabled !== undefined) { const b = toBool(get(r, 'enabled')); if (b !== undefined) u.enabled = b }
    if (c.blocked !== undefined) { const b = toBool(get(r, 'blocked')); if (b !== undefined) u.enabled = !b }
    const created = date('created'); if (created) u.created = created
    const si = [date('lastSignIn'), date('lastNonInteractive')].filter(Boolean).sort().pop()
    if (si) u.lastSignIn = si
    if (c.licenses !== undefined) {
      const names = splitLicenses(get(r, 'licenses') ?? '')
      u.licenses = []
      for (const n of names) {
        const k = resolveSku(n, idx)
        if (k) u.licenses.push(k.id)
        else { out.unknownLicenses[n] = (out.unknownLicenses[n] ?? 0) + 1; firstLine[n] ??= ln }
      }
    }
    const rt = toRecipient(get(r, 'recipientType')); if (rt) u.recipientType = rt
    const mb = num('mailboxBytes'); if (mb !== undefined) u.mailboxBytes = mb
    if (c.hasArchive !== undefined) u.hasArchive = toBool(get(r, 'hasArchive')) ?? false
    for (const f of ['exchange', 'onedrive', 'sharepoint', 'teams', 'apps', 'copilot'] as const) { const v = date(f); if (v) u[f] = v }
    if (act && c.lastActivity !== undefined) { const v = date('lastActivity'); if (v) u[act] = v }
    if (c.desktop !== undefined) u.desktop = toBool(get(r, 'desktop')) ?? false
    if (c.win !== undefined || c.mac !== undefined) u.desktop = !!(toBool(get(r, 'win')) || toBool(get(r, 'mac')))
    const sends = num('sends'); if (sends !== undefined) u.sends = sends
    if (c.teamChat !== undefined || c.privateChat !== undefined) u.teamsMsgs = (num('teamChat') ?? 0) + (num('privateChat') ?? 0)
    const calls = num('calls'); if (calls !== undefined) u.calls = calls
    const ref = c.refresh !== undefined ? toDate(get(r, 'refresh')) : null
    if (ref && (!out.refreshDate || ref > out.refreshDate)) out.refreshDate = ref
    out.rows.push(u)
  }
  if (out.concealed > 3) issue(d.headerRow + 1, `${out.concealed} rows in total have concealed user names and were skipped.`)
  for (const [n, k] of Object.entries(out.unknownLicenses)) issue(firstLine[n], `Licence "${n}" (${k} users) is not in the price list, so it is left out of spend and savings.`, 'warning')
  return out
}

export function parseText(text: string, idx: Map<string, Sku>, override?: Partial<Pick<Detected, 'kind' | 'columns'>>): { detected: Detected; parsed: Parsed } {
  const rows = parseCsv(text)
  const auto = detect(rows)
  const detected: Detected = { ...auto, ...(override?.kind ? { kind: override.kind, format: KIND_LABEL[override.kind] } : {}), ...(override?.columns ? { columns: override.columns } : {}) }
  return { detected, parsed: parseRows(rows, detected, idx) }
}
