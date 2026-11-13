# License Trim

Microsoft 365 licence optimisation for IT admins and MSPs.

Live: https://license-trim.vercel.app

## The pain

Microsoft 365 is billed per seat, and seats drift: leavers are blocked but stay licensed, shared mailboxes hold E3s, E5s sit on people who send a few emails a week, Copilot seats go unused, and the renewal gets signed for last year's head count. The admin center has the data, split across an Active users export, a handful of usage reports and the Entra sign-in log, with no join and no prices.

## What it does

- **Import** the Active users export, the usage reports (Active users, Email activity, Mailbox usage, Teams, OneDrive, SharePoint, Microsoft 365 Apps, Copilot), Entra sign-ins, or one CSV from the Graph PowerShell script in `/docs`. Format detection, column mapping and a validation report with line numbers, including concealed user names.
- **Engine** (plain TypeScript, tested): joins everything per user and finds inactive accounts, blocked-but-licensed accounts, licensed shared and room mailboxes, duplicate licences, Teams-only users, unused desktop apps, E5 on light users and idle Copilot. Right-sizing picks the cheapest plan that still covers what the person used, checking mailbox size and desktop app use. Savings at dated, editable list prices with high/medium/low confidence.
- **Actions**: approve or reject each change, then download a Microsoft Graph PowerShell script (`Set-MgUserLicense`, dry run by default, skips group-assigned licences), its rollback script, and a CSV of planned changes. A printable cost report for management and a renewal planner for true-up seat counts.
- **History**: monthly snapshots and a compare view showing the savings actually realised.
- **MSP mode**: one project per client tenant with a roll-up.
- Two synthetic sample tenants (clearly labelled), light and dark themes, optional account sync.

## Formats tested

The importer tests use the exact column layouts Microsoft documents for the Graph usage reports (Email activity, Mailbox usage, Microsoft 365 active users, Teams user activity, Microsoft 365 Apps, Copilot usage) and the admin center Active users export, with synthetic rows. SKU part numbers and product names are checked against Microsoft's [Product names and service plan identifiers for licensing](https://learn.microsoft.com/entra/identity/users/licensing-service-plan-reference) list (CSV dated 19 August 2026).

Known gaps: Graph's usage reports carry no recipient type, so the one-CSV export cannot spot shared mailboxes on its own; import the admin center Mailbox usage export or mark them by hand. Copilot Business has no published part number in Microsoft's list yet.

Everything runs in the browser and works signed out; data stays in IndexedDB unless you sign in to sync.

## Run locally

```
npm install
npm run dev
npm test
npm run build
```

Optional sync needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`.

Built by Aryan Kansagara. Independent project, not affiliated with Microsoft.
