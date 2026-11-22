import { expect, test, type Page } from '@playwright/test';
import { effectiveAwayDocument, effectiveAwaySnapshot } from '../flows-canvas/integration/fixture';
import { isPhone, openLibrary, seed, waitForWorkspace } from './workspace2-helpers';

async function openAway(page: Page, name = 'Effective Away') {
  let panel;
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    await page.locator('.w2-project-sheet .w2-list-row', { hasText: /^Flows$/ }).click();
    panel = page.locator('.w2-data');
  } else {
    await openLibrary(page, 'Flows');
    panel = page.getByTestId('flows-panel');
  }
  const templates = panel.getByRole('button', { name: /^Templates, \d+$/ });
  if (await templates.count() && await templates.getAttribute('aria-expanded') === 'false') await templates.click();
  await panel.getByRole('button', { name: new RegExp(`^${name}`) }).first().click();
  await page.getByTestId('logic-editor').getByRole('button', { name: 'Edit in Canvas', exact: true }).first().click();
  const close = page.getByRole('button', { name: 'Close block palette', exact: true });
  if (await close.isVisible()) await close.click();
}

test('held Effective Away values are visible on open, literals are known, and the result is framed after Tidy Up', async ({ page, request }) => {
  await seed(request, effectiveAwayDocument());
  const before = (await (await request.get('/native/api/draft')).json()).document;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/native-home', route => route.fulfill({ json: effectiveAwaySnapshot }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitForWorkspace(page);
  await openAway(page);
  const preview = page.getByRole('complementary', { name: 'Canvas preview', exact: true });
  const summary = preview.getByRole('region', { name: 'Result summary', exact: true });
  await expect(summary.getByLabel('Result value', { exact: true })).toHaveText('No');
  await expect(summary.getByText('Last value kept', { exact: true })).toHaveClass(/w2-tag-neutral/);
  await expect(summary.getByText('Last known values · waiting for Home Assistant.', { exact: true })).toBeVisible();
  await expect(summary.locator('dl > div').filter({ has: page.getByText('Effective mode', { exact: true }) }).locator('dd')).toHaveText('Home');
  await expect(summary.locator('dl > div').filter({ has: page.getByText('Away fallback', { exact: true }) }).locator('dd')).toHaveText('No');
  const disclosure = preview.locator('details').filter({ has: page.getByText('Simulation · Studio only', { exact: true }) });
  await expect(disclosure).not.toHaveAttribute('open');
  const firstPreviewContent = await preview.evaluate(panel => {
    const result = panel.querySelector('.w2-logic-result-summary')!, lens = panel.querySelector('.w2-logic-lens')!;
    return Boolean(result.compareDocumentPosition(lens) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(firstPreviewContent).toBe(true);
  for (const value of ['unknown', 'unavailable']) {
    const literal = page.getByRole('button', { name: new RegExp(`^Text, Result output.*known, live, value ${value}$`) });
    await expect(literal).toHaveAttribute('data-observation-state', 'known');
    await expect(literal.locator('.w2-canvas-port-value')).toHaveText(value);
  }
  const settings = page.locator('.w2-canvas-node[data-setting]');
  await expect(settings.locator('.w2-canvas-node-title strong', { hasText: /^Effective mode$/ })).toHaveCount(2);
  await expect(settings.locator('.w2-canvas-node-title small', { hasText: /^Template Setting$/ })).toHaveCount(3);
  await expect(page.locator('.w2-canvas-node-detail', { hasText: /^Choose an entity$/ })).toHaveCount(0);
  await expect(page.locator('.w2-canvas-node-detail', { hasText: /^Effective mode$/ })).toHaveCount(2);
  const root = page.locator('.w2-canvas-node[data-result]');
  await expect(root.getByRole('button', { name: /^Select Any Of \d+, result$/ })).toBeVisible();
  await expect(root.locator('.w2-canvas-result-badge')).toHaveText('Result');
  async function expectFramed() {
    await expect(page.getByLabel('Zoom', { exact: true })).toHaveText('60%');
    await expect(async () => {
      const [card, viewport] = await Promise.all([root.boundingBox(), page.locator('.w2-canvas-viewport').boundingBox()]);
      expect(card).not.toBeNull(); expect(viewport).not.toBeNull();
      expect(card!.x).toBeGreaterThanOrEqual(viewport!.x);
      expect(card!.x + card!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width);
      expect(card!.y).toBeGreaterThanOrEqual(viewport!.y);
      expect(card!.y + card!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height - 70);
    }).toPass();
  }
  await expectFramed();
  await disclosure.locator(':scope > summary').click();
  await expect(page.getByRole('group', { name: 'Simulation mode', exact: true })).toBeVisible();
  await disclosure.locator(':scope > summary').click();
  await preview.evaluate(panel => panel.scrollTo(0, 0));
  await expect(summary.getByLabel('Result value', { exact: true })).toBeVisible();
  const tidy = page.getByRole('button', { name: 'Tidy Up', exact: true });
  await tidy.click();
  await expectFramed();
  await expect(tidy).toBeFocused();
  await page.getByRole('button', { name: 'Close canvas', exact: true }).click();
  const discard = page.getByRole('button', { name: 'Discard and close', exact: true });
  if (await discard.isVisible()) await discard.click();
  expect((await (await request.get('/native/api/draft')).json()).document).toEqual(before);
  expect(errors).toEqual([]);
});

test.describe('house time zone', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  test('formats canvas Result against the Los Angeles live clock and announces browser fallback', async ({ page, request }) => {
    const document = effectiveAwayDocument();
    document.logicLibrary!.push({ id: 'demo_house_date', name: 'House date', kind: 'operand', params: [],
      body: { type: 'last-changed', sourceId: 'demo_mode' } });
    await seed(request, document);
    let zone: string | undefined = 'America/Los_Angeles';
    await page.route('**/api/native-home', route => route.fulfill({ json: { ...effectiveAwaySnapshot, timeZone: zone,
      states: effectiveAwaySnapshot.states.map(state => state.entityId === 'input_select.demo_mode'
        ? { ...state, lastChanged: '2026-11-21T10:00:00Z' } : state),
    } }));
    await page.clock.install({ time: new Date('2026-11-21T20:00:00Z') });
    await page.goto('/'); await waitForWorkspace(page);
    await openAway(page, 'House date');
    const preview = page.getByRole('complementary', { name: 'Canvas preview', exact: true });
    const result = preview.getByLabel('Result value', { exact: true });
    await expect(result).toHaveText('Today, 2:00 AM');
    await expect(result).toHaveAttribute('aria-description', /2026-11-21T10:00:00Z/);
    await expect(preview.getByText("Times shown in this browser's time zone", { exact: true })).toHaveCount(0);
    zone = undefined;
    await page.reload(); await waitForWorkspace(page);
    await openAway(page, 'House date');
    await expect(result).toHaveText('Yesterday, 7:00 PM');
    await expect(preview.getByText("Times shown in this browser's time zone", { exact: true }).first()).toBeVisible();
  });
});
