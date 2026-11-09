// Two synthetic tenants (generated, not real organisations), built as the same reports an admin would export.
import { toCsv, type Kind, type UserRec } from './parse.ts'
import type { Source } from './rules.ts'

export interface SampleDef { id: string; name: string; blurb: string; domain: string; asOf: string; prevAsOf: string; prices: Record<string, number>; seats: Record<string, number> }

export const SAMPLES: SampleDef[] = [
  {
    id: 'fabrikam', name: 'Fabrikam Engineering (synthetic)', domain: 'fabrikam-eng.example',
    blurb: '180 users plus 8 shared and room mailboxes on Microsoft 365 E3 and E5: 23 inactive E3s, E5s on light users, licensed shared mailboxes, idle Copilot seats.',
    asOf: '2026-10-31', prevAsOf: '2026-09-30', prices: {},
    seats: { e3: 160, e5: 14, o365e3: 6, o365e1: 4, copilot: 15, pbipro: 3, entra1: 2, phone: 1 },
  },
  {
    id: 'tailspin', name: 'Tailspin Community Trust (synthetic)', domain: 'tailspin-trust.example',
    blurb: '60-user nonprofit on Business Premium at nonprofit prices: leavers still licensed, a licensed shared inbox, volunteers on Business Standard.',
    asOf: '2026-10-31', prevAsOf: '2026-09-30', prices: { bp: 5.5, bs: 3, bb: 0 },
    seats: { bp: 58, bs: 4, mdo1: 1 },
  },
]

function rng(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}

const FIRST = ['Avery', 'Jordan', 'Priya', 'Mateo', 'Hana', 'Liam', 'Sofia', 'Noah', 'Amara', 'Kenji', 'Elena', 'Omar', 'Grace', 'Ravi', 'Chloe', 'Diego', 'Fatima', 'Lucas', 'Mei', 'Samuel', 'Zara', 'Ethan', 'Leila', 'Owen', 'Ines', 'Tomas', 'Aisha', 'Felix', 'Nora', 'Kofi', 'Yuki', 'Isla', 'Arjun', 'Maya', 'Hugo', 'Lena']
const LAST = ['Okafor', 'Lindqvist', 'Patel', 'Garcia', 'Sato', 'Murphy', 'Rossi', 'Kim', 'Nguyen', 'Haddad', 'Novak', 'Mensah', 'Fischer', 'Silva', 'Walsh', 'Ito', 'Moreau', 'Kaur', 'Brennan', 'Costa', 'Adeyemi', 'Berg', 'Chen', 'Duarte', 'Ellis', 'Farah', 'Gupta', 'Horvat']
const DEPTS = ['Engineering', 'Design', 'Project Delivery', 'Finance', 'Operations', 'Sales', 'Workshop', 'IT']

export interface SampleUser extends UserRec { prevLicenses?: string[] }

const dayOff = (asOf: string, days: number) => new Date(Date.parse(asOf + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10)
const GB = 1024 ** 3

export function sampleUsers(id: string): SampleUser[] {
  const def = SAMPLES.find(s => s.id === id)!
  const r = rng(id === 'fabrikam' ? 180 : 60)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const used = new Set<string>()
  const person = (dept?: string): SampleUser => {
    let f: string, l: string, upn: string
    do { f = pick(FIRST); l = pick(LAST); upn = `${f}.${l}@${def.domain}`.toLowerCase() } while (used.has(upn))
    used.add(upn)
    return { upn, name: `${f} ${l}`, department: dept ?? pick(DEPTS), enabled: true, created: dayOff(def.asOf, int(200, 2400)), recipientType: 'user', hasArchive: false }
  }
  const active = (u: SampleUser, o: { desktop?: boolean; mailGB?: number; sends?: [number, number]; msgs?: [number, number]; calls?: [number, number]; files?: boolean } = {}): SampleUser => {
    const recentDay = () => dayOff(def.asOf, int(1, 9))
    u.lastSignIn = recentDay()
    u.exchange = o.sends && o.sends[1] === 0 ? undefined : recentDay()
    u.teams = recentDay()
    if (o.files !== false) { u.onedrive = recentDay(); u.sharepoint = recentDay() }
    u.desktop = o.desktop ?? true
    if (u.desktop) u.apps = recentDay()
    u.mailboxBytes = Math.round((o.mailGB ?? 2 + r() * 18) * GB)
    u.sends = int(...(o.sends ?? [60, 600]))
    u.teamsMsgs = int(...(o.msgs ?? [150, 2500]))
    u.calls = int(...(o.calls ?? [0, 40]))
    return u
  }
  const idle = (u: SampleUser, days: number | null): SampleUser => {
    if (days !== null) { const d = dayOff(def.asOf, days); u.lastSignIn = d; u.exchange = dayOff(def.asOf, days + int(0, 20)); u.teams = d }
    u.mailboxBytes = Math.round((0.5 + r() * 6) * GB); u.sends = 0; u.teamsMsgs = 0; u.calls = 0; u.desktop = false
    return u
  }
  const out: SampleUser[] = []
  const add = (n: number, make: (i: number) => SampleUser) => { for (let i = 0; i < n; i++) out.push(make(i)) }

  if (id === 'fabrikam') {
    // 23 inactive E3s: left without offboarding, long leave, project accounts nobody uses.
    add(23, i => ({ ...idle(person(), i < 5 ? null : int(95, 330)), licenses: ['e3'] }))
    // 4 leavers blocked at offboarding but still licensed. Two were caught last month (previous snapshot shows them).
    add(4, () => ({ ...idle(person(), int(20, 60)), enabled: false, licenses: ['e3'] }))
    add(2, () => ({ ...idle(person(), int(40, 70)), enabled: false, licenses: [], prevLicenses: ['e3'] }))
    // E5 on light users, and E5s that are genuinely used.
    add(8, i => ({ ...active(person(i < 4 ? 'Finance' : 'Operations'), { sends: [3, 28], msgs: [5, 90], calls: [0, 0] }), licenses: i < 3 ? ['e5', 'pbipro'] : ['e5'] }))
    add(5, i => ({ ...active(person(i < 2 ? 'IT' : 'Sales'), { calls: [12, 140] }), licenses: i === 0 ? ['e5', 'phone'] : ['e5'] }))
    // Three E5s already moved to E3 last month.
    add(3, () => ({ ...active(person('Project Delivery'), { sends: [10, 25], msgs: [20, 80], calls: [0, 0] }), licenses: ['e3'], prevLicenses: ['e5'] }))
    // Shared mailboxes and rooms holding user licences.
    const shared = (local: string, name: string, gb: number, lic: string[], archive = false): SampleUser => ({ upn: `${local}@${def.domain}`, name, department: 'Shared', enabled: false, created: dayOff(def.asOf, 1500), recipientType: 'shared', mailboxBytes: Math.round(gb * GB), hasArchive: archive, exchange: dayOff(def.asOf, 1), licenses: lic })
    out.push(shared('accounts', 'Accounts Payable', 14.2, ['e3']), shared('projects', 'Project Inbox', 6.8, ['e3']), shared('hr', 'HR Team', 3.1, ['o365e3']), shared('careers', 'Careers', 0.9, ['o365e1']), shared('tenders', 'Tenders', 72.4, ['e3'], true), shared('itsupport', 'IT Support', 22, ['exo1']))
    const room = (local: string, name: string): SampleUser => ({ upn: `${local}@${def.domain}`, name, department: 'Facilities', enabled: false, created: dayOff(def.asOf, 900), recipientType: 'room', mailboxBytes: Math.round(0.2 * GB), hasArchive: false, exchange: dayOff(def.asOf, 2), licenses: ['o365e1'] })
    out.push(room('room.boardroom', 'Boardroom'), room('room.studio', 'Design Studio'))
    // Workshop and site staff who live in Teams.
    add(10, () => ({ ...active(person('Workshop'), { desktop: false, mailGB: 0.3 + r() * 1.1, sends: [0, 12], msgs: [40, 600], files: false }), licenses: ['e3'] }))
    // Office 365 E3 seats with no desktop use.
    add(5, () => ({ ...active(person('Sales'), { desktop: false, mailGB: 4 + r() * 20 }), licenses: ['o365e3'] }))
    // Everyone else on E3, some with redundant add-ons and Copilot.
    add(120, i => {
      const u = active(person())
      const lic = ['e3']
      if (i < 2) lic.push('entra1')
      if (i >= 10 && i < 25) { lic.push('copilot'); u.copilot = i < 19 ? (i < 15 ? undefined : dayOff(def.asOf, int(45, 120))) : dayOff(def.asOf, int(1, 12)) }
      if (i === 30) lic.push('flowfree')
      return { ...u, licenses: lic }
    })
  } else {
    add(44, i => ({ ...active(person(pick(['Programs', 'Fundraising', 'Finance', 'Operations', 'Outreach']))), licenses: i === 0 ? ['bp', 'mdo1'] : ['bp'] }))
    add(5, i => ({ ...idle(person('Outreach'), i < 1 ? null : int(100, 260)), licenses: ['bp'] }))
    add(2, () => ({ ...idle(person('Programs'), int(30, 50)), enabled: false, licenses: ['bp'] }))
    add(1, () => ({ ...idle(person('Fundraising'), int(30, 50)), enabled: false, licenses: [], prevLicenses: ['bp'] }))
    out.push({ upn: `info@${def.domain}`, name: 'Info Inbox', department: 'Shared', enabled: false, created: dayOff(def.asOf, 1200), recipientType: 'shared', mailboxBytes: Math.round(8.4 * GB), hasArchive: false, exchange: dayOff(def.asOf, 1), licenses: ['bp'] })
    out.push({ upn: `donations@${def.domain}`, name: 'Donations', department: 'Shared', enabled: false, created: dayOff(def.asOf, 1100), recipientType: 'shared', mailboxBytes: Math.round(2.2 * GB), hasArchive: false, exchange: dayOff(def.asOf, 3), licenses: ['bs'] })
    add(3, () => ({ ...active(person('Volunteers'), { desktop: false, mailGB: 0.4 + r(), sends: [2, 40] }), licenses: ['bs'] }))
    add(3, () => ({ ...active(person('Volunteers'), { desktop: false, mailGB: 0.4 + r() }), licenses: ['bb'] }))
  }
  return out
}

/** Split the synthetic users into the reports an admin would export. `prev` gives last month's licence state. */
export function sampleSources(id: string, prev = false): Source[] {
  const def = SAMPLES.find(s => s.id === id)!
  const users = sampleUsers(id)
  const asOf = prev ? def.prevAsOf : def.asOf
  const pickRec = (u: SampleUser, keys: (keyof UserRec)[]): UserRec => {
    const o: Record<string, unknown> = { upn: u.upn }
    for (const k of keys) if (u[k] !== undefined) o[k] = u[k]
    return o as unknown as UserRec
  }
  const lic = (u: SampleUser) => prev && u.prevLicenses ? u.prevLicenses : u.licenses ?? []
  const s = (kind: Kind, rows: UserRec[]): Source => ({ kind, rows, refreshDate: kind === 'users' || kind === 'signins' ? null : asOf })
  const sources: Source[] = [
    s('users', users.map(u => ({ ...pickRec(u, ['name', 'department', 'enabled', 'created']), licenses: lic(u) }))),
    s('signins', users.filter(u => u.recipientType === 'user').map(u => pickRec(u, ['lastSignIn']))),
    s('active', users.map(u => ({ ...pickRec(u, ['exchange', 'onedrive', 'sharepoint', 'teams']) }))),
    s('mailbox', users.map(u => pickRec(u, ['mailboxBytes', 'hasArchive', 'recipientType']))),
    s('email', users.map(u => pickRec(u, ['sends']))),
    s('teams', users.filter(u => u.recipientType === 'user').map(u => pickRec(u, ['teamsMsgs', 'calls']))),
    s('apps', users.filter(u => u.recipientType === 'user').map(u => pickRec(u, ['desktop', 'apps']))),
  ]
  if (id === 'fabrikam') sources.push(s('copilot', users.filter(u => lic(u).includes('copilot')).map(u => pickRec(u, ['copilot']))))
  return sources
}

/** The synthetic tenant as a License Trim Graph export CSV, so the sample can also be downloaded and re-imported. */
export function sampleCombinedCsv(id: string, parts: (skuId: string) => string): string {
  const def = SAMPLES.find(s => s.id === id)!
  const head = ['UserPrincipalName', 'DisplayName', 'Department', 'AccountEnabled', 'CreatedDateTime', 'LastSignInDateTime', 'Licenses', 'RecipientType', 'MailboxUsedBytes', 'HasArchive', 'ExchangeLastActivity', 'OneDriveLastActivity', 'SharePointLastActivity', 'TeamsLastActivity', 'AppsLastActivity', 'CopilotLastActivity', 'DesktopApps', 'EmailSends', 'TeamsMessages', 'TeamsCalls', 'ReportRefreshDate']
  const rt = { user: 'User', shared: 'Shared', room: 'Room', equipment: 'Equipment' }
  const yn = (b: boolean | undefined) => b === undefined ? '' : b ? 'Yes' : 'No'
  return '# Synthetic sample tenant, not a real organisation\n' + toCsv([head, ...sampleUsers(id).map(u => [
    u.upn, u.name, u.department, u.enabled ? 'True' : 'False', u.created, u.lastSignIn, (u.licenses ?? []).map(parts).join(';'), rt[u.recipientType ?? 'user'],
    u.mailboxBytes, u.hasArchive ? 'True' : 'False', u.exchange, u.onedrive, u.sharepoint, u.teams, u.apps, u.copilot, u.recipientType === 'user' ? yn(u.desktop) : '',
    u.sends, u.teamsMsgs, u.calls, def.asOf,
  ])])
}
