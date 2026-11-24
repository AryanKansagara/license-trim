import { expect, test as base } from '@playwright/test'

/**
 * Every test runs signed out in a fresh browser context (so a fresh IndexedDB). Nothing reaches the network beyond the preview
 * server: the Google Fonts stylesheet the page links to is stubbed with an empty response, and any other outside request
 * (Supabase, analytics, anything new) is aborted, recorded, and fails the test. Page errors and console errors fail it too.
 */
const STUBBED = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//
export const test = base.extend<{ guard: void }>({
  guard: [async ({ page, baseURL }, use) => {
    const external: string[] = []
    const errors: string[] = []
    await page.route(url => !url.href.startsWith(baseURL!), route => {
      const u = route.request().url()
      if (STUBBED.test(u)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
      external.push(u)
      return route.abort()
    })
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
    await use()
    expect(external, 'requests that left the preview server').toEqual([])
    expect(errors, 'uncaught page errors and console errors').toEqual([])
  }, { auto: true }],
})

export { expect }
