import { CATALOG_DATE, CATALOG_SOURCE, IDS_SOURCE, DEFAULT_CATALOG } from './engine/catalog.ts'
import { DEFAULT_SETTINGS } from './engine/rules.ts'
import { GRAPH_EXPORT_SCRIPT } from './engine/script.ts'
import { Code, fmtDate, fmtUsd, Link } from './ui.tsx'

const SIGNINS_SCRIPT = `Connect-MgGraph -Scopes 'User.Read.All','AuditLog.Read.All' -NoWelcome
Get-MgUser -All -Property userPrincipalName,displayName,accountEnabled,createdDateTime,signInActivity |
  Select-Object UserPrincipalName, DisplayName, AccountEnabled, CreatedDateTime,
    @{n='LastSignInDateTime';e={$_.SignInActivity.LastSignInDateTime}},
    @{n='LastNonInteractiveSignInDateTime';e={$_.SignInActivity.LastNonInteractiveSignInDateTime}} |
  Export-Csv -NoTypeInformation -Path .\\entra-signins.csv`

const REPORTS: { name: string; where: string; cols: string; use: string }[] = [
  { name: 'Active users export', where: 'Users → Active users → Export users', cols: 'User principal name, Display name, Licenses (joined with +), Block credential, When created', use: 'Licences per user, blocked accounts, account age' },
  { name: 'Microsoft 365 active users', where: 'Reports → Usage → Microsoft 365 → Active users → Export', cols: 'User Principal Name, Exchange / OneDrive / SharePoint / Teams Last Activity Date, Assigned Products, Report Refresh Date', use: 'Last activity per workload' },
  { name: 'Email activity', where: 'Reports → Usage → Exchange → Email activity → Export', cols: 'User Principal Name, Last Activity Date, Send Count, Receive Count, Read Count', use: 'Light-user test for E5, Teams-only test' },
  { name: 'Mailbox usage', where: 'Reports → Usage → Exchange → Mailbox usage → Export', cols: 'User Principal Name, Storage Used (Byte), Prohibit Send Quota (Byte), Has Archive, Recipient Type', use: 'Shared and room mailboxes, quota check before downgrades' },
  { name: 'Teams user activity', where: 'Reports → Usage → Microsoft Teams → User activity → Export', cols: 'User Principal Name, Last Activity Date, Team Chat Message Count, Private Chat Message Count, Call Count', use: 'Teams-only users, calls before an E5 move' },
  { name: 'OneDrive / SharePoint activity', where: 'Reports → Usage → OneDrive (or SharePoint) → Activity → Export', cols: 'User Principal Name, Last Activity Date, Viewed Or Edited File Count', use: 'Activity, web app need' },
  { name: 'Microsoft 365 Apps usage', where: 'Reports → Usage → Microsoft 365 Apps → Usage → Export', cols: 'User Principal Name, Last Activation Date, Last Activity Date, Windows, Mac, Mobile, Web', use: 'Desktop Office use (Windows or Mac = Yes)' },
  { name: 'Copilot usage', where: 'Reports → Usage → Microsoft 365 Copilot → Usage → Export', cols: 'User Principal Name, Last Activity Date, per-app Copilot last activity dates', use: 'Idle Copilot seats' },
]

export default function Docs() {
  const key = DEFAULT_CATALOG.filter(k => ['bb', 'bs', 'bp', 'o365e1', 'o365e3', 'e3', 'e5', 'e3-nt', 'e5-nt', 'f1', 'f3', 'teams', 'copilot', 'exo1', 'exo2', 'entra1', 'pbipro', 'phone'].includes(k.id))
  const s = DEFAULT_SETTINGS
  return (
    <section className="page docs">
      <p className="eyebrow">Docs · last reviewed November 2026</p>
      <h1>Getting your data out of Microsoft 365</h1>
      <p className="lead measure">License Trim needs three things per user: which licences they hold, when they last signed in, and what they actually used. You can get them with one PowerShell script, or as separate exports from the admin center. Everything is parsed in your browser.</p>
      <nav className="toc" aria-label="On this page">
        <a href="#script">One CSV with PowerShell</a><a href="#admin">Admin center exports</a><a href="#concealed">Concealed user names</a><a href="#signins">Entra sign-ins</a><a href="#rules">How the rules work</a><a href="#prices">Price list</a><a href="#apply">Running the change script</a><a href="#privacy">Data and privacy</a>
      </nav>

      <h2 id="script">Fastest: one CSV with the Graph PowerShell SDK</h2>
      <p>Run this as an admin who can read reports (Global Reader plus Reports Reader is enough). It writes <code>license-trim-export.csv</code> (one row per user) and <code>license-trim-export-skus.csv</code> (purchased and consumed seats per SKU). Import both. <code>signInActivity</code> needs Microsoft Entra ID P1 or P2 in the tenant; Business Premium, E3 and E5 include it.</p>
      <Code code={GRAPH_EXPORT_SCRIPT} label="license-trim-export.ps1" />

      <h2 id="admin">Or: exports from the Microsoft 365 admin center</h2>
      <p>At <a href="https://admin.microsoft.com" target="_blank" rel="noreferrer">admin.microsoft.com</a>. For usage reports pick the 90 or 180 day period before exporting, and export the user detail table, not the chart. Usage data lags about two days; License Trim dates everything from the report refresh date, not today. Start with the Active users export; every extra report sharpens the recommendations, and the Data tab shows which evidence you still lack.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Report</th><th>Where</th><th>Columns used</th><th>Used for</th></tr></thead>
        <tbody>{REPORTS.map(r => <tr key={r.name}><td><strong>{r.name}</strong></td><td className="small">{r.where}</td><td className="small">{r.cols}</td><td className="small">{r.use}</td></tr>)}</tbody>
      </table></div>
      <p className="small muted">Microsoft renames and retires usage reports from time to time (the Skype for Business and Yammer columns are gone from most tenants, and some per-app reports have moved). Files are matched on column names, extra columns are ignored, and the import step lets you remap a column if a name changed.</p>

      <h2 id="concealed">Concealed user names</h2>
      <p>Since 2021 the admin center hides user names in usage reports by default, replacing each UPN with a 32-character hash. Those rows cannot be joined to users, so the importer flags them with line numbers. To turn it off: <strong>Settings → Org settings → Services → Reports</strong>, clear <em>Display concealed user, group, and site names in all reports</em>, save, wait a few minutes, and export again. Turn it back on afterwards if your privacy policy requires it. The Graph script is affected by the same setting.</p>

      <h2 id="signins">Entra sign-in activity</h2>
      <p>The Active users export does not include last sign-in. Get it from Microsoft Graph (the Entra admin center's user download does not reliably include it):</p>
      <Code code={SIGNINS_SCRIPT} label="entra-signins.ps1" />
      <p className="small muted"><code>lastSignInDateTime</code> is interactive sign-ins only; License Trim also uses <code>lastNonInteractiveSignInDateTime</code> (token refreshes from mobile mail and Teams clients) and takes the later of the two.</p>

      <h2 id="rules">How the rules work</h2>
      <ul className="rules">
        <li><strong>Shared, room and equipment mailboxes</strong> need no licence under 50 GB with no archive. Over 50 GB or with an archive they need Exchange Online (Plan 2), not a user plan. Room mailboxes keep Teams Rooms licences.</li>
        <li><strong>Blocked accounts</strong> holding paid licences: remove them. The mailbox is deleted 30 days later, so convert it to shared or put it on hold first if it must be kept.</li>
        <li><strong>Inactive</strong>: no sign-in and no activity in any workload for {s.inactiveDays} days (setting), skipping accounts created within that window. High confidence when both sign-in and usage data agree.</li>
        <li><strong>Duplicates</strong>: an add-on whose every feature is already in another assigned plan (E5 plus Teams Phone, Business Premium plus Entra ID P1), or two base plans.</li>
        <li><strong>Right-sizing</strong>: the cheapest plan in the same family that still covers what the person used. Desktop apps are only dropped when the Apps usage report says no Windows or Mac use. The target mailbox must fit current use plus 25%. F1/F3 targets carry a frontline eligibility caveat and can be switched off.</li>
        <li><strong>E5 to E3</strong>: at most {s.lightSends} emails sent and {s.lightMsgs} Teams messages in the period and no calls. A standalone add-on the user also bought (Power BI Pro) is kept. Switch off per tenant if security policy relies on E5 for everyone.</li>
        <li><strong>Copilot</strong>: no Copilot activity in {s.copilotDays} days, from the Copilot usage report only.</li>
        <li><strong>Confidence</strong>: high, medium or low on each finding; a recommendation takes the lowest of its findings.</li>
      </ul>

      <h2 id="prices">Price list</h2>
      <p>US list prices as of {fmtDate(CATALOG_DATE)}, per user per month. {CATALOG_SOURCE} Nonprofit, education, government and CSP prices differ: edit them per tenant under Data → Price list. Part numbers and product names were checked against Microsoft's <a href={IDS_SOURCE} target="_blank" rel="noreferrer">Product names and service plan identifiers for licensing</a> list (CSV dated 19 August 2026); where Microsoft publishes more than one part number for a product (EEA bundles, legacy SKUs) the change script tries each in turn.</p>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>SKU</th><th>Part number</th><th className="r">Price</th><th>Note</th></tr></thead>
        <tbody>{key.map(k => <tr key={k.id}><td>{k.name}</td><td className="mono small">{[k.part, ...(k.alt ?? [])].join(', ')}</td><td className="r num">{fmtUsd(k.price, 2)}</td><td className="small muted">{k.note ?? ''}</td></tr>)}</tbody>
      </table></div>

      <h2 id="apply">Running the change script</h2>
      <ol>
        <li>Approve recommendations, then download the change script, rollback script and planned-changes CSV from the Change script tab.</li>
        <li><code>Install-Module Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement -Scope CurrentUser</code></li>
        <li>Run the script with no switch: a dry run that checks each user still holds what will be removed and skips licences assigned by group (change those in the group instead). It writes a log CSV.</li>
        <li>Run it again with <code>-Apply</code>. SKU ids are looked up from your tenant by part number, so nothing is hard-coded.</li>
        <li>Next month, import fresh reports. History compares snapshots and counts the savings you realised.</li>
      </ol>

      <h2 id="privacy">Data and privacy</h2>
      <p>Files are parsed in your browser and stored in IndexedDB on this device. Nothing is uploaded unless you sign in to sync, which is optional: then tenants, prices, decisions and snapshots sync, and report data syncs only if under 1.5 MB. You can export everything as JSON or delete your cloud data and account from the account menu.</p>
      <p><Link href="/app" className="btn primary">Open the app</Link></p>
    </section>
  )
}
