import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CATALOG, effectiveCatalog, resolveSku, skuIndex } from './catalog.ts'
import { detect, isConcealed, parseCsv, parseText, splitLicenses, toDate, type UserRec } from './parse.ts'
import { analyze, compare, covered, decisionOf, DEFAULT_SETTINGS, join, recKey, renewal, seatsFromSkus, snapshotOf, type Settings, type Source } from './rules.ts'
import { sampleCombinedCsv, sampleSources, SAMPLES } from './sample.ts'
import { changesCsv, changeScript } from './script.ts'

const cat = DEFAULT_CATALOG
const idx = skuIndex(cat)
const byId = new Map(cat.map(k => [k.id, k]))
const AS_OF = '2026-10-31'
const GB = 1024 ** 3

/** A fully-known active E3 user; override what the test is about. */
const user = (o: Partial<UserRec> & { upn?: string } = {}): UserRec => ({
  upn: o.upn ?? 'a@x.example', name: 'A', enabled: true, created: '2022-01-01', recipientType: 'user', hasArchive: false,
  lastSignIn: '2026-10-29', exchange: '2026-10-29', teams: '2026-10-29', onedrive: '2026-10-20', sharepoint: '2026-10-20', apps: '2026-10-29',
  desktop: true, mailboxBytes: 8 * GB, sends: 200, teamsMsgs: 900, calls: 10, licenses: ['e3'], ...o,
})
const ALL_KINDS: Source['kind'][] = ['signins', 'active', 'mailbox', 'email', 'teams', 'apps', 'copilot']
const run = (users: UserRec[], s: Partial<Settings> = {}, kinds = ALL_KINDS) =>
  analyze(join([{ kind: 'users', rows: users, refreshDate: AS_OF, covers: kinds }], AS_OF), cat, { ...DEFAULT_SETTINGS, ...s })
const recOf = (u: UserRec, s: Partial<Settings> = {}, kinds = ALL_KINDS) => run([u], s, kinds).recs[0] ?? null

// ---------- Catalogue and parsing ----------

test('licence names resolve from admin center names, usage-report caps and skuPartNumbers', () => {
  assert.equal(resolveSku('Microsoft 365 E3', idx)?.id, 'e3')
  assert.equal(resolveSku('MICROSOFT 365 E3', idx)?.id, 'e3')
  assert.equal(resolveSku('SPE_E3', idx)?.id, 'e3')
  assert.equal(resolveSku('Office 365 Business Premium', idx)?.id, 'bs', 'old name of Business Standard')
  assert.equal(resolveSku('SPE_F1', idx)?.id, 'f3', 'F3 has the confusing part number SPE_F1')
  assert.equal(resolveSku('Contoso Widget Plan', idx), null)
})

test('licence lists split on + and ; and ignore "Unlicensed"', () => {
  assert.deepEqual(splitLicenses('Microsoft 365 E5+Power BI Pro'), ['Microsoft 365 E5', 'Power BI Pro'])
  assert.deepEqual(splitLicenses('SPE_E3;Microsoft_365_Copilot'), ['SPE_E3', 'Microsoft_365_Copilot'])
  assert.deepEqual(splitLicenses('Unlicensed'), [])
})

test('dates parse from ISO, ISO timestamps and US admin-center format; Never is empty; junk is flagged', () => {
  assert.equal(toDate('2026-10-28'), '2026-10-28')
  assert.equal(toDate('2026-10-28T13:22:11Z'), '2026-10-28')
  assert.equal(toDate('10/28/2026 1:22:11 PM'), '2026-10-28')
  assert.equal(toDate('Never'), null)
  assert.equal(toDate(''), null)
  assert.equal(toDate('last tuesday'), undefined)
})

test('CSV parser handles quotes, embedded commas, BOM and CRLF', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']])
})

test('format detection recognises each Microsoft 365 export by its columns', () => {
  const k = (h: string) => detect([h.split(',')]).kind
  assert.equal(k('Block credential,City,Display name,Licenses,User principal name,When created'), 'users')
  assert.equal(k('Report Refresh Date,User Principal Name,Display Name,Is Deleted,Exchange Last Activity Date,OneDrive Last Activity Date'), 'active')
  assert.equal(k('Report Refresh Date,User Principal Name,Display Name,Last Activity Date,Send Count,Receive Count,Read Count'), 'email')
  assert.equal(k('Report Refresh Date,User Principal Name,Display Name,Item Count,Storage Used (Byte),Prohibit Send Quota (Byte),Has Archive,Recipient Type'), 'mailbox')
  assert.equal(k('Report Refresh Date,User Id,User Principal Name,Last Activity Date,Team Chat Message Count,Private Chat Message Count,Call Count'), 'teams')
  assert.equal(k('Report Refresh Date,User Principal Name,Last Activation Date,Last Activity Date,Windows,Mac,Mobile,Web'), 'apps')
  assert.equal(k('id,userPrincipalName,accountEnabled,lastSignInDateTime'), 'signins')
  assert.equal(k('Report Refresh Date,User Principal Name,Display Name,Last Activity Date,Microsoft Teams Copilot Last Activity Date'), 'copilot')
  assert.equal(k('SkuPartNumber,ConsumedUnits,PrepaidUnits'), 'skus')
})

test('validation report: line numbers, concealed names, unknown licences, duplicates, bad dates', () => {
  const csv = [
    'User principal name,Display name,Licenses,Block credential,When created',
    'a@x.example,A,Microsoft 365 E3,False,2023-01-01',
    '0123456789ABCDEF0123456789ABCDEF,B,Microsoft 365 E3,False,2023-01-01',
    'a@x.example,A again,Contoso Widget Plan,False,soon',
    ',Nobody,Microsoft 365 E3,False,2023-01-01',
  ].join('\n')
  const { parsed } = parseText(csv, idx)
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.concealed, 1)
  assert.equal(parsed.duplicates, 1)
  assert.deepEqual(parsed.unknownLicenses, { 'Contoso Widget Plan': 1 })
  const lines = parsed.issues.map(i => i.line)
  assert.ok(lines.includes(3), 'concealed row flagged on line 3')
  assert.ok(lines.includes(4), 'duplicate and bad date on line 4')
  assert.ok(parsed.issues.some(i => i.line === 5 && /Missing user principal name/.test(i.message)))
  assert.ok(isConcealed('0123456789abcdef0123456789abcdef'))
})

test('join merges reports per UPN: priority source owns licences, latest dates win, refresh date sets as-of', () => {
  const j = join([
    { kind: 'active', rows: [{ upn: 'a@x', licenses: ['e5'], teams: '2026-09-01' }], refreshDate: '2026-10-30' },
    { kind: 'users', rows: [{ upn: 'a@x', licenses: ['e3'], enabled: true }], refreshDate: null },
    { kind: 'teams', rows: [{ upn: 'a@x', teams: '2026-10-02', teamsMsgs: 5 }], refreshDate: '2026-10-31' },
  ], '2026-11-08')
  assert.equal(j.users.length, 1)
  assert.deepEqual(j.users[0].licenses, ['e3'])
  assert.equal(j.users[0].teams, '2026-10-02')
  assert.equal(j.users[0].teamsMsgs, 5)
  assert.equal(j.asOf, '2026-10-31')
})

// ---------- Rules ----------

test('a fully used E3 gets no recommendation', () => {
  assert.equal(recOf(user()), null)
})

test('inactive: no sign-in or activity for N days removes the licence, high confidence with both sources', () => {
  const r = recOf(user({ lastSignIn: '2026-06-01', exchange: '2026-06-01', teams: '2026-05-01', onedrive: undefined, sharepoint: undefined, apps: undefined }))!
  assert.equal(r.reason, 'inactive')
  assert.deepEqual(r.to, [])
  assert.equal(r.monthly, 39)
  assert.equal(r.annual, 468)
  assert.equal(r.confidence, 'high')
})

test('inactive threshold is a setting, and sign-in-only evidence is medium confidence', () => {
  const u = user({ lastSignIn: '2026-08-15', exchange: undefined, teams: undefined, onedrive: undefined, sharepoint: undefined, apps: undefined })
  assert.equal(recOf(u), null, '77 days is under the 90 day default')
  assert.equal(recOf(u, { inactiveDays: 60 })?.reason, 'inactive')
  assert.equal(recOf(u, { inactiveDays: 60 }, ['signins'])?.confidence, 'medium')
})

test('new hires who have not signed in yet are not flagged', () => {
  assert.equal(recOf(user({ created: '2026-10-20', lastSignIn: undefined, exchange: undefined, teams: undefined, onedrive: undefined, sharepoint: undefined, apps: undefined })), null)
})

test('disabled but licensed: remove paid licences, keep free ones, warn about the mailbox', () => {
  const r = recOf(user({ enabled: false, licenses: ['e3', 'flowfree'] }))!
  assert.equal(r.reason, 'disabled')
  assert.deepEqual(r.to, ['flowfree'])
  assert.ok(r.caveats.some(c => /30 days/.test(c)))
})

test('shared mailbox under 50 GB with no archive needs no licence; over 50 GB or archived needs Exchange Plan 2', () => {
  assert.deepEqual(recOf(user({ recipientType: 'shared', enabled: false, mailboxBytes: 12 * GB }))!.to, [])
  const big = recOf(user({ recipientType: 'shared', enabled: false, mailboxBytes: 72 * GB, hasArchive: true }))!
  assert.deepEqual(big.to, ['exo2'])
  assert.equal(big.monthly, 31)
  assert.equal(recOf(user({ recipientType: 'shared', mailboxBytes: 60 * GB, licenses: ['exo2'] })), null, 'already on the cheapest valid licence')
})

test('room mailboxes drop user licences but keep Teams Rooms licences', () => {
  const r = recOf(user({ recipientType: 'room', licenses: ['o365e1', 'roomspro'] }))!
  assert.equal(r.reason, 'room')
  assert.deepEqual(r.to, ['roomspro'])
})

test('overlap: E5 plus a standalone add-on it already includes', () => {
  const r = recOf(user({ licenses: ['e5', 'phone'], calls: 80 }))!
  assert.equal(r.reason, 'overlap')
  assert.deepEqual(r.to, ['e5'])
  assert.equal(r.monthly, 10)
  assert.ok(covered(byId.get('entra1')!, [byId.get('bp')!]))
  assert.ok(!covered(byId.get('teams')!, [byId.get('e3-nt')!]), 'Teams Enterprise is needed on a no-Teams suite')
})

test('two base plans: the covered one is removed', () => {
  const r = recOf(user({ licenses: ['e3', 'e5'], calls: 30 }))!
  assert.deepEqual(r.to, ['e5'])
  assert.equal(r.monthly, 39)
})

test('E5 on a light user moves to E3; heavy callers and keepE5 tenants are left alone', () => {
  const light = user({ licenses: ['e5'], sends: 12, teamsMsgs: 40, calls: 0 })
  const r = recOf(light)!
  assert.equal(r.reason, 'e5')
  assert.deepEqual(r.to, ['e3'])
  assert.equal(r.monthly, 21)
  assert.equal(r.confidence, 'medium')
  assert.equal(recOf({ ...light, calls: 5 }), null)
  assert.equal(recOf(light, { keepE5: true }), null)
})

test('E5 light user who bought Power BI Pro separately keeps it after moving to E3', () => {
  const r = recOf(user({ licenses: ['e5', 'pbipro'], sends: 12, teamsMsgs: 40, calls: 0 }))!
  assert.deepEqual([...r.to].sort(), ['e3', 'pbipro'])
  assert.equal(r.monthly, 60 + 14 - 39 - 14)
})

test('Teams-only user with a small mailbox moves to F3; frontline can be switched off', () => {
  const u = user({ desktop: false, apps: undefined, mailboxBytes: 0.8 * GB, sends: 4, onedrive: undefined, sharepoint: undefined })
  const r = recOf(u)!
  assert.equal(r.reason, 'teamsOnly')
  assert.deepEqual(r.to, ['f3'])
  assert.ok(r.caveats.some(c => /frontline/.test(c)))
  assert.equal(recOf(u, { allowFrontline: false }), null)
})

test('mailbox size blocks a downgrade to a plan whose quota it would not fit', () => {
  assert.equal(recOf(user({ desktop: false, mailboxBytes: 3 * GB })), null, '3 GB does not fit F3 (2 GB) and E3 is the cheapest enterprise plan with Intune')
  const o = user({ licenses: ['o365e3'], desktop: false, mailboxBytes: 45 * GB })
  assert.equal(recOf(o), null, '45 GB with 25% headroom does not fit E1 (50 GB)')
  assert.deepEqual(recOf({ ...o, mailboxBytes: 20 * GB })!.to, ['o365e1'])
})

test('desktop use unknown (no Apps usage report) never triggers a desktop downgrade', () => {
  const u = user({ licenses: ['bs'], desktop: false })
  assert.deepEqual(recOf(u)!.to, ['bb'])
  assert.equal(recOf(u, {}, ['signins', 'active', 'mailbox', 'email', 'teams']), null)
})

test('unused Copilot is reclaimed after the Copilot window; recent use and no Copilot report keep it', () => {
  assert.equal(recOf(user({ licenses: ['e3', 'copilot'], copilot: '2026-08-01' }))!.reason, 'copilot')
  assert.equal(recOf(user({ licenses: ['e3', 'copilot'], copilot: '2026-10-25' })), null)
  assert.equal(recOf(user({ licenses: ['e3', 'copilot'] }), {}, ['signins', 'active', 'mailbox', 'email', 'teams', 'apps']), null)
})

test('price overrides change the savings (nonprofit Business Premium)', () => {
  const np = effectiveCatalog({ bp: 5.5 })
  const a = analyze(join([{ kind: 'users', rows: [user({ licenses: ['bp'], enabled: false })], refreshDate: AS_OF, covers: ALL_KINDS }], AS_OF), np)
  assert.equal(a.recs[0].monthly, 5.5)
})

// ---------- Totals, renewal, history, script ----------

test('synthetic 180-user tenant: 23 inactive E3s, light E5s, licensed shared mailboxes, totals add up', () => {
  const def = SAMPLES[0]
  const a = analyze(join(sampleSources(def.id), def.asOf), cat)
  const inactiveE3 = a.recs.filter(r => r.reason === 'inactive' && r.from.includes('e3'))
  assert.equal(inactiveE3.length, 23)
  assert.ok(a.recs.some(r => r.reason === 'e5'))
  assert.ok(a.recs.filter(r => r.reason === 'shared').length >= 5)
  const sum = a.recs.reduce((t, r) => t + r.monthly, 0)
  assert.ok(Math.abs(sum - a.totals.monthlySaving) < 0.01)
  assert.ok(Math.abs(a.totals.monthlySpend - a.totals.monthlyAfter - a.totals.monthlySaving) < 0.01)
  const conf = a.totals.byConfidence
  assert.ok(Math.abs(conf.high + conf.medium + conf.low - a.totals.monthlySaving) < 0.01)
})

test('the sample exported as one CSV re-imports to the same savings', () => {
  const def = SAMPLES[0]
  const direct = analyze(join(sampleSources(def.id), def.asOf), cat)
  const csv = sampleCombinedCsv(def.id, id => byId.get(id)!.part)
  const { detected, parsed } = parseText(csv, idx)
  assert.equal(detected.kind, 'combined')
  assert.equal(parsed.issues.filter(i => i.level === 'error').length, 0)
  const viaCsv = analyze(join([{ kind: 'combined', rows: parsed.rows, refreshDate: parsed.refreshDate, covers: parsed.covers }], def.asOf), cat)
  assert.equal(viaCsv.totals.monthlySaving, direct.totals.monthlySaving)
  assert.equal(viaCsv.recs.length, direct.recs.length)
})

test('renewal planner: approved changes only, headroom rounds up, compares to purchased seats', () => {
  const a = run([user({ upn: 'a@x' }), user({ upn: 'b@x', enabled: false }), user({ upn: 'c@x', enabled: false })])
  const approved = new Set([recKey(a.recs[0])])
  const rows = renewal(a, cat, { e3: 5 }, approved, 0.05)
  const e3 = rows.find(r => r.sku.id === 'e3')!
  assert.equal(e3.assigned, 3)
  assert.equal(e3.after, 2)
  assert.equal(e3.commit, 3, 'ceil(2 * 1.05)')
  assert.equal(e3.change, -2)
  assert.equal(e3.annualCommit, 3 * 39 * 12)
  assert.deepEqual(seatsFromSkus([{ part: 'SPE_E3', purchased: 160, consumed: 150 }, { part: 'MYSTERY', purchased: 1, consumed: 1 }], cat), { e3: 160 })
})

test('decisions are tied to the exact change and reset when the recommendation changes', () => {
  const a = run([user({ enabled: false })])
  const r = a.recs[0]
  const d = { [recKey(r)]: 'approved' as const }
  assert.equal(decisionOf(r, d), 'approved')
  assert.equal(decisionOf({ ...r, to: ['f3'] }, d), 'pending')
})

test('snapshot compare: realised savings count only changes that followed the recommendation', () => {
  const def = SAMPLES[0]
  const prev = analyze(join(sampleSources(def.id, true), def.prevAsOf), cat)
  const now = analyze(join(sampleSources(def.id), def.asOf), cat)
  const c = compare(snapshotOf(prev, cat, 's1', 'Sep', 1), snapshotOf(now, cat, 's2', 'Oct', 2))
  assert.equal(c.followed.length, 5, '2 leavers cleaned up + 3 E5s moved to E3')
  assert.equal(c.realised, 2 * 39 + 3 * 21)
  assert.equal(c.spendBefore - c.spendAfter, c.realised)
  assert.ok(c.skus.some(s => s.id === 'e5' && s.before - s.after === 3))
})

test('change script: dry run by default, resolves SKU ids by part number, rollback inverts the change', () => {
  const a = run([user({ licenses: ['e5', 'phone'], calls: 9 }), user({ upn: "o'brien@x.example", enabled: false })])
  const s = changeScript(a.recs, byId, { tenant: 'T', generated: '2026-11-08' })
  assert.match(s, /param\(\[switch\]\$Apply\)/)
  assert.match(s, /Set-MgUserLicense/)
  assert.match(s, /Get-MgSubscribedSku/)
  assert.match(s, /Remove = @\('MCOEV'\)/)
  assert.match(s, /'o''brien@x\.example'/, 'single quotes escaped for PowerShell')
  assert.match(s, /elseif \(-not \$Apply\) \{ \$status = 'dry run: ok' \}/)
  const rb = changeScript(a.recs, byId, { tenant: 'T', generated: '2026-11-08', rollback: true })
  assert.match(rb, /Add = @\('MCOEV'\); Remove = @\(\)/)
  const csv = changesCsv(a.recs, byId, () => 'approved')
  assert.equal(csv.trim().split('\n').length, 3)
  assert.match(csv, /MCOEV/)
})

// ---------- Real export layouts ----------
// Header rows copied from Microsoft's documentation (Graph reportRoot CSV examples and the admin center Active users export);
// the data rows are synthetic but follow the real value formats.

const parse = (csv: string) => parseText(csv, idx)

test('admin center Active users export: full column set, US dates with time, blocked sign-in and + separated licences', () => {
  const { detected, parsed } = parse(`Block credential,City,Country/Region,Department,DirSyncEnabled,Display name,Fax,First name,Last dirsync time,Last name,Last password change time stamp,License assignment details,Licenses,Mobile Phone,Oath token metadata,Object Id,Office,Password never expires,Phone number,Postal code,Preferred data location,Preferred language,Proxy addresses,Release track,Soft deletion time stamp,State,Street address,Strong password required,Title,Usage location,User principal name,When created
False,Seattle,United States,Finance,,Adele Vance,,Adele,,Vance,3/2/2026 4:11:07 PM,,Microsoft 365 E5+Microsoft Power Automate Free,,,6e7b768e-07e2-4810-8459-485f84f8f204,,False,,,,,SMTP:AdeleV@contoso.example,,,WA,,True,Retail Manager,US,AdeleV@contoso.example,8/12/2022 9:31:44 PM
True,Redmond,United States,Sales,,Alex Wilber,,Alex,,Wilber,1/9/2026 10:02:51 AM,,Microsoft 365 E3,,,87d349ed-44d7-43e1-9a83-5f2406dee5bd,,False,,,,,SMTP:AlexW@contoso.example,,,WA,,True,Marketing Assistant,US,AlexW@contoso.example,8/12/2022 9:31:45 PM
False,,,IT,,Diego Siciliani,,Diego,,Siciliani,,,Microsoft 365 Business Standard (no Teams)+Microsoft Copilot for Microsoft 365,,,1b2c3d4e-0000-4000-8000-000000000002,,False,,,,,,,,,,True,,US,DiegoS@contoso.example,1/5/2024 2:00:00 PM
`)
  assert.equal(detected.kind, 'users')
  assert.deepEqual(parsed.issues, [])
  const [adele, alex, diego] = parsed.rows
  assert.deepEqual(adele, { upn: 'adelev@contoso.example', name: 'Adele Vance', department: 'Finance', enabled: true, created: '2022-08-12', licenses: ['e5', 'flowfree'] })
  assert.equal(alex.enabled, false)
  assert.deepEqual(diego.licenses, ['bs-nt', 'copilot'], 'Copilot under its official display name')
})

test('usage reports skip rows for users already deleted from the tenant', () => {
  const { detected, parsed } = parse(`Report Refresh Date,User Principal Name,Display Name,Is Deleted,Deleted Date,Last Activity Date,Send Count,Receive Count,Read Count,Meeting Created Count,Meeting Interacted Count,Assigned Products,Report Period
2026-11-10,AdeleV@contoso.example,Adele Vance,False,,2026-11-09,4,212,190,0,3,MICROSOFT 365 E5+MICROSOFT POWER AUTOMATE FREE,30
2026-11-10,old.user@contoso.example,Old User,True,2026-10-20,2026-07-01,0,0,0,0,0,MICROSOFT 365 E3,30
`)
  assert.equal(detected.kind, 'email')
  assert.equal(parsed.rows.length, 1)
  assert.equal(parsed.deleted, 1)
  assert.deepEqual(parsed.rows[0], { upn: 'adelev@contoso.example', name: 'Adele Vance', licenses: ['e5', 'flowfree'], exchange: '2026-11-09', sends: 4 })
  assert.equal(parsed.refreshDate, '2026-11-10')
  assert.match(parsed.issues[0].message, /1 row is for users already deleted/)
  // A deleted user's old licences must not become a saving.
  const a = analyze(join([{ kind: 'email', rows: parsed.rows, refreshDate: parsed.refreshDate }], '2026-11-10'), cat)
  assert.ok(!a.users.some(v => v.user.upn === 'old.user@contoso.example'))
})

test('Microsoft 365 Apps report: Teams desktop alone is not desktop Office use', () => {
  const { detected, parsed } = parse(`Report Refresh Date,User Principal Name,Last Activation Date,Last Activity Date,Report Period,Windows,Mac,Mobile,Web,Outlook,Word,Excel,PowerPoint,OneNote,Teams,Outlook (Windows),Word (Windows),Excel (Windows),PowerPoint (Windows),OneNote (Windows),Teams (Windows),Outlook (Mac),Word (Mac),Excel (Mac),PowerPoint (Mac),OneNote (Mac),Teams (Mac),Outlook (Mobile),Word (Mobile),Excel (Mobile),PowerPoint (Mobile),OneNote (Mobile),Teams (Mobile),Outlook (Web),Word (Web),Excel (Web),PowerPoint (Web),OneNote (Web),Teams (Web)
2026-11-10,teamsonly@contoso.example,2026-05-22,2026-11-09,30,Yes,No,Yes,No,No,No,No,No,No,Yes,No,No,No,No,No,Yes,No,No,No,No,No,No,No,No,No,No,No,Yes,No,No,No,No,No,No
2026-11-10,word@contoso.example,2026-05-22,2026-11-09,30,Yes,No,No,No,Yes,Yes,No,No,No,No,Yes,Yes,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No
2026-11-10,mac@contoso.example,2026-05-22,2026-11-09,30,No,Yes,No,No,No,No,Yes,No,No,No,No,No,No,No,No,No,No,No,Yes,No,No,No,No,No,No,No,No,No,No,No,No,No,No,No
`)
  assert.equal(detected.kind, 'apps')
  assert.deepEqual(parsed.rows.map(r => [r.upn, r.desktop, r.apps]), [
    ['teamsonly@contoso.example', false, '2026-11-09'], ['word@contoso.example', true, '2026-11-09'], ['mac@contoso.example', true, '2026-11-09'],
  ])
  // Without the per-app columns it falls back to Windows/Mac.
  const short = parse('Report Refresh Date,User Principal Name,Last Activation Date,Last Activity Date,Windows,Mac\n2026-11-10,a@x.example,,2026-11-01,Yes,No\n')
  assert.equal(short.parsed.rows[0].desktop, true)
})

test('Teams user activity report: User Id before UPN, chat counts summed, calls kept', () => {
  const { detected, parsed } = parse(`Report Refresh Date,Tenant Display Name,Shared Channel Tenant Display Names,User Id,User Principal Name,Last Activity Date,Is Deleted,Deleted Date,Assigned Products,Team Chat Message Count,Private Chat Message Count,Call Count,Meeting Count,Post Messages,Reply Messages,Urgent Messages,Meetings Organized Count,Meetings Attended Count,Ad Hoc Meetings Organized Count,Ad Hoc Meetings Attended Count,Scheduled One-time Meetings Organized Count,Scheduled One-time Meetings Attended Count,Scheduled Recurring Meetings Organized Count,Scheduled Recurring Meetings Attended Count,Audio Duration,Video Duration,Screen Share Duration,Audio Duration In Seconds,Video Duration In Seconds,Screen Share Duration In Seconds,Has Other Action,Is Licensed,Report Period
2026-11-10,Contoso,,6e7b768e-07e2-4810-8459-485f84f8f204,AdeleV@contoso.example,2026-11-08,False,,MICROSOFT 365 E5,12,40,3,5,0,0,0,1,4,0,1,0,2,1,1,PT1H2M,PT10M,PT0S,3720,600,0,No,Yes,30
`)
  assert.equal(detected.kind, 'teams')
  assert.deepEqual(parsed.rows[0], { upn: 'adelev@contoso.example', licenses: ['e5'], teams: '2026-11-08', teamsMsgs: 52, calls: 3 })
})

test('Copilot usage report and Mailbox usage report map to the right workload', () => {
  const cp = parse(`Report Refresh Date,Report Period,User Principal Name,Display Name,Last Activity Date,Microsoft Teams Copilot Last Activity Date,Word Copilot Last Activity Date,Excel Copilot Last Activity Date,PowerPoint Copilot Last Activity Date,Outlook Copilot Last Activity Date,OneNote Copilot Last Activity Date,Loop Copilot Last Activity Date,Copilot Chat Last Activity Date
2026-11-10,30,DiegoS@contoso.example,Diego Siciliani,2026-09-01,,2026-09-01,,,,,,
`)
  assert.equal(cp.detected.kind, 'copilot')
  assert.deepEqual(cp.parsed.rows[0], { upn: 'diegos@contoso.example', name: 'Diego Siciliani', copilot: '2026-09-01' })
  const mb = parse(`Report Refresh Date,User Principal Name,Display Name,Is Deleted,Deleted Date,Created Date,Last Activity Date,Item Count,Storage Used (Byte),Issue Warning Quota (Byte),Prohibit Send Quota (Byte),Prohibit Send/Receive Quota (Byte),Deleted Item Count,Deleted Item Size (Byte),Deleted Item Quota (Byte),Has Archive,Report Period
2026-11-10,AdeleV@contoso.example,Adele Vance,False,,2022-08-12,2026-11-09,18234,4123456789,105226698752,106300440576,107374182400,120,8123456,32212254720,True,7
`)
  assert.equal(mb.detected.kind, 'mailbox')
  assert.deepEqual(mb.parsed.rows[0], { upn: 'adelev@contoso.example', name: 'Adele Vance', created: '2022-08-12', mailboxBytes: 4123456789, hasArchive: true, exchange: '2026-11-09' })
})

test('SKU part numbers match Microsoft\'s published licensing identifiers, including EEA and legacy variants', () => {
  const part = (id: string) => byId.get(id)!.part
  // From "Product names and service plan identifiers for licensing" (19 Aug 2026).
  assert.equal(part('bb-nt'), 'Microsoft_365_Business_Basic_(no Teams)')
  assert.equal(part('bs-nt'), 'MICROSOFT_365_BUSINESS_STANDARD_NO_TEAMS')
  assert.equal(part('bp-nt'), 'Microsoft_365_ Business_ Premium_(no Teams)')
  assert.equal(part('e5sec'), 'IDENTITY_THREAT_PROTECTION')
  for (const [n, id] of [['O365_w/o_Teams_Bundle_M5', 'e5-nt'], ['O365_w/o Teams Bundle_M3', 'e3-nt'], ['M365_Copilot', 'copilot'], ['SMB_BUSINESS_PREMIUM', 'bs'],
    ['Microsoft 365 Business Premium EEA (no Teams)', 'bp-nt'], ['Exchange Online Archiving for Exchange Online', 'eoa'], ['IDENTITY_THREAT_PROTECTION', 'e5sec']] as const)
    assert.equal(resolveSku(n, idx)?.id, id, n)
  // Purchased seats from Get-MgSubscribedSku resolve through the same names.
  assert.deepEqual(seatsFromSkus([{ part: 'M365_Copilot', purchased: 10, consumed: 8 }, { part: 'Microsoft_365_Copilot', purchased: 5, consumed: 5 }, { part: 'MICROSOFT_365_BUSINESS_STANDARD_NO_TEAMS', purchased: 3, consumed: 3 }], cat),
    { copilot: 15, 'bs-nt': 3 })
})

test('change script lists every published part number and resolves the first one the tenant has', () => {
  const a = run([user({ licenses: ['e3', 'copilot'], copilot: undefined })])
  const s = changeScript(a.recs, byId, { tenant: 'T', generated: '2026-11-08' })
  assert.match(s, /Remove = @\('Microsoft_365_Copilot\|M365_Copilot'\)/)
  assert.match(s, /foreach \(\$p in \$part -split '\\\|'\)/)
})
