// Generated artifacts: the Microsoft Graph PowerShell change script, its rollback, and a CSV of planned changes.
import type { Sku } from './catalog.ts'
import { toCsv } from './parse.ts'
import { REASON_LABEL, type Rec } from './rules.ts'

const psq = (s: string) => `'${s.replace(/'/g, "''")}'`
const psArr = (xs: string[]) => `@(${xs.map(psq).join(', ')})`

export interface ScriptOpts { tenant: string; generated: string; rollback?: boolean }

/**
 * A Set-MgUserLicense script. Dry run by default: it checks each user exists and holds the licences to remove, and changes
 * nothing. Run with -Apply to make the changes. SKU ids are resolved from skuPartNumber in the tenant, so nothing is hard-coded.
 */
export function changeScript(recs: Rec[], byId: Map<string, Sku>, o: ScriptOpts): string {
  const part = (id: string) => byId.get(id)?.part ?? id
  const monthly = recs.reduce((t, r) => t + r.monthly, 0)
  const rows = recs.map(r => {
    const add = o.rollback ? r.remove : r.add
    const remove = o.rollback ? r.add : r.remove
    const note = o.rollback ? 'rollback' : r.findings.map(f => REASON_LABEL[f.reason]).join('; ')
    return `  @{ Upn = ${psq(r.upn)}; Add = ${psArr(add.map(part))}; Remove = ${psArr(remove.map(part))}; Note = ${psq(note)} }`
  })
  return `<#
  License Trim ${o.rollback ? 'ROLLBACK' : 'change'} script
  Tenant:    ${o.tenant}
  Generated: ${o.generated}
  Changes:   ${recs.length} user${recs.length === 1 ? '' : 's'}${o.rollback ? ' (restores the licences the change script removed)' : `, $${monthly.toFixed(2)} per month at list price`}

  Dry run (default):  .\\${o.rollback ? 'license-trim-rollback' : 'license-trim-changes'}.ps1
  Apply the changes:  .\\${o.rollback ? 'license-trim-rollback' : 'license-trim-changes'}.ps1 -Apply

  Requires the Microsoft Graph PowerShell SDK:  Install-Module Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement -Scope CurrentUser
  Needs a role that can assign licences (License Administrator or User Administrator).
  Licences assigned through a group cannot be removed per user; those rows report "assigned by group" and are skipped.
  Removing a user's Exchange licence deletes their mailbox after 30 days unless it is converted or on hold.
#>
param([switch]$Apply)
$ErrorActionPreference = 'Stop'

Connect-MgGraph -Scopes 'User.ReadWrite.All', 'Organization.Read.All' -NoWelcome

# skuPartNumber -> SkuId for this tenant
$skus = @{}
Get-MgSubscribedSku -All | ForEach-Object { $skus[$_.SkuPartNumber] = $_.SkuId }
function Resolve-Sku([string]$part) {
  if (-not $skus.ContainsKey($part)) { throw "SKU $part is not subscribed in this tenant" }
  return $skus[$part]
}

$changes = @(
${rows.join(',\n')}
)

$log = foreach ($c in $changes) {
  $status = ''
  try {
    $user = Get-MgUser -UserId $c.Upn -Property id,userPrincipalName,licenseAssignmentStates
    $held = @($user.LicenseAssignmentStates | ForEach-Object { $_.SkuId })
    $byGroup = @($user.LicenseAssignmentStates | Where-Object { $_.AssignedByGroup } | ForEach-Object { $_.SkuId })
    $removeIds = @($c.Remove | ForEach-Object { Resolve-Sku $_ })
    $addIds = @($c.Add | ForEach-Object { Resolve-Sku $_ })
    $missing = @($removeIds | Where-Object { $held -notcontains $_ })
    $grouped = @($removeIds | Where-Object { $byGroup -contains $_ })
    if ($grouped.Count) { $status = 'skipped: assigned by group' }
    elseif ($missing.Count) { $status = 'skipped: user no longer holds a licence to remove' }
    elseif (-not $Apply) { $status = 'dry run: ok' }
    else {
      Set-MgUserLicense -UserId $user.Id -AddLicenses @($addIds | ForEach-Object { @{ SkuId = $_ } }) -RemoveLicenses $removeIds | Out-Null
      $status = 'applied'
    }
  } catch { $status = "failed: $($_.Exception.Message)" }
  Write-Host ('{0,-45} -[{1}] +[{2}] {3}' -f $c.Upn, ($c.Remove -join ','), ($c.Add -join ','), $status)
  [pscustomobject]@{ Upn = $c.Upn; Removed = ($c.Remove -join ';'); Added = ($c.Add -join ';'); Note = $c.Note; Status = $status }
}

$out = ".\\license-trim-${o.rollback ? 'rollback' : 'changes'}-$(Get-Date -Format yyyyMMdd-HHmm)$(if (-not $Apply) { '-dryrun' }).csv"
$log | Export-Csv -NoTypeInformation -Path $out
Write-Host "Log written to $out"
`
}

export function changesCsv(recs: Rec[], byId: Map<string, Sku>, status: (r: Rec) => string): string {
  const names = (ids: string[]) => ids.map(id => byId.get(id)?.name ?? id).join('; ')
  const parts = (ids: string[]) => ids.map(id => byId.get(id)?.part ?? id).join(';')
  return toCsv([
    ['UserPrincipalName', 'DisplayName', 'CurrentLicences', 'RemoveSkuPartNumbers', 'AddSkuPartNumbers', 'TargetLicences', 'MonthlySaving', 'AnnualSaving', 'Confidence', 'Reasons', 'Caveats', 'Decision'],
    ...recs.map(r => [r.upn, r.name, names(r.from), parts(r.remove), parts(r.add), names(r.to) || '(none)', r.monthly.toFixed(2), r.annual.toFixed(2), r.confidence, r.findings.map(f => f.text).join(' '), r.caveats.join(' '), status(r)]),
  ])
}

/** The one-CSV export the admin runs; the docs page shows it and the importer recognises its output. */
export const GRAPH_EXPORT_SCRIPT = `<#
  License Trim export: one CSV per tenant with licences, sign-in activity and workload usage.
  Requires: Install-Module Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Identity.DirectoryManagement -Scope CurrentUser
  Permissions (delegated, consented once): User.Read.All, AuditLog.Read.All, Reports.Read.All, Organization.Read.All
  signInActivity needs Microsoft Entra ID P1 or P2 in the tenant (included in Business Premium, E3, E5).
  Turn off concealed names first: admin center > Settings > Org settings > Services > Reports.
#>
param([ValidateSet('D7','D30','D90','D180')][string]$Period = 'D90', [string]$Out = '.\\license-trim-export.csv')
$ErrorActionPreference = 'Stop'
Connect-MgGraph -Scopes 'User.Read.All','AuditLog.Read.All','Reports.Read.All','Organization.Read.All' -NoWelcome

$tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "lt-$(Get-Random)")
function Get-Report($name, $period) {
  $file = Join-Path $tmp "$name.csv"
  Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/reports/$name(period='$period')" -OutputFilePath $file
  $rows = @{}
  Import-Csv $file | ForEach-Object { $rows[$_.'User Principal Name'.ToLower()] = $_ }
  return $rows
}

$skuName = @{}
Get-MgSubscribedSku -All | ForEach-Object { $skuName[$_.SkuId] = $_.SkuPartNumber }
Get-MgSubscribedSku -All | Select-Object SkuPartNumber, ConsumedUnits, @{n='PrepaidUnits';e={$_.PrepaidUnits.Enabled}} |
  Export-Csv -NoTypeInformation -Path ($Out -replace '\\.csv$', '-skus.csv')

$active  = Get-Report 'getOffice365ActiveUserDetail' $Period
$email   = Get-Report 'getEmailActivityUserDetail' $Period
$mailbox = Get-Report 'getMailboxUsageDetail' 'D7'
$teams   = Get-Report 'getTeamsUserActivityUserDetail' $Period
$apps    = Get-Report 'getM365AppUserDetail' $Period

$users = Get-MgUser -All -Property id,userPrincipalName,displayName,department,accountEnabled,createdDateTime,assignedLicenses,signInActivity,userType |
  Where-Object { $_.UserType -ne 'Guest' }

$users | ForEach-Object {
  $u = $_.UserPrincipalName.ToLower()
  $a = $active[$u]; $e = $email[$u]; $m = $mailbox[$u]; $t = $teams[$u]; $p = $apps[$u]
  [pscustomobject]@{
    UserPrincipalName       = $_.UserPrincipalName
    DisplayName             = $_.DisplayName
    Department              = $_.Department
    AccountEnabled          = $_.AccountEnabled
    CreatedDateTime         = $_.CreatedDateTime
    LastSignInDateTime      = $_.SignInActivity.LastSignInDateTime
    LastNonInteractiveSignInDateTime = $_.SignInActivity.LastNonInteractiveSignInDateTime
    Licenses                = ($_.AssignedLicenses | ForEach-Object { $skuName[$_.SkuId] }) -join ';'
    RecipientType           = $m.'Recipient Type'
    MailboxUsedBytes        = $m.'Storage Used (Byte)'
    HasArchive              = $m.'Has Archive'
    ExchangeLastActivity    = $a.'Exchange Last Activity Date'
    OneDriveLastActivity    = $a.'OneDrive Last Activity Date'
    SharePointLastActivity  = $a.'SharePoint Last Activity Date'
    TeamsLastActivity       = $a.'Teams Last Activity Date'
    AppsLastActivity        = $p.'Last Activity Date'
    DesktopApps             = if ($p) { if ($p.Windows -eq 'Yes' -or $p.Mac -eq 'Yes') { 'Yes' } else { 'No' } } else { '' }
    EmailSends              = $e.'Send Count'
    TeamsMessages           = if ($t) { [int]$t.'Team Chat Message Count' + [int]$t.'Private Chat Message Count' } else { '' }
    TeamsCalls              = $t.'Call Count'
    ReportRefreshDate       = $a.'Report Refresh Date'
  }
} | Export-Csv -NoTypeInformation -Path $Out

Remove-Item $tmp -Recurse -Force
Write-Host "Wrote $Out and $($Out -replace '\\.csv$', '-skus.csv')"
`
