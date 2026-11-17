// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import AddPicker from '../src/workspace2/add/AddPicker';
import { endOf } from '../src/workspace2/add/insert';
import { askFirstDefaults, domainSummary, kindWords } from '../src/workspace2/editors/action';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { SelectMenusContext } from '../src/workspace2/SelectMenu';
import { choiceFits } from '../src/workspace2/SegmentRow';
import { summarize } from '../src/workspace2/rows';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({})) }));
afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;

/** The contact room card the Studio spec's Rule 1 is drawn on, in the properties surface. */
function roomCard() {
  const key = [...buildDocumentIndex(home).entries.values()].find(entry => entry.node?.id === 'hc-open-contact-0')!;
  const ws = Project.workspace(home, { kind: 'node', key: key.key, path: key.path });
  return render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
}

describe('Rule 1: the properties rows', () => {
  it('draws an empty optional value as a row that reads None, with no Add button', () => {
    const { container } = roomCard();
    expect(screen.queryByRole('button', { name: /^Add$/ })).toBeNull();
    const row = container.querySelector<HTMLElement>('button.w2-add-row')!;
    expect(row).toBeTruthy();
    expect(row.querySelector('.w2-summary')?.textContent).toBe('None');
    expect(row.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('.w2-add-row .w2-row-label')).toBeTruthy();
  });

  it('draws the entity once, where an override picks it', () => {
    const { container } = roomCard();
    const labels = [...container.querySelectorAll('.w2-row-label, .field > span:first-child')].map(node => node.textContent);
    expect(labels.filter(text => text === 'Entity')).toHaveLength(1);
  });

  it('draws Width as Half and Full in a segment, and the icon row as one line', () => {
    const { container } = roomCard();
    const width = within(container).getByRole('group', { name: 'Width' });
    expect([...width.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Automatic', 'Half', 'Full']);
    expect(width.querySelector('[aria-pressed=true]')?.textContent).toBe('Half');
    expect(container.querySelector('.w2-picker-secondary')).toBeNull();
    fireEvent.click(within(width).getByRole('button', { name: 'Full' }));
  });

  it('counts a list in words and reads an empty one None', () => {
    expect(summarize(home, 'states', ['on', 'open'])).toBe('2 states');
    expect(summarize(home, 'states', ['on'])).toBe('1 state');
    expect(summarize(home, 'stateLabels', [])).toBe('None');
    expect(summarize(home, 'colorSourceId', undefined)).toBe('None');
    expect(summarize(home, 'action', undefined)).toBe('Nothing');
  });

  it('turns three or more choices into a menu unless every label fits at a 320 px panel', () => {
    expect(choiceFits(['Half', 'Full'])).toBe(true);
    expect(choiceFits(['Same as App', 'Custom'])).toBe(true);
    expect(choiceFits(['Off', 'On', 'Auto'])).toBe(true);
    expect(choiceFits(['Neutral', 'Lights', 'Occupancy'])).toBe(false);
    expect(choiceFits(['Form', 'Page'])).toBe(true);
    expect(choiceFits(['A first option', 'A second option'])).toBe(false);
  });

  it('draws a menu as the Studio field with a chevron, never a native select, inside the workspace', () => {
    const { container } = render(<SelectMenusContext.Provider value><PropertiesPanelProbe/></SelectMenusContext.Provider>);
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('button.w2-select svg')).toBeTruthy();
  });
});

/** The room card's Kind menu on its own, under the workspace's menu setting. */
function PropertiesPanelProbe() {
  const key = [...buildDocumentIndex(home).entries.values()].find(entry => entry.node?.id === 'hc-open-contact-0')!;
  const ws = Project.workspace(home, { kind: 'node', key: key.key, path: key.path });
  return <PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>;
}

describe('F13 and F14: the action words', () => {
  it('names the on-or-off action for what it does, with the entity', () => {
    expect(kindWords.domain).toBe('Turn On or Off');
    const source = home.dataSources.find(item => item.kind === 'model' && (item as { inputs?: { entityId?: { value?: string } } }).inputs?.entityId?.value)!;
    const entity = (source as { inputs: { entityId: { value: string } } }).inputs.entityId.value;
    expect(domainSummary(home, source.id, new Map([[entity, 'Demo Lamp']]))).toBe('Turn On or Off · Demo Lamp');
    expect(domainSummary(home, source.id)).toBe(`Turn On or Off · ${entity}`);
    expect(domainSummary(home, 'missing')).toBe('Turn On or Off');
    expect(summarize(home, 'action', { type: 'domain', sourceId: source.id, intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } }, new Map([[entity, 'Demo Lamp']]))).toBe('Turn On or Off · Demo Lamp');
  });

  it('starts Ask first with a title naming the tile and a button that does it', () => {
    expect(askFirstDefaults('Guest Room')).toEqual({ title: 'Turn Off Guest Room?', confirmLabel: 'Turn Off' });
    expect(askFirstDefaults('')).toEqual({ title: 'Turn Off?', confirmLabel: 'Turn Off' });
  });
});

describe('F13: adding a tile', () => {
  const grid = [...buildDocumentIndex(home).entries.values()].find(entry => entry.node?.type === 'tile-grid')!;
  const destination = endOf(home, grid.key)!;
  const chosen = vi.fn();

  it('lists one Tile where there were three, and asks what it should do', () => {
    render(<AddPicker document={home} destination={destination} onChoose={chosen} onClose={() => {}}/>);
    const tiles = screen.getByRole('list', { name: 'Tiles' });
    const names = within(tiles).getAllByRole('listitem').map(node => node.textContent);
    expect(names).toContain('Tile');
    expect(names).not.toContain('Action tile');
    expect(names).not.toContain('Toggle');
    expect(names).not.toContain('Navigation tile');
    fireEvent.click(within(tiles).getByText('Tile'));
    expect(screen.getByRole('heading', { name: 'What should this tile do?' })).toBeTruthy();
    const choices = within(screen.getByRole('list', { name: 'What a tile can do' })).getAllByRole('listitem');
    expect(choices.map(node => node.querySelector('.w2-add-choice-name')?.textContent)).toEqual(['Switch an Entity', 'Run On and Off Services', 'Open a Page', 'Show a Device’s State']);
  });

  it('adds a navigation tile at once for Open a Page, and goes to entities for the others', () => {
    render(<AddPicker document={home} destination={destination} onChoose={chosen} onClose={() => {}}/>);
    fireEvent.click(screen.getByText('Tile'));
    fireEvent.click(screen.getByText('Open a Page'));
    expect(chosen).toHaveBeenCalledTimes(1);
    expect(chosen.mock.calls[0][0].made.node.type).toBe('navigation-tile');
    cleanup();
    render(<AddPicker document={home} destination={destination} onChoose={chosen} onClose={() => {}}/>);
    fireEvent.click(screen.getByText('Tile'));
    fireEvent.click(screen.getByText('Switch an Entity'));
    expect(screen.getByText('Choose an entity for the Action tile.')).toBeTruthy();
    expect(chosen).toHaveBeenCalledTimes(1);
  });

  it('goes back from the question to the tiles', () => {
    render(<AddPicker document={home} destination={destination} onChoose={chosen} onClose={() => {}}/>);
    fireEvent.click(screen.getByText('Tile'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('list', { name: 'Tiles' })).toBeTruthy();
  });
});
