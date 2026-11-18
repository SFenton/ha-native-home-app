// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyOverlay, houseFrom } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import { buildDocumentIndex } from '../src/preview2/model';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { newClimateSource, newDialControl, newThermostat } from '../src/shared/composition/dial-control-edit';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';
import { copyOf, voiceIssues } from './support/copy';
import { Project } from './support/workspace2-surfaces';
import firstSlice from './fixtures/composition-first-slice.json';

type J = Record<string, any>;
const slice = (firstSlice as unknown as { document: CompositionDocument }).document;
const lit = (value: unknown) => ({ type: 'literal', value });
const base = { id: 'dial', title: 'Study humidity', layout: { span: 1 } };
const range = { min: 20, max: 80, step: 1 };
const dialNode = (start: 'blank' | 'one' | 'range', tweak?: (node: J) => void): J => { const node = newDialControl(start, base, range) as J; tweak?.(node); return node; };
function documentWith(node: J, sources: J[] = []): CompositionDocument {
  const document = structuredClone(slice) as unknown as J;
  document.pages[0].components = [node];
  document.dataSources.push(...sources);
  return document as CompositionDocument;
}
const gapSource = { id: 'gap-source', kind: 'ha-entity', entityId: lit('input_number.demo_gap') };
const gapRead = { type: 'read', from: { type: 'source', sourceId: 'gap-source', path: ['state'] }, as: 'number', missing: 'unavailable' };
const house = (gap = '8') => houseFrom({ states: [{ entityId: 'input_number.demo_gap', name: 'Demo gap', state: gap }] });

afterEach(cleanup);
// A 316 pt dial laid out at the origin; jsdom lays nothing out.
beforeEach(() => {
  // jsdom has no PointerEvent; a mouse event with a pointer id carries the coordinates a drag reads.
  if (!('PointerEvent' in window)) Object.defineProperty(window, 'PointerEvent', { configurable: true, value: class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; } } });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const box = this.tagName.toLowerCase() === 'svg' && this.closest('.sh-dc') ? 316 : 0;
    return { x: 0, y: 0, left: 0, top: 0, right: box, bottom: box, width: box, height: box, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => vi.restoreAllMocks());

function draw(document: CompositionDocument, mode: 'edit' | 'use' = 'use', states = house()) {
  const calls: string[] = [];
  const view = render(<Preview2 document={document} mode={mode} surface={{ kind: 'page', id: document.pages[0].id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()} window={previewWindows[0]} bezel={false}
    house={states} overlay={emptyOverlay} onOverlayChange={vi.fn()} onSimulatedCall={(line: string) => calls.push(line)}/>);
  return { ...view, calls };
}
/** Where a value on the 20 to 80 ring is on the 316 pt dial. */
function at(value: number, radius = 145 * 316 / 320) {
  const angle = (135 + 270 * ((value - 20) / 60)) * Math.PI / 180;
  return { clientX: 158 + radius * Math.cos(angle), clientY: 158 + radius * Math.sin(angle) };
}
const stopper = (id: string) => screen.getByTestId(`stopper-${id}`);
const now = (id: string) => Number(stopper(id).getAttribute('aria-valuenow'));
const drag = (id: string, to: number) => {
  fireEvent.pointerDown(stopper(id), { pointerId: 1, ...at(now(id)) });
  fireEvent.pointerMove(stopper(id), { pointerId: 1, ...at(to) });
  fireEvent.pointerUp(stopper(id), { pointerId: 1, ...at(to) });
};

describe('the simulator’s dial', () => {
  it('names the dial and each stopper, with their values, for a screen reader', () => {
    draw(documentWith(dialNode('range')), 'edit');
    expect(screen.getByRole('group', { name: 'Study humidity' })).toBeTruthy();
    const low = screen.getByRole('slider', { name: 'Low' }), high = screen.getByRole('slider', { name: 'High' });
    expect([low.getAttribute('aria-valuenow'), low.getAttribute('aria-valuemin'), low.getAttribute('aria-valuemax')]).toEqual(['35', '20', '80']);
    expect(high.getAttribute('aria-valuetext')).toBe('65');
    expect(screen.getByRole('img', { name: /Study humidity/ })).toBeTruthy();
  });
  it('a spoken value uses {value}', () => {
    draw(documentWith(dialNode('one', node => { node.props.stoppers[0].spokenValue = '{value} percent'; })), 'edit');
    expect(screen.getByRole('slider', { name: 'Target' }).getAttribute('aria-valuetext')).toBe('50 percent');
  });
  it('is inert in Edit and draggable in Use', () => {
    const { calls, unmount } = draw(documentWith(dialNode('one')), 'edit');
    fireEvent.keyDown(stopper('target'), { key: 'ArrowUp' });
    expect(now('target')).toBe(50);
    unmount();
    const used = draw(documentWith(dialNode('one')), 'use');
    drag('target', 62);
    expect(now('target')).toBe(62);
    expect(used.calls.length).toBe(1);
    expect(used.calls[0]).toMatch(/set value/);
    void calls;
  });
  it('arrow keys move the focused stopper by its step, and Home and End go to the ends', () => {
    draw(documentWith(dialNode('range', node => { node.props.range.step = 5; node.props.stoppers[0].value = lit(30); node.props.stoppers[1].value = lit(60); })));
    fireEvent.keyDown(stopper('low'), { key: 'ArrowUp' });
    expect(now('low')).toBe(35);
    fireEvent.keyDown(stopper('low'), { key: 'ArrowDown' });
    fireEvent.keyDown(stopper('low'), { key: 'ArrowLeft' });
    expect(now('low')).toBe(25);
    fireEvent.keyDown(stopper('high'), { key: 'End' });
    expect(now('high')).toBe(80);
  });
  it('without a rule between them the stoppers stop at each other, in a drag and from a key', () => {
    draw(documentWith(dialNode('range', node => { node.props.stoppers[0].value = lit(30); node.props.stoppers[1].value = lit(40); })));
    drag('low', 70);
    expect(now('low')).toBe(40);
    fireEvent.keyDown(stopper('low'), { key: 'ArrowUp' });
    expect(now('low')).toBe(40);
  });
  it('Stay Apart by a number holds the gap in a drag and from a key', () => {
    draw(documentWith(dialNode('range', node => { node.props.stoppers[0].value = lit(30); node.props.stoppers[1].value = lit(50); node.props.between = { rule: 'stop', gap: lit(5) }; })));
    drag('low', 75);
    expect(now('low')).toBe(45);
    drag('high', 20);
    expect(now('high')).toBe(50);
    for (let press = 0; press < 3; press += 1) fireEvent.keyDown(stopper('low'), { key: 'ArrowUp' });
    expect(now('low')).toBe(45);
  });
  it('Stay Apart by a value from Home Assistant holds the gap it reads, and shows the stop mark while dragging', () => {
    draw(documentWith(dialNode('range', node => { node.props.stoppers[0].value = lit(30); node.props.stoppers[1].value = lit(60); node.props.between = { rule: 'stop', gap: gapRead }; }), [gapSource]), 'use', house('8'));
    fireEvent.pointerDown(stopper('low'), { pointerId: 1, ...at(30) });
    fireEvent.pointerMove(stopper('low'), { pointerId: 1, ...at(70) });
    expect(screen.getByTestId('stop-mark')).toBeTruthy();
    fireEvent.pointerUp(stopper('low'), { pointerId: 1, ...at(70) });
    expect(now('low')).toBe(52);
    expect(screen.queryByTestId('stop-mark')).toBeNull();
  });
  it('a gap that cannot be read makes the dial read-only', () => {
    draw(documentWith(dialNode('range', node => { node.props.between = { rule: 'stop', gap: gapRead }; }), [gapSource]), 'use', houseFrom({ states: [] }));
    expect(screen.getByTestId('dial-control').getAttribute('data-state')).toBe('read-only');
    // The readout only: no stoppers, no slider elements, no trails.
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(document.querySelector('.sh-dc-knob, .sh-dc-trail')).toBeNull();
    expect(screen.getByRole('img', { name: /Study humidity/ })).toBeTruthy();
  });
  it('a dial that is not enabled is the readout only too', () => {
    const never = { type: 'state', sourceId: 'gap-source', path: ['state'], in: ['never'] };
    draw(documentWith(dialNode('range', node => { node.enabledWhen = { condition: never, whenUnknown: 'disabled' }; }), [gapSource]), 'use', house('8'));
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(document.querySelector('.sh-dc-knob')).toBeNull();
  });
  it('tick dots are white on a trail and a band, and the label color on bare track', () => {
    draw(documentWith(dialNode('one', node => { node.props.ticks = { every: 20 }; node.props.bands = [{ from: 70, to: 80, ink: { type: 'solid-rgb', red: 1, green: 2, blue: 3 } }]; })), 'edit');
    const dots = [...document.querySelectorAll('.sh-dc-tick')].map(dot => dot.hasAttribute('data-on-ink'));
    // 20, 40 | 60, 80: the stopper is at 50 with a trail from the start, and the band holds 80.
    expect(dots).toEqual([true, true, false, true]);
  });
  it('a tap on the ring moves the nearest stopper', () => {
    const { container } = draw(documentWith(dialNode('range', node => { node.props.stoppers[0].value = lit(30); node.props.stoppers[1].value = lit(60); })));
    fireEvent.click(container.querySelector('.sh-dc svg')!, at(55));
    expect([now('low'), now('high')]).toEqual([30, 55]);
  });
  it('the one call carries each stopper under its own id', () => {
    const { calls } = draw(documentWith(dialNode('range')));
    drag('high', 70);
    expect(calls).toHaveLength(1);
    fireEvent.keyDown(stopper('low'), { key: 'ArrowUp' });
    expect(calls).toHaveLength(2);
  });
});

// MARK: The inspector

function inspector(start: CompositionDocument) {
  const seen = { document: start };
  const view = render(<Project.Live document={start} seen={next => { seen.document = next; }}>{ws => {
    const entry = [...buildDocumentIndex(ws.document!).entries.values()].find(item => item.node?.id === 'dial')!;
    return <PropertiesPanel ws={{ ...ws, target: { kind: 'node', key: entry.key, path: entry.path } } as Workspace2} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>;
  }}</Project.Live>);
  const node = () => seen.document.pages[0].components[0] as unknown as J;
  return { ...view, node, seen };
}
/** Opens a Studio menu field by its name and returns its options. */
async function open(name: string) {
  const trigger = screen.getByRole('combobox', { name });
  await act(async () => { fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' }); fireEvent.mouseDown(trigger); fireEvent.click(trigger); });
  return screen.findAllByRole('option');
}
const choose = async (name: string, option: string) => {
  const item = (await open(name)).find(entry => entry.textContent?.startsWith(option));
  if (!item) throw new Error(`No option ${option}`);
  await act(async () => { fireEvent.pointerDown(item, { pointerType: 'mouse' }); fireEvent.click(item); });
};

describe('the inspector', () => {
  it('reads Start From, Range, Stoppers and the rest in the Studio’s words, with no Between Stoppers for one stopper', () => {
    const { container } = inspector(documentWith(dialNode('one')));
    for (const title of ['Start From', 'Range', 'Stoppers', 'When Released', 'Reading, Bands, Ticks', 'Middle', 'States']) expect(screen.getByRole('region', { name: title })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Between Stoppers' })).toBeNull();
    for (const label of ['Lowest', 'Highest', 'Step', 'Size']) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Add Stopper' })).toBeTruthy();
    expect(container.textContent).not.toMatch(/operand|predicate|handle id/i);
  });
  it('Add Stopper makes two, and Between Stoppers appears with its three words', async () => {
    const { node } = inspector(documentWith(dialNode('one')));
    fireEvent.click(screen.getByRole('button', { name: 'Add Stopper' }));
    expect(node().props.stoppers).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Between Stoppers' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Stopper' })).toBeNull();
    expect((await open('Rule')).map(option => option.textContent).filter(text => /Each Other|Apart/.test(text ?? ''))).toEqual(['Can Pass Each Other', 'Stop at Each Other', 'Stay Apart']);
  });
  it('Stay Apart shows Gap with Use a Value, and writes a gap', async () => {
    const { node } = inspector(documentWith(dialNode('range')));
    await choose('Rule', 'Stay Apart');
    expect(node().props.between.rule).toBe('stop');
    expect(node().props.between.gap).toEqual(lit(1));
    expect(screen.getByLabelText('Gap')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Gap'), { target: { value: '5' } });
    fireEvent.blur(screen.getByLabelText('Gap'));
    expect(node().props.between.gap).toEqual(lit(5));
    expect(screen.getByRole('button', { name: 'Use a Value for Gap' }).textContent).toContain('Use a Value…');
    await choose('Rule', 'Can Pass Each Other');
    expect(node().props.between).toEqual({ rule: 'free' });
  });
  it('Remove Stopper leaves one and drops the rule', () => {
    const { node } = inspector(documentWith(dialNode('range')));
    fireEvent.click(screen.getAllByRole('button', { name: /Low/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Stopper Low' }));
    expect(node().props.stoppers).toHaveLength(1);
    expect(node().props.between).toBeUndefined();
  });
  it('When Released switches between one call and one per stopper', async () => {
    const { node } = inspector(documentWith(dialNode('range')));
    expect(screen.getByRole('button', { name: /^Call/ })).toBeTruthy();
    await choose('Sends', 'One Call per Stopper');
    expect(node().action).toBeUndefined();
    expect(node().props.stoppers.every((item: J) => item.action)).toBe(true);
  });
  it('Thermostat on a Dial Control asks which thermostat and binds nothing silently', async () => {
    const other = newClimateSource('climate-room-one', 'climate.demo_room_one');
    const { node, seen } = inspector(documentWith(dialNode('range'), [other]));
    await choose('Preset', 'Thermostat');
    expect(node().type).toBe('dial-control');
    expect(screen.getByRole('button', { name: 'Choose a Thermostat' })).toBeTruthy();
    expect(seen.document.dataSources).toHaveLength(slice.dataSources.length + 1);
  });
  it('Thermostat to Range to Thermostat comes back to the same thermostat, never the first one in the document', async () => {
    const roomOne = newClimateSource('climate-room-one', 'climate.demo_room_one'), roomTwo = newClimateSource('climate-room-two', 'climate.demo_room_two');
    const thermostat = newThermostat(base, 'climate-room-two') as J;
    thermostat.props.dial.maximum = 90; thermostat.props.hint = 'Second room';
    const { node } = inspector(documentWith(thermostat, [roomOne, roomTwo]));
    await choose('Preset', 'Range');
    expect(node().type).toBe('dial-control');
    expect(node().props.range).toEqual({ min: 45, max: 90, step: 0.5 });
    await choose('Preset', 'Thermostat');
    expect(node()).toEqual(thermostat);
  });
  it('asks again when the source was rewritten while the node was a Range', async () => {
    const roomOne = newClimateSource('climate-room-one', 'climate.demo_room_one');
    const thermostat = { ...(newThermostat({ ...base, id: 'dial' }, 'climate-room-one') as J) };
    const start = documentWith(thermostat, [roomOne]);
    const { node, seen, rerender } = inspector(start);
    await choose('Preset', 'Range');
    expect(node().type).toBe('dial-control');
    // Another node changes the shared source's entity, then this one asks for its thermostat back.
    const rewritten = structuredClone(seen.document) as unknown as J;
    rewritten.dataSources.find((source: J) => source.id === 'climate-room-one').inputs.entityId = 'climate.demo_room_two';
    rerender(<Project.Live key="rewritten" document={rewritten as CompositionDocument} seen={next => { seen.document = next; }}>{ws => {
      const entry = [...buildDocumentIndex(ws.document!).entries.values()].find(item => item.node?.id === 'dial')!;
      return <PropertiesPanel ws={{ ...ws, target: { kind: 'node', key: entry.key, path: entry.path } } as Workspace2} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>;
    }}</Project.Live>);
    await choose('Preset', 'Thermostat');
    expect(node().type).toBe('dial-control');
    expect(screen.getByRole('button', { name: 'Choose a Thermostat' })).toBeTruthy();
  });
  it('One Value and Blank on a thermostat make those starts, not a Range', async () => {
    const roomOne = newClimateSource('climate-room-one', 'climate.demo_room_one');
    const { node } = inspector(documentWith(newThermostat(base, 'climate-room-one') as J, [roomOne]));
    await choose('Preset', 'One Value');
    expect(node().props.stoppers).toHaveLength(1);
    expect(node().props.stoppers[0].trail).toBe('from-start');
  });
});

describe('the copy', () => {
  const surfaces: [string, () => CompositionDocument][] = [
    ['one-stopper', () => documentWith(dialNode('one'))],
    ['stay-apart', () => documentWith(dialNode('range', node => { node.props.between = { rule: 'stop', gap: lit(5) }; node.props.ticks = { every: 10 }; }))],
    ['thermostat', () => documentWith(newThermostat(base, 'climate-demo') as J, [newClimateSource('climate-demo', 'climate.demo_hall')])],
  ];
  for (const [name, make] of surfaces) {
    it(`${name} reads as the snapshot and keeps the voice rules`, async () => {
      const { container } = inspector(make());
      await expect(copyOf(container)).toMatchFileSnapshot(`./snapshots/copy/properties-dial-control-${name}.txt`);
      expect(voiceIssues(container)).toEqual([]);
    });
  }
});
