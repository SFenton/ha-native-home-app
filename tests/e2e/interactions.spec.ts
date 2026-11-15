import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { StudioDocument } from '../../src/shared/types';
import { mobileEditorDocument } from '../fixtures/mobile-editor';

function interactionDocument(): StudioDocument {
  const document = mobileEditorDocument();
  document.variables.recipeQuery = '';
  document.dataSources = [{
    id: 'recipes', name: 'Recipes', kind: 'static', refreshSeconds: 30,
    sample: [
      { uid: 'rice', title: 'Rice & beans', subtitle: 'Dinner' },
      { uid: 'soup', title: 'Tomato soup', subtitle: 'Lunch' },
      ...Array.from({ length: 20 }, (_, index) => ({ uid: `recipe-${index}`, title: `Other recipe ${index + 1}`, subtitle: 'Synthetic recipe' })),
    ],
  }];
  const home = document.pages[0];
  home.components = [{ id: 'recipe-list', type: 'list', title: 'Recipes', props: {}, binding: { sourceId: 'recipes' } }];
  home.search = { id: 'recipe-search', label: 'Search recipes', placeholder: 'Find recipes', mode: 'filter', queryVariable: 'recipeQuery', targetComponentIds: ['recipe-list'], paths: ['title', 'subtitle'] };
  home.floatingButtons = [
    { id: 'recipe-help', label: 'Recipe help', icon: 'help', action: { type: 'modal', modalId: 'mobile-sheet' } },
    { id: 'recipe-about', label: 'About recipes', icon: 'info', action: { type: 'navigate', pageId: 'mobile-other' } },
  ];
  return document;
}

async function seed(request: APIRequestContext, document: StudioDocument) {
  const current = await (await request.get('/api/draft')).json();
  const saved = await request.put('/api/draft', { data: { document, expectedRevision: current.revision } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return (await request.get('/api/draft')).json();
}

async function interact(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
    expect(url.origin, 'Acceptance must never call HA or external services').toBe(`http://127.0.0.1:${process.env.STUDIO_E2E_PORT ?? '4801'}`);
    expect(url.pathname, 'Preview interactions must not send service writes').not.toMatch(/\/(?:services|actions)(?:\/|$)/);
    await route.continue();
  });
});

test('configured floating actions remain docked while the list scrolls and local search stays unsaved', async ({ page, request }) => {
  const saved = await seed(request, interactionDocument());
  await interact(page);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  const help = canvas.getByRole('button', { name: 'Recipe help', exact: true });
  const dockPosition = () => help.evaluate(element => {
    const root = element.closest('.native-app')!.getBoundingClientRect();
    return (element.getBoundingClientRect().top - root.top) / root.height;
  });
  const initial = await dockPosition();
  expect(await help.evaluate(element => element.closest('.native-scroll'))).toBeNull();
  await canvas.locator('.native-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await canvas.locator('.native-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect.poll(dockPosition).toBeCloseTo(initial, 3);
  await expect(help).toBeInViewport();
  await help.click();
  await expect(canvas.locator('.native-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(canvas.locator('.native-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await canvas.getByRole('button', { name: 'Dismiss app modal', exact: true }).click();
  const search = canvas.getByRole('searchbox', { name: 'Search recipes', exact: true });
  await search.fill('rIcE');
  await expect(canvas.getByText('Rice & beans', { exact: true })).toBeVisible();
  await expect(canvas.getByText('Tomato soup', { exact: true })).toHaveCount(0);
  await search.fill('no matching recipe');
  await expect(canvas.getByText('Rice & beans', { exact: true })).toHaveCount(0);
  await search.fill('');
  await expect(canvas.getByText('Tomato soup', { exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: 'About recipes', exact: true }).click();
  await expect(canvas.getByRole('heading', { name: 'Other page', exact: true })).toBeVisible();
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('both row-action sides expose configured actions with cancellable confirmation', async ({ page, request }) => {
  const document = interactionDocument();
  document.dataSources[0].sample = [{ uid: 'rice', title: 'Rice & beans', subtitle: 'Dinner' }];
  document.pages[0].components[0].rowActions = {
    keyPath: 'uid',
    leading: [{ id: 'details', label: 'Recipe details', icon: 'info', color: '#1177aa', action: { type: 'modal', modalId: 'mobile-sheet' } }],
    trailing: [{
      id: 'about', label: 'Open about', icon: 'arrow-right', color: '#dd784e',
      action: { type: 'navigate', pageId: 'mobile-other' },
      confirmation: { title: 'Open About recipes?', message: 'Synthetic navigation confirmation.', confirmLabel: 'Continue', cancelLabel: 'Keep recipe' },
    }],
  };
  const saved = await seed(request, document);
  await interact(page);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  const row = canvas.locator('[data-component-id="recipe-list"]');
  await row.getByLabel('Actions for Rice & beans', { exact: true }).click();
  await page.getByRole('button', { name: 'Recipe details', exact: true }).click();
  await expect(canvas.locator('.native-modal')).toBeVisible();
  await canvas.getByRole('button', { name: 'Dismiss app modal', exact: true }).click();
  await row.getByLabel('Actions for Rice & beans', { exact: true }).click();
  await page.getByRole('button', { name: 'Open about', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Open About recipes?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep recipe', exact: true }).click();
  await expect(canvas.getByRole('heading', { name: 'Mobile home', exact: true })).toBeVisible();
  await row.getByLabel('Actions for Rice & beans', { exact: true }).click();
  await page.getByRole('button', { name: 'Open about', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(canvas.getByRole('heading', { name: 'Other page', exact: true })).toBeVisible();
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('endpoint search requires consent, encodes the query, and never shows samples as failed live results', async ({ page, request }) => {
  const document = interactionDocument();
  document.dataSources[0] = { ...document.dataSources[0], kind: 'endpoint', endpoint: 'synthetic-search', queryVariable: 'recipeQuery' };
  document.pages[0].search = { id: 'recipe-search', label: 'Search recipes', placeholder: 'Find recipes', mode: 'endpoint', sourceId: 'recipes' };
  const saved = await seed(request, document), queries: string[] = [];
  await page.route(new RegExp(`^http://127\\.0\\.0\\.1:${process.env.STUDIO_E2E_PORT ?? '4801'}/api/data/recipes(?:\\?|$)`), async route => {
    const query = new URL(route.request().url()).searchParams.get('q');
    expect(query).not.toBeNull();
    queries.push(query!);
    await route.fulfill(query === 'fail'
      ? { status: 502, json: { error: 'Synthetic search failed' } }
      : { json: { data: [{ uid: 'result', title: `Found: ${query}`, subtitle: 'Registered fixture' }], mode: 'live' } });
  });
  await interact(page);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  const search = canvas.getByRole('searchbox', { name: 'Search recipes', exact: true });
  expect(queries).toEqual([]);
  await page.getByRole('button', { name: 'Live data: off', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Live data: on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(search).toBeDisabled();
  await canvas.getByRole('button', { name: 'Allow search requests', exact: true }).click();
  await search.fill('rice & beans/?');
  await search.press('Enter');
  await expect(canvas.getByText('Found: rice & beans/?', { exact: true })).toBeVisible();
  expect(queries).toEqual(['rice & beans/?']);
  await search.fill('fail');
  await search.press('Enter');
  await expect(canvas.getByText('Synthetic search failed', { exact: true })).toBeVisible();
  await expect(canvas.getByText('Rice & beans', { exact: true })).toHaveCount(0);
  await expect(canvas.getByText('Found: rice & beans/?', { exact: true })).toHaveCount(0);
  await search.fill('');
  await expect(canvas.getByText('Enter a query to search.', { exact: false })).toBeVisible();
  expect(queries).toEqual(['rice & beans/?', 'fail']);
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});
