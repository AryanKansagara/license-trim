// The generated PowerShell scripts and CSV are built from imported data, and the admin runs the script with licence rights.
// Nothing here ever EXECUTES a generated script. Two layers check it:
//  1. Strict structural tests in TypeScript (always run): the rows are decoded by a small parser that accepts only the literal
//     forms the generator emits, and everything outside the data is compared byte for byte with the same script built from
//     ordinary names.
//  2. A PowerShell parser check (pwsh, Parser::ParseFile, parse only: see ps-structure.ps1). It runs when pwsh is installed,
//     and must run in CI (the GitHub ubuntu runners ship pwsh), where a missing pwsh fails the test instead of skipping it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_CATALOG, skuIndex } from './catalog.ts'
import { parseCsv, parseText, toCsv, type UserRec } from './parse.ts'
import { analyze, DEFAULT_SETTINGS, join as joinSources, REASON_LABEL, type Rec } from './rules.ts'
import { changesCsv, changeScript, GRAPH_EXPORT_SCRIPT, GRAPH_SIGNINS_SCRIPT } from './script.ts'

const cat = DEFAULT_CATALOG
const byId = new Map(cat.map(k => [k.id, k]))
const AS_OF = '2026-10-31'

/** A blocked user who still holds an E3 (so there is a change), with the given account and display names. */
const leaver = (upn: string, name = 'Leaver'): UserRec => ({ upn, name, enabled: false, created: '2022-01-01', recipientType: 'user', licenses: ['e3'], lastSignIn: '2026-01-01' })
const recsOf = (users: UserRec[]): Rec[] => analyze(joinSources([{ kind: 'users', rows: users, refreshDate: AS_OF, covers: ['signins'] }], AS_OF), cat, DEFAULT_SETTINGS).recs

// Names an imported file could hold. Harmless markers only: nothing here is a real command or account.
const HOSTILE_UPNS = [
  "o'brien@x.example", // ASCII apostrophe
  'anne\u2019s@x.example', '\u2018lead@x.example', 'low\u201a@x.example', 'rev\u201b@x.example', // U+2018 U+2019 U+201A U+201B
  'q\u2019; Write-Host INJECTED-MARKER; \u2018@x.example', "q'; Write-Host INJECTED-MARKER; '@x.example",
  'new\nline@x.example', 'cr\r\nlf@x.example', 'tab\there@x.example', 'nul\u0000@x.example', 'sep\u2028para\u2029@x.example', 'nel\u0085@x.example',
  'bidi\u202ereversed@x.example', 'zero\u200bwidth\ufeff@x.example', 'tag\u{e0001}\u{e0041}@x.example', // invisible formatting characters
  '\u0451\u00d1\u00f1@x.example', 'emoji\u{1f600}@x.example', 'lone\ud800surrogate@x.example', // non-ASCII letters, an astral char, a lone surrogate
  '$(Write-Host SUBEXPR-MARKER)@x.example', 'back`tick@x.example', 'dq"@x.example', 'comment#>@x.example', 'open<#@x.example', 'back\\slash|pipe@x.example',
  "'", "''", '\u2019', '\n', '#>',
]
const HOSTILE_TENANTS = ['Contoso #> Write-Host TENANT-MARKER <#', 'A\nB #>\nWrite-Host X', '#\u200b>', '##>>', 'Name\u202e#>', 'M\u00fcller & S\u00f6hne', "O'Brien \u2019 Ltd", '#']

// ---------- TypeScript-side structural checks ----------

/** Decodes the expressions the generator emits for a string: 'text' with '' doubling, or ('' + 'text' + [char]N + [char]::ConvertFromUtf32(N)). */
function decodeExpr(src: string): string {
  let i = 0
  const lit = () => {
    assert.equal(src[i], "'", `literal expected at ${i} in ${src}`)
    i++
    let out = ''
    for (;;) {
      assert.ok(i < src.length, `unterminated literal in ${src}`)
      if (src[i] === "'") { if (src[i + 1] === "'") { out += "'"; i += 2; continue } i++; return out }
      out += src[i++]
    }
  }
  const num = () => { const m = /^\d+/.exec(src.slice(i)); assert.ok(m, `number expected at ${i} in ${src}`); i += m[0].length; return Number(m[0]) }
  const term = (): string => {
    if (src[i] === "'") return lit()
    if (src.startsWith('[char]::ConvertFromUtf32(', i)) { i += '[char]::ConvertFromUtf32('.length; const n = num(); assert.equal(src[i++], ')'); return String.fromCodePoint(n) }
    if (src.startsWith('[char]', i)) { i += '[char]'.length; return String.fromCharCode(num()) }
    return assert.fail(`unexpected token at ${i} in ${src}`)
  }
  let v: string
  if (src[i] === '(') {
    i++
    v = lit()
    assert.equal(v, '', 'a composed value starts with the empty string')
    while (src.startsWith(' + ', i)) { i += 3; v += term() }
    assert.equal(src[i++], ')')
  } else v = lit()
  assert.equal(i, src.length, `trailing text after expression: ${src.slice(i)}`)
  return v
}

/** Splits `a, b, c` at top-level commas, outside quotes and parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0, q = false, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { cur += c; if (c === "'") { if (s[i + 1] === "'") cur += s[++i]; else q = false } continue }
    if (c === "'") q = true
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

interface Row { Upn: string; Add: string[]; Remove: string[]; Note: string }
function decodeRow(line: string): Row {
  const m = /^ {2}@\{ Upn = (.*); Add = @\((.*)\); Remove = @\((.*)\); Note = (.*) \},?$/.exec(line)
  assert.ok(m, `row does not have the expected shape: ${line}`)
  return { Upn: decodeExpr(m[1]), Add: splitTop(m[2]).map(decodeExpr), Remove: splitTop(m[3]).map(decodeExpr), Note: decodeExpr(m[4]) }
}

const HEADER_END = '\n#>\nparam('
const ROWS = /\$changes = @\(\n([\s\S]*?)\n\)\n\n/
const header = (s: string) => s.slice(0, s.indexOf(HEADER_END) + '\n#>'.length)
const rowLines = (s: string) => ROWS.exec(s)![1].split(',\n')
/** The script with the comment header and the data rows cut out: this must not depend on any imported text. */
const skeleton = (s: string) => s.slice(s.indexOf(HEADER_END)).replace(ROWS, '$changes = @(\n<rows>\n)\n\n')

const script = (recs: Rec[], tenant = 'T', rollback = false, file = 'x.ps1') => changeScript(recs, byId, { tenant, generated: '2026-11-08', rollback, file })
const expectedRows = (recs: Rec[], rollback: boolean): Row[] => recs.map(r => ({
  Upn: r.upn,
  Add: (rollback ? r.remove : r.add).map(id => byId.get(id)!.part),
  Remove: (rollback ? r.add : r.remove).map(id => byId.get(id)!.part),
  Note: rollback ? 'rollback' : r.findings.map(f => REASON_LABEL[f.reason]).join('; '),
}))

test('script rows: every hostile or unusual account name decodes back to exactly the original, in the change and the rollback', () => {
  const recs = recsOf(HOSTILE_UPNS.map(u => leaver(u)))
  assert.equal(recs.length, HOSTILE_UPNS.length)
  for (const rollback of [false, true]) {
    const s = script(recs, 'T', rollback)
    const lines = rowLines(s)
    assert.equal(lines.length, recs.length, 'one row per user: nothing in a name can add or split a row')
    lines.forEach((line, n) => {
      assert.match(line, /^[\x20-\x7e]*$/, `row ${n} holds only printable ASCII`)
      const row = decodeRow(line)
      assert.equal(row.Upn, recs[n].upn, `row ${n}`)
      assert.deepEqual(row.Add, expectedRows([recs[n]], rollback)[0].Add)
      assert.deepEqual(row.Remove, expectedRows([recs[n]], rollback)[0].Remove)
      if (rollback) assert.equal(row.Note, 'rollback')
    })
  }
})

test('script rows: single-quote look-alikes are never left raw (U+2018 U+2019 U+201A U+201B, and the ASCII quote is doubled)', () => {
  const recs = recsOf(["o'brien@x.example", 'a\u2018b\u2019c\u201ad\u201be@x.example'].map(u => leaver(u)))
  const s = script(recs)
  assert.match(s, /Upn = 'o''brien@x\.example'/)
  assert.doesNotMatch(rowLines(s).join('\n'), /[\u2018\u2019\u201a\u201b]/)
  assert.match(s, /\[char\]8216 \+ 'b' \+ \[char\]8217 \+ 'c' \+ \[char\]8218 \+ 'd' \+ \[char\]8219 \+ 'e@x\.example'/)
})

test('script structure is the same for hostile and ordinary names: only the rows and the comment text differ', () => {
  const plain = recsOf([leaver('a@x.example'), leaver('b@x.example')])
  const hostile = recsOf([leaver(HOSTILE_UPNS[6], HOSTILE_UPNS[1]), leaver(HOSTILE_UPNS[8], '=cmd|calc')])
  for (const rollback of [false, true]) {
    for (const tenant of HOSTILE_TENANTS) {
      const a = script(plain, 'Ordinary', rollback, 'ordinary-changes.ps1'), b = script(hostile, tenant, rollback, `${tenant.replace(/\W+/g, '-')}.ps1`)
      assert.equal(skeleton(b), skeleton(a), `tenant ${JSON.stringify(tenant)}`)
      assert.equal(rowLines(b).length, rowLines(a).length)
    }
  }
})

test('comment header: no name can end the comment, add a line, or hide text', () => {
  const recs = recsOf([leaver('a@x.example')])
  for (const rollback of [false, true]) {
    const base = header(script(recs, 'Ordinary', rollback, 'ordinary.ps1')).split('\n')
    for (const tenant of HOSTILE_TENANTS) for (const file of ['x.ps1', ...HOSTILE_TENANTS]) {
      const h = header(changeScript(recs, byId, { tenant, generated: tenant, rollback, file }))
      assert.equal(h.split('\n').length, base.length, `same number of lines for ${JSON.stringify(tenant)} / ${JSON.stringify(file)}`)
      assert.equal(h.indexOf('#>'), h.length - 2, 'the only #> is the real terminator')
      assert.equal(h.indexOf('<#'), 0)
      assert.doesNotMatch(h, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/, 'no control, bidi or zero-width characters')
    }
  }
  const h = header(script(recs, HOSTILE_TENANTS[0]))
  assert.match(h, /Tenant: {4}Contoso # > Write-Host TENANT-MARKER <#\n/, 'the text stays readable')
  assert.match(header(script(recs, 'M\u00fcller & S\u00f6hne')), /Tenant: {4}M\u00fcller & S\u00f6hne\n/, 'ordinary non-ASCII names are untouched in the comment')
})

test('the log CSV the script writes marks a formula-like account name as text', () => {
  const s = script(recsOf([leaver('a@x.example')]))
  assert.match(s, /function Protect-Cell\(\$v\) \{ if \("\$v" -match '\^\[=\+\\-@\\t\\r\]'\) \{ "'\$v" \} else \{ \$v \} \}/)
  assert.match(s, /\[pscustomobject\]@\{ Upn = \(Protect-Cell \$c\.Upn\);/)
  assert.ok(s.indexOf('function Protect-Cell') < s.indexOf('$log = foreach'), 'defined before it is used')
})

test('existing behaviour: ordinary names keep a plain single-quoted literal', () => {
  const recs = recsOf([leaver('plain.user@x.example')])
  assert.match(script(recs), /@\{ Upn = 'plain\.user@x\.example'; Add = @\(\); Remove = @\('SPE_E3'\); Note = 'Disabled but licensed' \}/)
})

// ---------- PowerShell parser check (parse only) ----------

const HELPER = fileURLToPath(new URL('./ps-structure.ps1', import.meta.url))
const probe = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', POWERSHELL_TELEMETRY_OPTOUT: '1' } })
const HAVE_PWSH = probe.status === 0
const REQUIRE_PWSH = !!process.env.CI || process.env.REQUIRE_PWSH === '1'
const pwshTest = (name: string, fn: () => void) => test(name, { skip: !HAVE_PWSH && !REQUIRE_PWSH ? 'pwsh is not installed here (CI requires it)' : false }, () => {
  assert.ok(HAVE_PWSH, 'pwsh must be installed in CI so the generated scripts are parsed by PowerShell itself')
  fn()
})

interface Structure { parseErrors: string[]; comments: number; topLevel: string[]; hasParam: boolean; commands: string[]; changesAssign: number; rows: Row[]; rowsError: string | null }
/** Parses (never runs) a script with the PowerShell parser. */
function parseWithPwsh(text: string): Structure {
  const dir = mkdtempSync(join(tmpdir(), 'lt-ps-'))
  try {
    const file = join(dir, 'generated.ps1')
    writeFileSync(file, text, 'utf8')
    const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', HELPER, '-Path', file], { encoding: 'utf8', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', POWERSHELL_TELEMETRY_OPTOUT: '1' } })
    assert.equal(r.status, 0, `pwsh helper failed: ${r.stderr}${r.stdout}`)
    return JSON.parse(r.stdout)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

pwshTest('PowerShell parser: hostile and ordinary names give the same structure and the exact original values, change and rollback', () => {
  const plain = recsOf([leaver('a@x.example')])
  const reference = (rollback: boolean) => parseWithPwsh(script(plain, 'Ordinary', rollback, 'ordinary.ps1'))
  const hostileUsers = HOSTILE_UPNS.filter(u => !/[\ud800-\udfff]/.test(u.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))) // JSON output cannot carry a lone surrogate; the TS test above covers it
  const recs = recsOf(hostileUsers.map(u => leaver(u)))
  for (const rollback of [false, true]) {
    const ref = reference(rollback)
    assert.deepEqual(ref.parseErrors, [])
    assert.equal(ref.hasParam, true)
    assert.equal(ref.changesAssign, 1)
    for (const tenant of HOSTILE_TENANTS) {
      const got = parseWithPwsh(script(recs, tenant, rollback, 'hostile.ps1'))
      assert.deepEqual(got.parseErrors, [], `tenant ${JSON.stringify(tenant)}`)
      assert.equal(got.rowsError, null)
      assert.equal(got.comments, ref.comments, 'the header is still the only block comment')
      assert.deepEqual(got.topLevel, ref.topLevel)
      assert.deepEqual(got.commands, ref.commands, 'no command appears that the ordinary script does not have')
      assert.equal(got.hasParam, true)
      assert.equal(got.changesAssign, 1)
      assert.deepEqual(got.rows, expectedRows(recs, rollback), `rows decode to the original names (${rollback ? 'rollback' : 'change'})`)
    }
  }
})

pwshTest('PowerShell parser: the real change script for a name with an apostrophe parses and keeps o\'brien exactly', () => {
  const recs = recsOf([leaver("o'brien@x.example"), leaver('anne\u2019s@x.example')])
  const got = parseWithPwsh(script(recs))
  assert.deepEqual(got.parseErrors, [])
  assert.deepEqual(got.rows.map(r => r.Upn), recs.map(r => r.upn))
  assert.ok(got.rows.some(r => r.Upn === "o'brien@x.example") && got.rows.some(r => r.Upn === 'anne\u2019s@x.example'))
})

pwshTest('PowerShell parser: the static scripts shown in the docs parse without errors', () => {
  for (const [name, text] of [['export', GRAPH_EXPORT_SCRIPT], ['signins', GRAPH_SIGNINS_SCRIPT]] as const) {
    assert.deepEqual(parseWithPwsh(text).parseErrors, [], name)
  }
})

pwshTest('PowerShell parser: an unprotected hostile script is detected (the check can fail)', () => {
  // The same hostile tenant name and a curly-quote account name, built the way the old generator did it.
  const old = "<#\n  Tenant: X #> Write-Host MARKER <#\n#>\nparam([switch]$Apply)\n$changes = @(\n  @{ Upn = 'q\u2019; Write-Host MARKER; \u2018@x.example'; Add = @(); Remove = @('SPE_E3'); Note = 'n' }\n)\n"
  assert.notDeepEqual(parseWithPwsh(old).parseErrors, [])
})

// ---------- CSV ----------

test('planned-changes CSV: text cells that start like a formula are marked as text; numbers are untouched', () => {
  const upns = ['=cmd|marker@x.example', '+plus@x.example', '-minus@x.example', '@at@x.example', '\tTab@x.example', '\rCr@x.example', "'=quoted@x.example", 'plain@x.example']
  const names = ['=1+1 MARKER', '+1', '-1', '@SUM(1)', '\t=x', '\r=x', "'-x", 'Plain Name']
  const recs = recsOf(upns.map((u, i) => leaver(u, names[i])))
  const csv = changesCsv(recs, byId, () => '=approved')
  const rows = parseCsv(csv)
  assert.equal(rows.length, recs.length + 1)
  recs.forEach((r, i) => {
    const row = rows[i + 1]
    assert.equal(row[0], r.upn, 'the account name imports back exactly')
    assert.equal(row[1], r.name, 'the display name imports back exactly')
    assert.equal(row[11], '=approved', 'the decision imports back exactly')
  })
  // On the wire, every risky text cell is prefixed so a spreadsheet shows text instead of running it.
  const cells = csv.split('\n').slice(1, -1).map(l => l.split(','))
  assert.ok(cells.some(c => c[0] === "'=cmd|marker@x.example"))
  assert.ok(cells.some(c => c[0] === "''=quoted@x.example"), 'a value that already starts with a quote stays distinguishable')
  assert.ok(cells.every(c => !/^[=+\-@\t\r]/.test(c[0])), 'no first cell starts with a formula character')
  assert.match(csv, /,'=approved\n/)
  // Savings are numbers and stay plain, even when a change would cost money (negative).
  const withCost = { ...recs[0], monthly: -5, annual: -60 }
  assert.match(changesCsv([withCost], byId, () => 'pending').split('\n')[1], /,-5\.00,-60\.00,/)
})

test('planned-changes CSV: ordinary files are byte-for-byte what they were, and still import', () => {
  const recs = recsOf([leaver('a@x.example', 'Alice A'), leaver("o'brien@x.example", "Pat O'Brien")])
  const csv = changesCsv(recs, byId, () => 'approved')
  const old = toCsv([
    ['UserPrincipalName', 'DisplayName', 'CurrentLicences', 'RemoveSkuPartNumbers', 'AddSkuPartNumbers', 'TargetLicences', 'MonthlySaving', 'AnnualSaving', 'Confidence', 'Reasons', 'Caveats', 'Decision'],
    ...recs.map(r => [r.upn, r.name, r.from.map(id => byId.get(id)!.name).join('; '), r.remove.map(id => byId.get(id)!.part).join(';'), r.add.map(id => byId.get(id)!.part).join(';'), '(none)', r.monthly.toFixed(2), r.annual.toFixed(2), r.confidence, r.findings.map(f => f.text).join(' '), r.caveats.join(' '), 'approved']),
  ])
  assert.equal(csv, old)
  const { detected, parsed } = parseText(csv, skuIndex(cat))
  assert.equal(detected.kind, 'users')
  assert.deepEqual(parsed.rows.map(r => r.upn), recs.map(r => r.upn))
})

test('CSV round trip: a hostile value written with toCsv and csvText comes back exactly, including line breaks and quotes', () => {
  const values = ['=1+1', '+1', '-1', '@x', "'=x", "''-x", 'a,b', 'say "hi"', 'two\nlines', 'cr\rin', '=a,b\n"c"', 'ordinary', "it's", '-', '=', '']
  const csv = changesCsv(recsOf(values.filter(Boolean).map((v, i) => leaver(`${i}@x.example`, v))), byId, () => 'ok')
  const back = new Map(parseCsv(csv).slice(1).map(r => [r[0], r[1]]))
  values.filter(Boolean).forEach((v, i) => assert.equal(back.get(`${i}@x.example`), v, JSON.stringify(v)))
})
