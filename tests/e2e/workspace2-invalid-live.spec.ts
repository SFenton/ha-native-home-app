import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { isPhone, openWorkspace, previewTile, seed, selectTile, snap } from './workspace2-helpers';

const fixture = JSON.parse(readFileSync(new URL('../../src/preview2/fixtures/home-domains.json', import.meta.url), 'utf8')) as { document: any };

/** The fixture with a Settings link at the end of the Cameras section, as the Add picker would put one. */
const withLink = () => {
  const document = structuredClone(fixture.document);
  const section = document.pages[0].components.find((node: { id: string }) => node.id === 'hc-home-cameras');
  section.children.push({ id: 'e2e-link', title: 'Studio link', layout: { span: 1 }, type: 'settings-link', icon: { type: 'sf-symbol', name: 'gearshape', rendering: 'canonical', unavailable: 'fallback' },
    props: { subtitle: '', showsChevron: true }, action: { type: 'push', pageId: document.pages[1].id, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } });
  return document;
};
test.beforeEach(async ({ request }) => { await seed(request, withLink()); });

test('a Settings link takes a new Title and Subtitle in the preview while its Hint is empty, and only Publish waits', async ({ page }) => {
  await openWorkspace(page);
  const panel = await selectTile(page, 'Studio link');
  if (isPhone(page)) await page.evaluate(() => window.dispatchEvent(new CustomEvent('w2:sheet-snap', { detail: 'full' })));
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-hint-before`);
  // Add Hint puts an empty hint on the link, which is an error until it is filled.
  await panel.getByRole('button', { name: 'Add Hint' }).click();
  await expect(panel.getByLabel('Hint', { exact: true })).toBeVisible();
  await expect(panel.locator('[data-field-problem]')).toContainText(/Hint/);
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved');
  // The error does not hold the preview back: Title and Subtitle show at once.
  await panel.getByLabel('Title', { exact: true }).fill('Renamed link');
  await expect(previewTile(page, 'Renamed link')).toBeVisible();
  await panel.getByLabel('Subtitle', { exact: true }).fill('Opens security');
  await expect(page.locator('[data-preview-root]').getByText('Opens security', { exact: true })).toBeVisible();
  await snap(page, `${isPhone(page) ? 'phone' : 'desktop'}-hint-after`);
  // The problem still stands: Checks lists it and Publish is held back, exactly as before.
  await expect(panel.locator('[data-field-problem]')).toContainText(/Hint/);
  if (!isPhone(page)) await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
  await expect(page.getByTestId('status-tag')).toHaveText('Not Saved');
  // Filling it clears the problem and the draft saves.
  await panel.getByLabel('Hint', { exact: true }).fill('Opens the security page');
  await expect(panel.locator('[data-field-problem]')).toHaveCount(0);
  await expect(page.getByTestId('status-tag')).not.toHaveText('Not Saved');
  await expect(previewTile(page, 'Renamed link')).toBeVisible();
});
