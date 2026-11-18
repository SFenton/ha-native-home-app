// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { newDialControl } from '../src/shared/composition/dial-control-edit';
import { buildDocumentIndex } from '../src/preview2/model';
import { endOf } from '../src/workspace2/add/insert';
import { insertPlace, saveAsComponent } from '../src/workspace2/linked';
import { setPerPlace } from '../src/workspace2/params';
import { setChoosing } from '../src/workspace2/chooseStore';
import { resetTemplateFold } from '../src/workspace2/TemplateFold';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import { Project } from './support/workspace2-surfaces';
import firstSlice from './fixtures/composition-first-slice.json';

vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: vi.fn(async () => ({ epoch: 'e', current: null, history: [], storedAssets: 0 })) }));
beforeEach(resetTemplateFold);
afterEach(() => { cleanup(); setChoosing(undefined); });
type J = Record<string, any>;

/** A template of one dial control (invented name) with two places. */
function template() {
  const base = structuredClone((firstSlice as unknown as { document: CompositionDocument }).document) as unknown as J;
  base.pages[2].components = [newDialControl('range', { id: 'demo-dial', title: 'Demo humidity', layout: { span: 1 } }, { min: 20, max: 80, step: 1 })];
  const saved = saveAsComponent(base as CompositionDocument, ['pages', 2, 'components', 0], 'Demo Dial');
  const entry = saved.document.componentLibrary![0];
  const added = insertPlace(saved.document, entry.id, endOf(saved.document, `page:${base.pages[2].id}`)!);
  return { document: added.document, entryId: entry.id, bodyId: (entry.node as J).id as string };
}

/** The inspector for the body of the template, in Edit. */
function mount(document: CompositionDocument) {
  const entry = [...buildDocumentIndex(document).entries.values()].find(item => item.node?.type === 'dial-control' && item.bodyPath !== undefined)!;
  const ws = Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path } as never, { extra: { mode: 'edit', linked: { session: undefined, say: vi.fn() } } as never }, vi.fn());
  return render(<PropertiesPanel ws={ws} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);
}

describe('a dial control inside a template', () => {
  it('says a leaf row is set per place, under that row', () => {
    const { document, entryId, bodyId } = template();
    const set = setPerPlace(document, entryId, bodyId, 'props/range/max');
    const { container } = mount(set);
    // With a setting above it, the template's own rows start closed.
    fireEvent.click(within(screen.getByTestId('template-fold')).getAllByRole('button')[0]);
    const lines = container.querySelectorAll('[data-testid="per-place-line"]');
    expect(lines.length).toBe(1);
    expect(lines[0].textContent).toContain('Set per place as');
    expect(lines[0].previousElementSibling?.textContent).toContain('Highest');
  });

  it('puts a Choose Fields box on each leaf row while fields are chosen, and ticking one is a setting', () => {
    const { document, entryId } = template();
    setChoosing(entryId);
    mount(document);
    const boxes = screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-label'));
    expect(boxes).toEqual(expect.arrayContaining(['Set Highest per place', 'Set Lowest per place', 'Set Step per place']));
    const group = screen.getByRole('group', { name: 'Fields each place sets' });
    expect(within(group).getAllByRole('checkbox').length).toBeGreaterThan(10);
  });

  it('names each Choose Fields box for the row it sits on: a stopper by its name, a band by its number, and no schema words', () => {
    const { document, entryId } = template();
    const withBand = structuredClone(document) as unknown as J;
    const body = withBand.componentLibrary[0].node;
    body.props.bands = [{ from: 20, to: 40, ink: { type: 'solid-rgb', red: 142, green: 142, blue: 147 } }];
    setChoosing(entryId);
    mount(withBand as CompositionDocument);
    // The stoppers and the band are closed rows: open each to reach its fields.
    for (const head of screen.getAllByRole('button', { expanded: false }).filter(button => /^(Low|High|Band 1)/.test(button.textContent ?? ''))) fireEvent.click(head);
    const boxes = screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-label')!);
    expect(boxes).toEqual(expect.arrayContaining(['Set Value of Low per place', 'Set Value of High per place', 'Set Color of Low per place', 'Set Name for VoiceOver of Low per place',
      'Set Lowest per place', 'Set Highest per place', 'Set From of Band 1 per place', 'Set Color of Band 1 per place', 'Set Dimmed When per place']));
    // Each name is its own: no two boxes say the same thing, and the schema's words are gone.
    expect(new Set(boxes).size).toBe(boxes.length);
    for (const word of ['Stoppers', 'Ink', 'Shows', 'Minimum', 'Maximum', 'When tapped', 'Condition']) expect(boxes.filter(name => name.includes(word)), word).toEqual([]);
    // The caption is one field with one box, even when its text row shows.
    expect(boxes.filter(name => name === 'Set Caption per place')).toHaveLength(1);
  });
});
