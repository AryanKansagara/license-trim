// SKU catalogue: list prices, what each SKU includes, and the names it appears under in exports.

export type Feature =
  | 'mail' | 'desktop' | 'webapps' | 'teams' | 'files' | 'archive'
  | 'intune' | 'entraP1' | 'entraP2' | 'mdoP1' | 'mdoP2' | 'mdeP2' | 'purview'
  | 'phone' | 'audioconf' | 'pbiPro' | 'pbiPremium' | 'copilot' | 'teamsPremium' | 'visio' | 'project' | 'rooms'

export type Family = 'business' | 'enterprise' | 'frontline' | 'addon' | 'free'

export interface Sku {
  id: string
  name: string
  /** skuPartNumber as returned by Get-MgSubscribedSku. The change script resolves SKU ids from it at run time. */
  part: string
  family: Family
  /** USD per user per month, annual commitment, paid annually. */
  price: number
  /** True for a base plan (one per user); false for an add-on. */
  suite: boolean
  /** Primary mailbox quota in GB (0 = no mailbox). */
  mailboxGB: number
  features: Feature[]
  /** Other names the SKU appears under (admin center display names, usage-report "Assigned Products", older names). */
  aliases: string[]
  note?: string
}

/** Date the list prices were checked against Microsoft's published US prices. */
export const CATALOG_DATE = '2026-07-01'
export const CATALOG_SOURCE = 'Microsoft US list prices, annual commitment paid annually, including the price changes effective 1 July 2026. "No Teams" suite prices are derived from the published Teams price difference. Edit any price to match your agreement or CSP quote.'

const BASE: Feature[] = ['webapps', 'files']
const ESEC: Feature[] = ['intune', 'entraP1']
const E5X: Feature[] = ['entraP2', 'mdoP1', 'mdoP2', 'mdeP2', 'purview', 'phone', 'audioconf', 'pbiPro']
/** Features an E5 holds that an E3 does not. */
export const E5_EXTRAS: Feature[] = E5X

const s = (id: string, name: string, part: string, family: Family, price: number, mailboxGB: number, features: Feature[], aliases: string[] = [], note?: string): Sku =>
  ({ id, name, part, family, price, suite: family !== 'addon' && family !== 'free', mailboxGB, features: mailboxGB > 0 ? ['mail', ...features] : features, aliases, note })
const a = (id: string, name: string, part: string, price: number, features: Feature[], aliases: string[] = [], mailboxGB = 0, note?: string): Sku =>
  ({ ...s(id, name, part, 'addon', price, mailboxGB, features, aliases, note), suite: false })

export const DEFAULT_CATALOG: Sku[] = [
  s('bb', 'Microsoft 365 Business Basic', 'O365_BUSINESS_ESSENTIALS', 'business', 7, 50, [...BASE, 'teams'], ['Office 365 Business Essentials']),
  s('bs', 'Microsoft 365 Business Standard', 'O365_BUSINESS_PREMIUM', 'business', 14, 50, [...BASE, 'teams', 'desktop'], ['Office 365 Business Premium']),
  s('bp', 'Microsoft 365 Business Premium', 'SPB', 'business', 22, 50, [...BASE, 'teams', 'desktop', 'archive', 'intune', 'entraP1', 'mdoP1']),
  s('bb-nt', 'Microsoft 365 Business Basic (no Teams)', 'Microsoft_365_Business_Basic_(no_Teams)', 'business', 5.75, 50, BASE, [], 'Derived price'),
  s('bs-nt', 'Microsoft 365 Business Standard (no Teams)', 'Microsoft_365_Business_Standard_(no_Teams)', 'business', 11.75, 50, [...BASE, 'desktop'], [], 'Derived price'),
  s('bp-nt', 'Microsoft 365 Business Premium (no Teams)', 'Microsoft_365_Business_Premium_(no_Teams)', 'business', 19.75, 50, [...BASE, 'desktop', 'archive', 'intune', 'entraP1', 'mdoP1'], [], 'Derived price'),
  s('o365e1', 'Office 365 E1', 'STANDARDPACK', 'enterprise', 10, 50, [...BASE, 'teams']),
  s('o365e3', 'Office 365 E3', 'ENTERPRISEPACK', 'enterprise', 26, 100, [...BASE, 'teams', 'desktop', 'archive']),
  s('o365e1-nt', 'Office 365 E1 (no Teams)', 'Office_365_E1_(no_Teams)', 'enterprise', 7.75, 50, BASE),
  s('o365e3-nt', 'Office 365 E3 (no Teams)', 'Office_365_E3_(no_Teams)', 'enterprise', 23.75, 100, [...BASE, 'desktop', 'archive'], [], 'Derived price'),
  s('e3', 'Microsoft 365 E3', 'SPE_E3', 'enterprise', 39, 100, [...BASE, 'teams', 'desktop', 'archive', ...ESEC]),
  s('e5', 'Microsoft 365 E5', 'SPE_E5', 'enterprise', 60, 100, [...BASE, 'teams', 'desktop', 'archive', ...ESEC, ...E5X]),
  s('e3-nt', 'Microsoft 365 E3 (no Teams)', 'Microsoft_365_E3_(no_Teams)', 'enterprise', 36.75, 100, [...BASE, 'desktop', 'archive', ...ESEC], ['Microsoft 365 E3 EEA (no Teams)'], 'Derived price'),
  s('e5-nt', 'Microsoft 365 E5 (no Teams)', 'Microsoft_365_E5_(no_Teams)', 'enterprise', 57.75, 100, [...BASE, 'desktop', 'archive', ...ESEC, ...E5X], ['Microsoft 365 E5 EEA (no Teams)'], 'Derived price'),
  s('f1', 'Microsoft 365 F1', 'M365_F1_COMM', 'frontline', 3, 0, ['files', 'teams', ...ESEC], ['M365_F1'], 'Frontline use rights: no mailbox, no Office apps'),
  s('f3', 'Microsoft 365 F3', 'SPE_F1', 'frontline', 10, 2, [...BASE, 'teams', ...ESEC], [], 'Frontline use rights: 2 GB mailbox, web and mobile apps only'),
  a('teams', 'Microsoft Teams Enterprise', 'Microsoft_Teams_Enterprise_New', 5.25, ['teams'], ['Microsoft_Teams_EEA_New', 'Microsoft Teams EEA']),
  a('copilot', 'Microsoft 365 Copilot', 'Microsoft_365_Copilot', 30, ['copilot'], ['Copilot for Microsoft 365']),
  a('copilot-biz', 'Microsoft 365 Copilot Business', 'Microsoft_365_Copilot_Business', 21, ['copilot'], [], 0, 'For organisations under 300 seats'),
  a('apps-biz', 'Microsoft 365 Apps for business', 'O365_BUSINESS', 8.25, ['desktop', 'files']),
  a('apps-ent', 'Microsoft 365 Apps for enterprise', 'OFFICESUBSCRIPTION', 12, ['desktop', 'files']),
  a('exo1', 'Exchange Online (Plan 1)', 'EXCHANGESTANDARD', 4, [], [], 50),
  a('exo2', 'Exchange Online (Plan 2)', 'EXCHANGEENTERPRISE', 8, ['archive'], [], 100),
  a('exok', 'Exchange Online Kiosk', 'EXCHANGEDESKLESS', 2, [], [], 2),
  a('eoa', 'Exchange Online Archiving', 'EXCHANGEARCHIVE_ADDON', 3, ['archive']),
  a('entra1', 'Microsoft Entra ID P1', 'AAD_PREMIUM', 6, ['entraP1'], ['Azure Active Directory Premium P1']),
  a('entra2', 'Microsoft Entra ID P2', 'AAD_PREMIUM_P2', 9, ['entraP1', 'entraP2'], ['Azure Active Directory Premium P2']),
  a('mdo1', 'Microsoft Defender for Office 365 (Plan 1)', 'ATP_ENTERPRISE', 2, ['mdoP1']),
  a('mdo2', 'Microsoft Defender for Office 365 (Plan 2)', 'THREAT_INTELLIGENCE', 5, ['mdoP1', 'mdoP2']),
  a('intune', 'Microsoft Intune Plan 1', 'INTUNE_A', 8, ['intune']),
  a('e5sec', 'Microsoft 365 E5 Security', 'Microsoft_365_E5_Security', 12, ['entraP1', 'entraP2', 'mdoP1', 'mdoP2', 'mdeP2']),
  a('pbipro', 'Power BI Pro', 'POWER_BI_PRO', 14, ['pbiPro']),
  a('pbippu', 'Power BI Premium Per User', 'PBI_PREMIUM_PER_USER', 24, ['pbiPro', 'pbiPremium']),
  a('phone', 'Microsoft Teams Phone Standard', 'MCOEV', 10, ['phone'], ['Microsoft 365 Phone System']),
  a('audio', 'Microsoft Teams Audio Conferencing', 'MCOMEETADV', 0, ['audioconf'], ['Microsoft Teams Audio Conferencing with dial-out to USA/CAN']),
  a('teamsprem', 'Microsoft Teams Premium', 'Microsoft_Teams_Premium', 10, ['teamsPremium']),
  a('visio', 'Visio Plan 2', 'VISIOCLIENT', 15, ['visio']),
  a('project', 'Project Plan 3', 'PROJECTPROFESSIONAL', 30, ['project']),
  a('roomspro', 'Microsoft Teams Rooms Pro', 'Microsoft_Teams_Rooms_Pro', 40, ['rooms']),
  { ...a('roomsbasic', 'Microsoft Teams Rooms Basic', 'Microsoft_Teams_Rooms_Basic', 0, ['rooms']), family: 'free' },
  { ...a('flowfree', 'Microsoft Power Automate Free', 'FLOW_FREE', 0, []), family: 'free', aliases: ['Microsoft Flow Free'] },
  { ...a('fabricfree', 'Microsoft Fabric (Free)', 'POWER_BI_STANDARD', 0, []), family: 'free', aliases: ['Power BI (free)'] },
  { ...a('teamsexp', 'Microsoft Teams Exploratory', 'TEAMS_EXPLORATORY', 0, []), family: 'free' },
  { ...a('stream', 'Microsoft Stream', 'STREAM', 0, []), family: 'free' },
]

/** Lower-case and collapse punctuation so "MICROSOFT 365 E3", "Microsoft 365 E3" and "SPE_E3" can be looked up. */
export const normName = (n: string) => n.toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^\w ()]/g, '').trim()

export function skuIndex(cat: Sku[]): Map<string, Sku> {
  const m = new Map<string, Sku>()
  for (const k of cat) for (const n of [k.name, k.part, ...k.aliases]) m.set(normName(n), k)
  return m
}

/** Resolve a licence name as it appears in an export; null when it is not in the catalogue. */
export function resolveSku(name: string, idx: Map<string, Sku>): Sku | null {
  return idx.get(normName(name)) ?? null
}

/** Merge per-project price edits and custom SKUs into the default catalogue. */
export function effectiveCatalog(overrides: Record<string, number> = {}, custom: Sku[] = []): Sku[] {
  return [...DEFAULT_CATALOG, ...custom].map(k => k.id in overrides ? { ...k, price: overrides[k.id] } : k)
}

export const priceOf = (ids: string[], byId: Map<string, Sku>) => ids.reduce((t, id) => t + (byId.get(id)?.price ?? 0), 0)
