// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fidpanelsStory } from '../src/preview2/fixtures/fidpanels-story';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows, type Preview2Props } from '../src/preview2/Preview2';
import { sheetAppearance } from '../src/preview2/sheet-appearance';
import { settingsRowMinimum } from '../src/preview2/nodes/settings-minimum';
import { convertDoorTile, type DoorTileNode } from '../src/shared/composition/door-to-state-tile';
import { compositionChildren, compositionDocumentSchema, type CompositionDocument, type CompositionNode } from '../src/shared/composition/schema';

afterEach(cleanup);

const story = fidpanelsStory();
type Surface = Preview2Props['surface'];
function mount(surface: Surface, over: Partial<Preview2Props> = {}) {
  const props: Preview2Props = { document: story.document, mode: 'use', surface, onSurfaceChange: vi.fn(), onSelect: vi.fn(), window: previewWindows[0], bezel: false,
    house: story.house, overlay: emptyOverlay, onOverlayChange: vi.fn(), ...over };
  return { ...render(<Preview2 {...props}/>), props };
}
const frame = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-sel="node:${id}"]`)!;
const modal = (id: string): Surface => ({ kind: 'modal', id });

describe('the fidpanels story', () => {
  it('is a document the schema accepts, with synthetic ids only', () => {
    expect(compositionDocumentSchema.safeParse(story.document).success).toBe(true);
    expect(JSON.stringify(story.document)).not.toMatch(/"(?:light|switch|sensor|climate|alarm_control_panel)\.(?!demo_)/);
  });
});

describe('item 5: the chosen alarm mode', () => {
  it('marks the mode of a known state `data-chosen` and never `data-selected`, which is the Edit selection ring', () => {
    const { container } = mount(modal('modal-fid-security'));
    const chosen = container.querySelectorAll('.sh-alarm-mode[data-chosen]');
    expect(chosen).toHaveLength(1);
    expect(chosen[0].textContent).toBe('Home');
    expect(container.querySelectorAll('.sh-alarm-mode[data-selected]')).toHaveLength(0);
  });
  it('leaves the selection ring to the selected node in Edit', () => {
    const { container } = mount(modal('modal-fid-security'), { mode: 'edit', selection: 'node:fid-alarm' });
    expect(container.querySelectorAll('[data-selected]')).toHaveLength(1);
    expect(frame(container, 'fid-alarm').hasAttribute('data-selected')).toBe(true);
    expect(container.querySelectorAll('.sh-alarm-mode[data-chosen]')).toHaveLength(1);
  });
});

describe('item 9: a door tile lowers to a state tile', () => {
  it('draws the lowered tile with the state style the conversion derives, one per door', () => {
    const { container } = mount(modal('modal-fid-security'));
    const front = frame(container, 'fid-door-front'), back = frame(container, 'fid-door-back');
    expect(front.querySelector('.sh-state-tile')).not.toBeNull();
    expect(front.textContent).toContain('Locked');
    expect(back.textContent).toContain('Unlocked');
    expect(back.querySelector('.sh-state-tile')!.className).toMatch(/sh-lit|sh-class-active|sh-fill-ink/);
  });
  it('uses the same conversion the Studio publishes with', () => {
    const doors: CompositionNode[] = [];
    const walk = (node: CompositionNode) => { if (node.type === 'door-tile') doors.push(node); compositionChildren(node).forEach(walk); };
    story.document.modals.forEach(item => item.components.forEach(walk));
    expect(doors).toHaveLength(2);
    const result = convertDoorTile(doors[0] as DoorTileNode, story.document.dataSources, `${doors[0].id}.door`);
    expect(result.node.type).toBe('state-tile');
    expect(result.node.binding).toMatchObject({ entityId: 'lock.demo_front', styleId: 'fid-door-front.door', builtIn: 'lock' });
  });
  it('keeps the plain glass tile for a door with no source to lower from', () => {
    const broken = structuredClone(story.document) as CompositionDocument;
    broken.dataSources = broken.dataSources.filter(source => source.id !== 'fid-door-front-source');
    const { container } = mount(modal('modal-fid-security'), { document: broken });
    expect(frame(container, 'fid-door-front').querySelector('.sh-state-tile')).toBeNull();
    expect(frame(container, 'fid-door-front').textContent).toContain('Front Door');
  });
});

describe('item 12: the thermostat hero', () => {
  it('has no step buttons, no Lower or Raise, and draws a knob for each set point and a marker for the reading', () => {
    const { container } = mount(modal('modal-fid-thermostat'));
    const dials = container.querySelectorAll<HTMLElement>('.sh-dv-dial');
    expect(dials).toHaveLength(2);
    for (const dial of dials) {
      expect(dial.querySelectorAll('button')).toHaveLength(0);
      expect(dial.querySelector('.sh-dv-dial-steps, .sh-dv-round')).toBeNull();
      expect(dial.querySelectorAll('.sh-dv-marker')).toHaveLength(1);
    }
    expect(screen.queryByRole('button', { name: /^(Lower|Raise)/ })).toBeNull();
    const range = [...dials].find(dial => dial.querySelector('.sh-dv-handle[data-handle=low]'))!;
    expect(range.querySelector('.sh-dv-handle[data-handle=high]')).not.toBeNull();
  });
  it('sizes the ring and knob to the app’s 320 point square', () => {
    const { container } = mount(modal('modal-fid-thermostat'));
    const dial = container.querySelector<HTMLElement>('.sh-dv-dial')!;
    const px = 260, track = dial.querySelector('.sh-dv-track')!, knob = dial.querySelector('.sh-dv-handle')!;
    expect(Number(track.getAttribute('stroke-width'))).toBeCloseTo(24 * px / 320, 3);
    expect(Number(knob.getAttribute('r'))).toBeCloseTo(10 * px / 320, 3);
    expect(Number(knob.getAttribute('stroke-width'))).toBeCloseTo(4 * px / 320, 3);
  });
});

describe('item 13: the hub menu', () => {
  it('keeps its label for VoiceOver and shows the glyph, the value and the chevron', () => {
    const { container } = mount(modal('modal-fid-thermostat'));
    const menus = frame(container, 'cl-hub').querySelectorAll<HTMLElement>('.sh-dv-menu');
    expect([...menus].map(menu => menu.getAttribute('aria-label'))).toEqual(['Mode', 'Fan']);
    for (const menu of menus) {
      expect(menu.querySelector('small')).toBeNull();
      expect(menu.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    }
    expect(menus[0].textContent).toBe('Heat');
    expect(menus[1].textContent).toBe('Auto');
    expect(within(frame(container, 'cl-hub')).getByRole('button', { name: 'Mode' })).toBe(menus[0]);
  });
});

describe('item 16: settings rows in a grid', () => {
  const rows = () => {
    const found: CompositionNode[] = [];
    const walk = (node: CompositionNode) => { if (node.type === 'settings-control') found.push(node); compositionChildren(node).forEach(walk); };
    story.document.pages.find(page => page.id === 'page-fid-car')!.components.forEach(walk);
    return found;
  };
  it('declares a minimum for a row with a state or a switch, wider for a longer name, and none for a button', () => {
    const [charge, doors] = rows();
    expect(settingsRowMinimum(charge)).toBeGreaterThan(settingsRowMinimum(doors));
    expect(settingsRowMinimum(doors)).toBeGreaterThan(150);
    const button = { ...doors, props: { ...(doors as { props: object }).props, kind: 'sign-out' } } as CompositionNode;
    expect(settingsRowMinimum(button)).toBe(0);
    const toggle = { ...doors, props: { ...(doors as { props: object }).props, kind: 'household-toggle' } } as CompositionNode;
    expect(settingsRowMinimum(toggle)).toBeGreaterThan(0);
    expect(settingsRowMinimum({ ...doors, type: 'tile-grid' } as unknown as CompositionNode)).toBe(0);
  });
  it('draws every row with its name and its state as separate boxes', () => {
    const { container } = mount({ kind: 'page', id: 'page-fid-car' });
    const drawn = container.querySelectorAll('[data-type=settings-control] .sh-row');
    expect(drawn).toHaveLength(5);
    for (const row of drawn) { expect(row.querySelector('.sh-row-copy')).not.toBeNull(); expect(row.querySelector('.sh-row-value')).not.toBeNull(); }
  });
});

describe('item 11: the Studio’s Appearance setting', () => {
  it('draws a system sheet in the chosen scheme, and follows the browser when the Studio does', () => {
    expect(sheetAppearance('system', 'light')).toBe('light');
    expect(sheetAppearance('system', 'dark')).toBe('dark');
    expect(sheetAppearance('system', undefined)).toBe('system');
  });
  it('keeps a sheet that declares dark dark under every setting', () => {
    for (const studio of ['light', 'dark', undefined] as const) expect(sheetAppearance('dark', studio)).toBe('dark');
  });
  it('puts the scheme on the sheet the preview draws', () => {
    const sheet = (id: string, appearance?: 'light' | 'dark') => mount(modal(id), { appearance }).container.querySelector('.sh-sheet')!.getAttribute('data-appearance');
    expect(sheet('modal-fid-security', 'light')).toBe('light');
    cleanup();
    expect(sheet('modal-fid-security', 'dark')).toBe('dark');
    cleanup();
    expect(sheet('modal-fid-security')).toBe('system');
    cleanup();
    expect(sheet('modal-fid-dark', 'light')).toBe('dark');
    cleanup();
    expect(sheet('modal-fid-dark')).toBe('dark');
  });
});
