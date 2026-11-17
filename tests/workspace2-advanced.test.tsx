// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IdRow from '../src/workspace2/IdRow';
import { ToastHost } from '../src/workspace2/toasts';
import { middleEllipsis } from '../src/workspace2/util';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { replaceAt } from '../src/composition-editor';
import { buildDocumentIndex } from '../src/preview2/model';
import { resetAdvancedFold } from '../src/workspace2/AdvancedFold';
import { fixedLine } from '../src/workspace2/labels';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { gatherFixed } from '../src/workspace2/rows';
import { ActionRow } from '../src/workspace2/editors/ActionEditor';
import { RowsProvider, schemaAt } from '../src/workspace2/rows';
import { PushStack } from '../src/workspace2/kit';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
beforeEach(resetAdvancedFold);
const home = homeDomains.document as unknown as CompositionDocument;
const entries = (document: CompositionDocument, type: string) => [...buildDocumentIndex(document).entries.values()].filter(entry => entry.node?.type === type);
const panel = (document: CompositionDocument, entry: ReturnType<typeof entries>[number]) => render(
  <PropertiesPanel ws={Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path })} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
const fold = () => screen.getByRole('button', { name: 'Advanced' });

describe('pick 7A: Advanced opens in place', () => {
  it('is a fold, closed by default, with aria-expanded, and pushes no page', () => {
    panel(home, entries(home, 'status-chip')[0]);
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Copy ID' })).toBeNull();
    fireEvent.click(fold());
    expect(fold().getAttribute('aria-expanded')).toBe('true');
    // The body it sits in is still there: nothing was pushed.
    expect(screen.getByRole('heading', { name: 'Lights' })).toBeTruthy();
    expect(document.querySelector('.w2-pushed')).toBeNull();
    expect(screen.getByText('ID')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy ID' })).toBeTruthy();
    fireEvent.click(fold());
    expect(fold().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Copy ID' })).toBeNull();
  });

  it('names what the app fixes in one line, built from the node’s single-value fields', () => {
    const chip = entries(home, 'status-chip')[0];
    panel(home, chip);
    fireEvent.click(fold());
    const expected = fixedLine(gatherFixed(home, chip.path))!;
    expect(expected).toMatch(/^Set by the app: /);
    expect(screen.getByTestId('fixed-line').textContent).toBe(expected);
    expect(fixedLine([])).toBeUndefined();
    expect(fixedLine(['type', 'id'])).toBeUndefined();
    expect(fixedLine(['actionOrder', 'stateText', 'feedback'])).toBe('Set by the app: action order, state text, feedback.');
    expect(fixedLine(['feedback'], 'haptics')).toBe('Set by the app: feedback, haptics.');
  });

  it('keeps it open per node type for the session', () => {
    const chips = entries(home, 'status-chip'), others = entries(home, 'door-tile');
    expect(chips.length).toBeGreaterThan(0);
    const first = panel(home, chips[0]);
    fireEvent.click(fold());
    first.unmount();
    const next = panel(home, chips.at(-1)!);
    expect(fold().getAttribute('aria-expanded')).toBe('true');
    next.unmount();
    panel(home, others[0]);
    expect(fold().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the unknown policy inside the condition editor, not among the generated rows', () => {
    const tile = entries(home, 'section').find(entry => !(entry.node as { visibleWhen?: unknown }).visibleWhen)!;
    const rule = { type: 'state', sourceId: home.dataSources[0].id, path: ['state'], in: ['on'] };
    const openFold = () => { if (fold().getAttribute('aria-expanded') !== 'true') fireEvent.click(fold()); };
    const without = panel(home, tile);
    openFold();
    expect(screen.queryByText(/entity is unknown/)).toBeNull();
    expect(screen.queryByText(/Add When the rule/)).toBeNull();
    without.unmount();
    const ruled = replaceAt(replaceAt(home, [...tile.path, 'visibleWhen'], rule), [...tile.path, 'whenUnknown'], 'hide') as CompositionDocument;
    panel(ruled, entries(ruled, 'section').find(entry => entry.key === tile.key)!);
    openFold();
    expect(screen.queryByText('When the rule’s entity is unknown')).toBeNull();
    expect(screen.queryByText('While the state is unknown')).toBeNull();
    expect(screen.getByRole('button', { name: /^Only show when:/ })).toBeTruthy();
  });

  it('moves “Show change at once” into the service call’s own Advanced fold on the When Tapped page', () => {
    const tile = entries(home, 'row')[0];
    const path = [...tile.path, 'action'];
    const call = { type: 'call-service', domain: 'light', service: 'turn_on' };
    const doc = replaceAt(home, path, call) as CompositionDocument;
    render(<RowsProvider value={{ document: doc, onChange: () => {}, onError: () => {} }}>
      <PushStack rootTitle="Tile" root={<ActionRow label="When tapped" path={path} schema={schemaAt(doc, path)} optional itemName="Tile"/>}/></RowsProvider>);
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    expect(screen.queryByText('Show change at once')).toBeNull();
    fireEvent.click(within(document.body).getByRole('button', { name: 'Advanced' }));
    expect(screen.getByRole('button', { name: /Add Show change at once/ })).toBeTruthy();
  });
});

describe('G4: the ID row', () => {
  const idOf = (document: CompositionDocument) => entries(document, 'status-chip')[0].node!.id;

  it('is one row: the label, the field and the Copy button share a line', () => {
    panel(home, entries(home, 'status-chip')[0]);
    fireEvent.click(fold());
    const row = document.querySelector<HTMLElement>('.w2-id-row')!;
    const label = within(row).getByText('ID'), field = row.querySelector<HTMLElement>('.w2-id-field')!, copy = within(row).getByRole('button', { name: 'Copy ID' });
    expect(field.contains(copy)).toBe(true);
    expect(label.offsetTop).toBe(field.offsetTop);
    expect(copy.offsetTop).toBe(field.offsetTop);
    expect(row.classList.contains('w2-row')).toBe(false);
    expect(copy.getAttribute('title')).toBe('Copy ID');
    expect(row.querySelector('code')!.textContent).toBe(idOf(home));
  });

  it('Copy writes the ID and raises the Copied toast', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    render(<ToastHost><IdRow id="tile-guests-7f3a" path="id"/></ToastHost>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    expect(await screen.findByText('Copied')).toBeTruthy();
    expect(write).toHaveBeenCalledWith('tile-guests-7f3a');
  });

  it('cuts the middle of an ID that does not fit and keeps the whole of it in the title', () => {
    expect(middleEllipsis('tile-guests-7f3a', 20)).toBe('tile-guests-7f3a');
    const cut = middleEllipsis('tile-guests-living-7f3a', 13);
    expect(cut).toHaveLength(13);
    expect(cut.startsWith('tile-g')).toBe(true);
    expect(cut.endsWith('f3a')).toBe(true);
    expect(middleEllipsis('abc', Infinity)).toBe('abc');
    render(<IdRow id="tile-guests-7f3a" path="id"/>);
    expect(document.querySelector('code')!.getAttribute('title')).toBe('tile-guests-7f3a');
  });
});
