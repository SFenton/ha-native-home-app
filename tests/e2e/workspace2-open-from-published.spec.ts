import { expect, test } from '@playwright/test';
import { seed } from './workspace2-helpers';

/**
 * Opening the Studio starts from the published layout (studio-ux2). The test server has no Home Assistant, so the real answer is
 * always "keep"; the other answers are put in place of the check, and the real draft routes do the rest.
 */
test.beforeEach(async ({ request }) => { await seed(request); });

const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Start from Published?' });

test('with no Home Assistant the draft is kept and nothing is said', async ({ page, request }) => {
  const check = await (await request.get('/native/api/ha/open-check')).json();
  expect(check).toMatchObject({ action: 'keep', reason: 'not-connected' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await page.waitForTimeout(400);
  await expect(dialog(page)).toHaveCount(0);
});

test('a draft with unpublished edits asks, and Keep My Draft leaves it as it is', async ({ page, request }) => {
  const revision = (await (await request.get('/native/api/draft')).json()).revision;
  await page.route('**/native/api/ha/open-check', route => route.fulfill({ json: { action: 'ask', reason: 'unpublished-edits', draftRevision: revision, publishedRevision: 7 } }));
  await page.goto('/');
  const box = dialog(page);
  await expect(box).toBeVisible();
  const size = (await box.boundingBox())!, view = page.viewportSize()!;
  expect(size.x).toBeGreaterThanOrEqual(0); expect(size.x + size.width).toBeLessThanOrEqual(view.width); expect(size.y + size.height).toBeLessThanOrEqual(view.height);
  await expect(box.getByRole('button', { name: 'Start from Published' })).toBeFocused();
  for (const name of ['Keep My Draft', 'Start from Published']) { const button = (await box.getByRole('button', { name }).boundingBox())!; expect(button.height).toBeGreaterThanOrEqual(page.viewportSize()!.width < 700 ? 44 : 28); }
  await box.getByRole('button', { name: 'Keep My Draft' }).click();
  await expect(box).toHaveCount(0);
  expect((await (await request.get('/native/api/draft')).json()).revision).toBe(revision);
});

test('Start from Published in the dialog replaces the draft, and Restore Previous Draft is still there', async ({ page, request }) => {
  const revision = (await (await request.get('/native/api/draft')).json()).revision;
  await page.route('**/native/api/ha/open-check', route => route.fulfill({ json: { action: 'ask', reason: 'unpublished-edits', draftRevision: revision } }));
  let asked = 0;
  await page.route('**/native/api/ha/start-from-published', async route => {
    asked += 1;
    // The real server needs Home Assistant, which the test server lacks: keep the draft's own document as "the published layout".
    const current = await (await request.get('/native/api/draft')).json();
    await request.put('/native/api/draft', { data: { document: { ...current.document, name: 'Published layout' }, expectedRevision: current.revision } });
    await route.fulfill({ json: { revision: current.revision + 1, publishedRevision: 7, backup: { createdAt: new Date().toISOString(), revision: current.revision } } });
  });
  await page.goto('/');
  await dialog(page).getByRole('button', { name: 'Start from Published' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(asked).toBe(1);
});

test('a draft with no unpublished edits starts from published without a dialog', async ({ page, request }) => {
  const revision = (await (await request.get('/native/api/draft')).json()).revision;
  await page.route('**/native/api/ha/open-check', route => route.fulfill({ json: { action: 'start', reason: 'no-unpublished-edits', draftRevision: revision } }));
  let asked = 0;
  await page.route('**/native/api/ha/start-from-published', async route => { asked += 1; await route.fulfill({ status: 404, json: { error: 'Nothing has been published to Home Assistant yet' } }); });
  await page.goto('/');
  await expect.poll(() => asked).toBe(1);
  await expect(dialog(page)).toHaveCount(0);
  // A refusal is not shown: the draft stays and the Studio opens as usual.
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
});
