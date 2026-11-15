import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { importNativeHome, type NativeSnapshot } from '../../src/shared/native-preview';

function fixture() {
  const command = (name: string) => ({
    type: 'service', call: { domain: 'remote', service: 'send_command', target: 'remote.fixture', data: { command: name } },
  });
  const snapshot: NativeSnapshot = {
    mode: 'live',
    houseConfig: { schema: 2, hash: 'd'.repeat(64), config: {
      home: { statusChips: [], cameras: [], guestToggles: [
        { title: 'Family Guests', entityId: 'input_boolean.fixture_family' },
        { title: 'Other Guests', entityId: 'input_boolean.fixture_other' },
      ] },
      security: {},
      climate: {
        globalThermostatEntityId: 'climate.fixture', rooms: [],
        integrationEntityId: 'input_boolean.fixture_automatic',
        ecoModeEntityId: 'input_boolean.fixture_eco',
        ecoCriticalEntityId: 'select.fixture_critical', ecoAwayEntityId: 'select.fixture_away',
      },
      chores: { pages: [], quickLinks: [] },
      rooms: { pages: [], grid: { items: [] }, quickLinks: [
        { id: 'media', title: 'Media', action: { type: 'navigate', path: 'media' } },
        { id: 'vacuums', title: 'Vacuums', action: { type: 'navigate', path: 'vacuums' } },
      ] },
      media: {
        pageSections: [{ title: 'TV', cards: [{ device: { title: 'Fixture TV', entityId: 'media_player.fixture' }, remoteId: 'fixture' }] }],
        remotes: [{
          id: 'fixture', title: 'Fixture TV', remoteTitle: 'Fixture Remote', mediaEntityId: 'media_player.fixture',
          controlEntityId: 'remote.fixture', volumeEntityId: 'media_player.fixture',
          power: { label: 'Power', action: { type: 'state', entityId: 'media_player.fixture', cases: [
            { states: ['off'], command: command('POWER_ON') },
            { states: ['playing', 'paused'], command: command('POWER_OFF') },
          ], otherwise: command('POWER_OTHER') } },
          ...Object.fromEntries(['back', 'up', 'left', 'select', 'right', 'home', 'down', 'pause', 'play'].map(key =>
            [key, { label: key[0].toUpperCase() + key.slice(1), action: { type: 'command', command: command(key.toUpperCase()) } }])),
          apps: [{ title: 'Configured app', action: { type: 'command', command: command('APP') } }],
        }],
      },
      vacuums: { vacuums: [{
        title: 'Fixture Robot', entityId: 'vacuum.fixture', cleanScript: 'script.fixture_clean',
        zones: [{ title: 'Study', entityId: 'input_boolean.fixture_study', mapName: 'Study' }],
        consumables: [{ title: 'Filter', entityId: 'sensor.fixture_filter', valueKind: 'hours' }],
        dockControls: { dockStatusEntityId: 'sensor.fixture_dock', cleanScript: 'script.fixture_dock_clean' },
      }] },
    } },
    states: [
      { entityId: 'input_boolean.fixture_family', name: 'Family Guests', state: 'on' },
      { entityId: 'input_boolean.fixture_other', name: 'Other Guests', state: 'off' },
      { entityId: 'input_boolean.fixture_automatic', name: 'Automatic Thermostat', state: 'on' },
      { entityId: 'input_boolean.fixture_eco', name: 'Eco Mode', state: 'off' },
      { entityId: 'climate.fixture', name: 'Thermostat', state: 'heat', currentTemperature: 20, temperature: 21, minTemp: 10, maxTemp: 30, targetTempStep: 1, hvacModes: ['off', 'heat'], unit: '°C' },
      { entityId: 'select.fixture_critical', name: 'Critical Tracking', state: 'Track All', options: ['Track All', 'Track Select Critical'] },
      { entityId: 'select.fixture_away', name: 'Away Behavior', state: 'Eco', options: ['Eco', 'Comfort'] },
      { entityId: 'media_player.fixture', name: 'TV', state: 'playing', volumeLevel: 0.4, supportedFeatures: 4 },
      { entityId: 'vacuum.fixture', name: 'Robot', state: 'docked', batteryLevel: 72, supportedFeatures: 4 | 8 | 16 | 512 | 8192 },
      { entityId: 'sensor.fixture_dock', name: 'Dock', state: 'idle' },
      { entityId: 'sensor.fixture_filter', name: 'Filter', state: '100' },
      { entityId: 'input_boolean.fixture_study', name: 'Study', state: 'off' },
    ],
  };
  const { document } = importNativeHome(snapshot);
  delete document.theme.background;
  document.dataSources = document.dataSources.map(source => ({
    ...source, kind: 'static', endpoint: undefined, sample: source.id === 'native-states' ? snapshot.states : {},
  }));
  for (const [title, modalTitle] of [['Open robot', 'Fixture Robot Robot Vacuum'], ['Open remote', 'Fixture Remote']]) {
    const modal = document.modals.find(item => item.title === modalTitle)!;
    document.pages[0].components.unshift({
      id: title.replaceAll(' ', '-'), type: 'navigation-tile', title, props: {}, action: { type: 'modal', modalId: modal.id },
    });
  }
  return document;
}

async function open(page: Page, request: APIRequestContext, document = fixture()) {
  const current = await (await request.get('/api/draft')).json();
  const response = await request.put('/api/draft', { data: { document, expectedRevision: current.revision } });
  expect(response.ok(), await response.text()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return (await request.get('/api/draft')).json();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol)) {
      expect(url.origin).toBe(`http://127.0.0.1:${process.env.STUDIO_E2E_PORT ?? '4801'}`);
      expect(url.pathname).not.toMatch(/\/(?:services|actions)(?:\/|$)/);
    }
    await route.continue();
  });
});

test('Guests keeps all tiles and body/disc use explicit simulated setters without opening a modal', async ({ page, request }) => {
  const saved = await open(page, request);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  const guests = canvas.locator('.native-guest-tile');
  await expect(guests).toHaveCount(2);
  const family = guests.filter({ hasText: 'Family Guests' });
  await family.locator('.native-guest-body').click();
  await expect(page.getByText('Simulated input_boolean.turn_off. No Home Assistant device was changed.', { exact: true })).toBeVisible();
  await expect(family).toContainText('No guests');
  await family.getByRole('button', { name: 'Turn on Family Guests', exact: true }).click();
  await expect(page.getByText('Simulated input_boolean.turn_on. No Home Assistant device was changed.', { exact: true })).toBeVisible();
  await expect(family).toContainText('Guests staying');
  await expect(canvas.getByRole('dialog')).toHaveCount(0);
  await expect(canvas.getByRole('alertdialog')).toHaveCount(0);
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('thermostat entries describe their destinations and child chrome retains the modal through Edit', async ({ page, request }, info) => {
  const saved = await open(page, request);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  await canvas.getByRole('navigation', { name: 'App tabs' }).getByRole('button', { name: 'Climate', exact: true }).click();
  for (const text of [
    "View each room's temperature and occupancy, then open a room to adjust its target and check vent position.",
    'Manage Automatic Thermostat, Eco Mode, and Predictive Comfort settings.',
    'Choose which rooms participate in normal comfort, critical protection, or occupancy-only tracking.',
  ]) await expect(canvas.getByText(text, { exact: true })).toBeVisible();
  await canvas.getByRole('button', { name: /^Advanced Configuration / }).click();
  const modal = canvas.getByRole('dialog', { name: 'Advanced Controls', exact: true });
  await expect(modal.getByRole('tab', { name: 'Automation', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(modal.locator('.native-inline-title')).toHaveText('Advanced Controls');
  await expect(modal.locator('.native-inline-title')).toHaveCSS('opacity', '1');
  await expect(modal.getByText("Turn Home Assistant's automatic thermostat control on or off.", { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: /^Eco Mode Critical Tracking / }).click();
  await expect(modal.locator('.native-inline-title')).toHaveText('Eco Mode Critical Tracking');
  await expect(modal.getByRole('button', { name: 'Back in sheet', exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Dismiss app modal', exact: true })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Track All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(modal.locator('.native-inline-title')).toHaveText('Eco Mode Critical Tracking');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await expect(modal.locator('.native-inline-title')).toHaveText('Eco Mode Critical Tracking');
  await page.locator('.device-screen').screenshot({ path: info.outputPath('thermostat-child.png'), animations: 'disabled' });
  await modal.getByRole('button', { name: 'Back in sheet', exact: true }).click();
  await expect(modal.getByRole('tab', { name: 'Automation', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('vacuum tabs retain local room selection and same-sheet unavailable pages use Back-only chrome', async ({ page, request }, info) => {
  const saved = await open(page, request);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  await canvas.getByRole('button', { name: 'Open robot', exact: true }).click();
  const modal = canvas.getByRole('dialog', { name: 'Fixture Robot Robot Vacuum', exact: true });
  await expect(modal.locator('.native-inline-title')).toContainText('Fixture Robot Robot Vacuum');
  await expect(modal.getByRole('tab')).toHaveCount(5);
  await expect(modal.getByRole('button', { name: 'Full Clean', exact: true })).toBeVisible();
  await modal.getByRole('tab', { name: 'Rooms', exact: true }).click();
  const study = modal.getByRole('button', { name: /Study Not selected/ });
  await study.click();
  await expect(modal.getByRole('button', { name: 'Study 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await modal.getByRole('tab', { name: 'Controls', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Clean', exact: true })).toBeDisabled();
  await expect(modal.getByText('Selected-room command payload unavailable.', { exact: false })).toBeVisible();
  await modal.getByRole('button', { name: 'Fixture Robot Cleaning Area', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Dismiss app modal', exact: true })).toBeHidden();
  await expect(modal.getByText('Cleaning-area preview unavailable:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(modal.locator('.native-inline-title')).toContainText('Fixture Robot Cleaning Area');
  await page.getByRole('button', { name: 'Interact', exact: true }).click();
  await modal.getByRole('button', { name: 'Back in sheet', exact: true }).click();
  await modal.getByRole('tab', { name: 'Rooms', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Study 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.device-screen').screenshot({ path: info.outputPath('vacuum-rooms.png'), animations: 'disabled' });
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});

test('remote ordered Power branch, pad placement, tabs and committed volume use only simulation', async ({ page, request }, info) => {
  const document = fixture();
  const saved = await open(page, request, document);
  const canvas = page.getByRole('region', { name: 'Device canvas', exact: true });
  await canvas.getByRole('button', { name: 'Open remote', exact: true }).click();
  const modal = canvas.getByRole('dialog', { name: 'Fixture Remote', exact: true });
  await expect(modal.locator('.native-inline-title')).toContainText('Playing');
  const power = modal.getByRole('button', { name: 'Power', exact: true });
  await expect(power).toHaveCount(1);
  const keyBox = (key: string) => modal.locator(`.native-remote-key[data-remote-key="${key}"]`).boundingBox();
  const [back, up, powerBox, left, select, right, home, down] = await Promise.all(['back', 'up', 'power', 'left', 'select', 'right', 'home', 'down'].map(key =>
    key === 'power' ? power.boundingBox() : keyBox(key)));
  expect(back!.y).toBeCloseTo(up!.y, 1);
  expect(up!.y).toBeCloseTo(powerBox!.y, 1);
  expect(left!.y).toBeCloseTo(select!.y, 1);
  expect(select!.y).toBeCloseTo(right!.y, 1);
  expect(home!.y).toBeCloseTo(down!.y, 1);
  expect(back!.x).toBeLessThan(up!.x);
  expect(up!.x).toBeLessThan(powerBox!.x);
  await power.click();
  await expect(page.getByText('Simulated remote.send_command. No Home Assistant device was changed.', { exact: true })).toBeVisible();
  const volume = modal.getByRole('slider', { name: 'Volume', exact: true });
  await volume.focus();
  await volume.press('ArrowRight');
  await expect(volume).toHaveValue('41');
  await expect(page.getByText('Simulated media_player.volume_set. No Home Assistant device was changed.', { exact: true })).toBeVisible();
  await modal.getByRole('tab', { name: 'Apps', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Configured app', exact: true })).toBeVisible();
  await modal.getByRole('tab', { name: 'Remote', exact: true }).click();
  await expect(volume).toHaveValue('41');
  await page.locator('.device-screen').screenshot({ path: info.outputPath('remote-pad.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /^Activity(?:\s*\d+)?$/ }).click();
  await expect(page.getByText(/POWER_OFF/)).toBeVisible();
  expect(await (await request.get('/api/draft')).json()).toEqual(saved);
});
