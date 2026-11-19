import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { compositionWarnings } from '../src/shared/composition/lints';
import { pendingCompositionCapabilities } from '../src/shared/composition/pending';
import {
  defaultControls, effectiveControls, hasLocate, locateButton, surfaceControlsSchema, surfaceOrientationSchema, withControls, type SurfaceButton, type SurfaceControls,
} from '../src/shared/composition/surface-controls';
import { addButton, freshId, moveToCorner, moveWithin, nudge, placeOf, removeButton, setAxis, updateButton } from '../src/shared/composition/surface-controls-edit';
import { controlFamilies, fitMapControls, overflowByFamily, overflowNotices, type FitGroup } from '../src/shared/composition/surface-controls-fit';
import { vacuumDocument } from './fixtures/vacuum';

/**
 * vacuum-map-ctl, the Studio contract lane: `sh.surface-orientation@1` and `sh.surface-controls@1` (shared shapes), the default, the validation, the
 * fit rule and the edits the inspector makes. The corpora pin the decode answers; these pin the rest.
 */
const icon = { type: 'sf-symbol', name: 'star', rendering: 'canonical', unavailable: 'fallback' } as const;
const toggle = { type: 'call-service', domain: 'light', service: 'toggle', target: { entity_id: { type: 'literal', value: 'light.demo_kitchen' } } } as const;
const button = (id: string, label = id, action: SurfaceButton['action'] = toggle, rest: Partial<SurfaceButton> = {}): SurfaceButton => ({ id, icon, label, action, ...rest });
const group = (corner: SurfaceControls[number]['corner'], axis: 'row' | 'column', ...buttons: SurfaceButton[]): SurfaceControls[number] => ({ corner, axis, buttons });

function mapDocument(controls?: SurfaceControls, locate = false, orientation?: { flipHorizontal: boolean; flipVertical: boolean }, areaCleaning = true) {
  const document = vacuumDocument({ kind: 'map', overlay: 'rooms', height: 300, runtimeHeight: 400, label: 'Map', loadingText: 'Loading', unavailableText: 'Unavailable', locate, ...(controls ? { controls } : {}) });
  const source = document.dataSources[0];
  if (source.kind !== 'model' || source.model !== 'vacuum@1') throw Error('Expected a vacuum');
  if (orientation) source.inputs.orientation = orientation;
  if (!areaCleaning) delete source.inputs.areaCleaning;
  return document;
}
const compile = (document: ReturnType<typeof mapDocument>) => compileCompositionDocument(document);
const issues = (document: ReturnType<typeof mapDocument>): string[] => {
  try { compile(document); return []; } catch (error) {
    if (!(error instanceof CompositionValidationError)) throw error;
    return error.issues.map(issue => `${issue.code} ${issue.pointer.replace(/^.*primitive/, '~')}`);
  }
};

describe('the shipped ids', () => {
  it('no longer lists either id as pending', () => {
    expect(pendingCompositionCapabilities).not.toContain('sh.surface-orientation@1');
    expect(pendingCompositionCapabilities).not.toContain('sh.surface-controls@1');
  });
  it('declares nothing new for a map without them', () => {
    const capabilities = compile(mapDocument(undefined, true)).capabilities;
    expect(capabilities).not.toContain('sh.surface-orientation@1');
    expect(capabilities).not.toContain('sh.surface-controls@1');
  });
  it('needs the orientation id for an orientation object, even with both flips off', () => {
    expect(compile(mapDocument(undefined, true, { flipHorizontal: true, flipVertical: false })).capabilities).toContain('sh.surface-orientation@1');
    expect(compile(mapDocument(undefined, true, { flipHorizontal: false, flipVertical: false })).capabilities).toContain('sh.surface-orientation@1');
  });
  it('needs the controls id for `controls`, and the vacuum controls id for a source command', () => {
    const plain = compile(mapDocument([group('top-trailing', 'row', button('a'))])).capabilities;
    expect(plain).toContain('sh.surface-controls@1');
    expect(plain).not.toContain('sh.surface-orientation@1');
    const command = compile(mapDocument([group('top-trailing', 'row', button('dock', 'Dock', { type: 'source-command', command: 'dock' }))])).capabilities;
    expect(command).toContain('sh.vacuum-controls@1');
  });
  it('needs the tile button rules id for a symbol or label that follows a rule', () => {
    expect(compile(mapDocument([group('top-trailing', 'row', button('a'))])).capabilities).not.toContain('sh.tile-disc-rules@1');
    const ruled = button('a', 'A', toggle, { label: { type: 'expr', value: { type: 'literal', value: 'Go' } } });
    expect(compile(mapDocument([group('top-trailing', 'row', ruled)])).capabilities).toContain('sh.tile-disc-rules@1');
  });
});

describe('the shared schemas', () => {
  it('are shared shapes, not inside vacuum.ts', () => {
    expect(surfaceOrientationSchema.safeParse({ flipHorizontal: true, flipVertical: false }).success).toBe(true);
    expect(surfaceControlsSchema.safeParse([group('top-leading', 'row', button('a'))]).success).toBe(true);
  });
  it('refuse more than four groups, more than eight buttons and an empty group', () => {
    expect(surfaceControlsSchema.safeParse(['top-leading', 'top-trailing', 'bottom-leading', 'bottom-trailing', 'top-leading'].map((corner, i) => group(corner as never, 'row', button(`b${i}`)))).success).toBe(false);
    expect(surfaceControlsSchema.safeParse([group('top-leading', 'row', ...Array.from({ length: 9 }, (_, i) => button(`b${i}`)))]).success).toBe(false);
    expect(surfaceControlsSchema.safeParse([group('top-leading', 'row')]).success).toBe(false);
  });
  it('keep the corners to leading and trailing, never left and right or centre', () => {
    expect(surfaceControlsSchema.safeParse([{ ...group('top-leading', 'row', button('a')), corner: 'top-left' }]).success).toBe(false);
    expect(surfaceControlsSchema.safeParse([{ ...group('top-leading', 'row', button('a')), corner: 'center' }]).success).toBe(false);
  });
});

describe('validation', () => {
  it('accepts a mixed set: a map action, a source command, a service call and a page', () => {
    const page = { type: 'push', pageId: 'ignored', arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } as const;
    const document = mapDocument([group('top-trailing', 'row', button('locate', 'Locate', { type: 'map', command: 'locate' }), button('dock', 'Dock', { type: 'source-command', command: 'dock' }), button('lights', 'Lights'), button('plan', 'Plan', { ...page, pageId: 'demo-page' } as never))], true);
    document.pages.push({ ...document.pages[0], id: 'demo-page', title: 'Demo Page', components: [] });
    expect(issues(document)).toEqual([]);
  });
  it('refuses two groups in one corner, a duplicate id across groups, and a second Locate', () => {
    expect(issues(mapDocument([group('top-leading', 'row', button('a')), group('top-leading', 'column', button('b'))]))).toEqual(['duplicate_id ~/controls/1/corner']);
    expect(issues(mapDocument([group('top-leading', 'row', button('a')), group('top-trailing', 'row', button('a'))]))).toEqual(['duplicate_id ~/controls/1/buttons/0/id']);
    const locate = (id: string) => button(id, 'Locate', { type: 'map', command: 'locate' });
    expect(issues(mapDocument([group('top-leading', 'row', locate('a'), locate('b'))], true))).toEqual(['invalid_combination ~/controls/0/buttons/1/action']);
  });
  it('keeps `locate` truthful: true exactly when a Locate button is authored', () => {
    const locate = button('locate', 'Locate', { type: 'map', command: 'locate' });
    expect(issues(mapDocument([group('top-leading', 'row', locate)], true))).toEqual([]);
    expect(issues(mapDocument([group('top-leading', 'row', locate)], false))).toEqual(['invalid_combination ~/locate']);
    expect(issues(mapDocument([group('top-leading', 'row', button('a'))], true))).toEqual(['invalid_combination ~/locate']);
    expect(issues(mapDocument([group('top-leading', 'row', button('a'))], false))).toEqual([]);
  });
  it('refuses a blank label and a source command the vacuum does not support', () => {
    expect(issues(mapDocument([group('top-leading', 'row', button('a', ' '))])).length).toBe(1);
    expect(issues(mapDocument([group('top-leading', 'row', button('a', 'A', { type: 'source-command', command: 'cleanArea' }))], false, undefined, false))).toEqual(['invalid_combination ~/controls/0/buttons/0/action/command']);
    expect(issues(mapDocument([group('top-leading', 'row', button('a', 'A', { type: 'source-command', command: 'cleanArea' }))]))).toEqual([]);
  });
  it('gives a map action and a source command no visibleWhen or enabledWhen: their state rules are the app\'s', () => {
    const when = { type: 'compare', op: 'eq', left: { type: 'literal', value: 'a' }, right: { type: 'literal', value: 'a' } } as never;
    expect(issues(mapDocument([group('top-leading', 'row', button('a', 'A', { type: 'source-command', command: 'dock' }, { visibleWhen: when }))]))).toEqual(['invalid_combination ~/controls/0/buttons/0/visibleWhen']);
    expect(issues(mapDocument([group('top-leading', 'row', button('a', 'A', toggle, { visibleWhen: when }))]))).toEqual([]);
  });
});

describe('the default', () => {
  it('derives one top leading column holding Locate from `locate`, and nothing when it is false', () => {
    expect(effectiveControls({ locate: true })).toEqual([{ corner: 'top-leading', axis: 'column', buttons: [locateButton] }]);
    expect(effectiveControls({ locate: false })).toEqual([]);
    expect(locateButton).toMatchObject({ id: 'locate', label: 'Locate', hint: 'Asks the robot to play a sound.', action: { type: 'map', command: 'locate' } });
  });
  it('writes controls back canonically: dropped when empty or exactly the default, and `locate` follows the buttons', () => {
    const map = { locate: true } as { locate: boolean; controls?: SurfaceControls };
    expect(withControls(map, defaultControls(true))).toEqual({ locate: true });
    expect(withControls(map, [])).toEqual({ locate: false });
    const own = [group('bottom-trailing', 'row', button('a'))];
    expect(withControls(map, own)).toEqual({ locate: false, controls: own });
    expect(hasLocate(withControls(map, [group('top-leading', 'row', locateButton, button('a'))]).controls!)).toBe(true);
  });
});

describe('the fit rule', () => {
  const g = (corner: FitGroup['corner'], axis: FitGroup['axis'], count: number): FitGroup => ({ corner, axis, count });
  const run = (width: number, height: number, ...groups: FitGroup[]) => fitMapControls({ width, height }, groups).map(item => [item.corner, item.shown, item.more ? item.hidden : 0]);
  it('shows everything that fits', () => {
    expect(run(343, 300, g('top-leading', 'column', 1))).toEqual([['top-leading', 1, 0]]);
    expect(run(343, 300, g('top-trailing', 'row', 5))).toEqual([['top-trailing', 5, 0]]);
    expect(run(343, 300, g('top-leading', 'row', 3), g('top-trailing', 'row', 3))).toEqual([['top-leading', 3, 0], ['top-trailing', 3, 0]]);
  });
  it('keeps k minus one buttons and More when a group does not fit', () => {
    expect(run(343, 300, g('top-trailing', 'row', 8))).toEqual([['top-trailing', 6, 2]]);
    expect(run(120, 300, g('top-trailing', 'row', 3))).toEqual([['top-trailing', 1, 2]]);
  });
  it('counts a group of one as a column, and never fewer than the More button', () => {
    expect(run(40, 300, g('top-leading', 'row', 1))).toEqual([['top-leading', 1, 0]]);
    expect(run(40, 300, g('top-leading', 'row', 2))).toEqual([['top-leading', 0, 2]]);
  });
  it('takes the crossing neighbour\'s one button first', () => {
    expect(run(200, 300, g('top-trailing', 'row', 3), g('top-leading', 'column', 2))).toEqual([['top-trailing', 1, 2], ['top-leading', 2, 0]]);
  });
  it('splits an edge in halves between two groups along it, and gives a short one\'s remainder to the other', () => {
    // The smallest card is 124 pt tall: two columns on one edge each get 48 pt, one button's room, so each shows More alone.
    expect(run(343, 124, g('top-leading', 'column', 2), g('bottom-leading', 'column', 2))).toEqual([['top-leading', 0, 2], ['bottom-leading', 0, 2]]);
    // total 96: the short group needs 44 (under half), the long one gets 96 - 44 = 52, one button's room.
    expect(run(343, 124, g('top-leading', 'column', 1), g('bottom-leading', 'column', 3))).toEqual([['top-leading', 1, 0], ['bottom-leading', 0, 3]]);
    // total 303 on 331: the short row keeps its 132, the long one gets 303 - 132 = 171, three buttons' room.
    expect(run(331, 300, g('top-leading', 'row', 3), g('top-trailing', 'row', 6))).toEqual([['top-leading', 3, 0], ['top-trailing', 2, 4]]);
  });
  it('is the same for a group whatever the order of the list', () => {
    const a = run(331, 300, g('top-leading', 'row', 3), g('top-trailing', 'row', 6)).sort();
    const b = run(331, 300, g('top-trailing', 'row', 6), g('top-leading', 'row', 3)).sort();
    expect(a).toEqual(b);
  });
});

describe('the warning for each family', () => {
  const eight = [group('top-trailing', 'row', ...Array.from({ length: 8 }, (_, i) => button(`b${i}`)))];
  const counts = (controls: SurfaceControls, height = 300) => Object.fromEntries(overflowByFamily({ locate: false, controls, height }).map(item => [item.family, item.hidden]));
  it('lists the families the author is warned about, smallest iPhone through the iPad', () => {
    expect(controlFamilies.map(item => item.id)).toEqual(['iphone-small', 'iphone', 'iphone-largest', 'duo-folded', 'duo-open', 'ipad']);
    expect(controlFamilies.map(item => item.width)).toEqual([375, 402, 440, 466, 669, 834]);
  });
  it('counts the buttons that move into More on each family', () => {
    expect(counts(eight)).toEqual({ 'iphone-small': 2 });
    const wide = [group('top-trailing', 'row', ...Array.from({ length: 8 }, (_, i) => button(`b${i}`))), group('bottom-trailing', 'row', ...Array.from({ length: 8 }, (_, i) => button(`c${i}`)))];
    expect(counts(wide)).toEqual({ 'iphone-small': 4 });
    const column = [group('top-leading', 'column', ...Array.from({ length: 8 }, (_, i) => button(`b${i}`)))];
    // A column's room is the card's height: 200 pt leaves 184, four buttons' room, so three show and five move, on every width.
    expect(counts(column, 200)).toEqual({ 'iphone-small': 5, iphone: 5, 'iphone-largest': 5, 'duo-folded': 5, 'duo-open': 5, ipad: 5 });
  });
  it('says nothing for the default Locate or a group that fits', () => {
    expect(overflowNotices({ locate: true, height: 100 })).toEqual([]);
    expect(overflowNotices({ locate: false, height: 300, controls: [group('top-leading', 'row', button('a'), button('b'))] })).toEqual([]);
  });
  it('words a notice as a note naming the family, the count and the corner', () => {
    expect(overflowNotices({ locate: false, height: 300, controls: eight })).toEqual(['On the smallest iPhone, 2 buttons move into More (Top Trailing).']);
    expect(overflowNotices({ locate: false, height: 300, controls: [group('top-trailing', 'row', ...Array.from({ length: 7 }, (_, i) => button(`b${i}`)))] })).toEqual([]);
  });
  it('reaches the Checks as non-blocking warnings, never an error', () => {
    const document = mapDocument(eight);
    expect(issues(document)).toEqual([]);
    expect(compositionWarnings(document).map(item => item.message)).toEqual(['On the smallest iPhone, 2 buttons move into More (Top Trailing).']);
  });
});

describe('the edits', () => {
  const start = [group('top-leading', 'column', button('a'), button('b'), button('c')), group('bottom-trailing', 'row', button('d'))];
  const ids = (controls: SurfaceControls) => controls.map(item => `${item.corner}:${item.buttons.map(entry => entry.id).join(',')}`);
  it('adds a button last in a corner, starting a column when the corner is empty, in screen order', () => {
    expect(ids(addButton(start, 'top-leading', button('e')))).toEqual(['top-leading:a,b,c,e', 'bottom-trailing:d']);
    const next = addButton(start, 'top-trailing', button('e'));
    expect(ids(next)).toEqual(['top-leading:a,b,c', 'top-trailing:e', 'bottom-trailing:d']);
    expect(next[1].axis).toBe('column');
  });
  it('reorders within a corner by position and by one step, clamped', () => {
    expect(ids(moveWithin(start, 'c', 0))).toEqual(['top-leading:c,a,b', 'bottom-trailing:d']);
    expect(ids(nudge(start, 'a', 1))).toEqual(['top-leading:b,a,c', 'bottom-trailing:d']);
    expect(ids(nudge(start, 'a', -1))).toEqual(['top-leading:a,b,c', 'bottom-trailing:d']);
    expect(placeOf(nudge(start, 'a', 1), 'a')).toEqual({ corner: 'top-leading', index: 1, count: 3 });
  });
  it('moves a button to another corner, last, and drops the corner it empties', () => {
    expect(ids(moveToCorner(start, 'd', 'top-leading'))).toEqual(['top-leading:a,b,c,d']);
    expect(ids(moveToCorner(start, 'a', 'bottom-leading'))).toEqual(['top-leading:b,c', 'bottom-leading:a', 'bottom-trailing:d']);
    expect(moveToCorner(start, 'a', 'top-leading')).toBe(start);
  });
  it('removes a button, and a corner with its last one', () => {
    expect(ids(removeButton(start, 'b'))).toEqual(['top-leading:a,c', 'bottom-trailing:d']);
    expect(ids(removeButton(start, 'd'))).toEqual(['top-leading:a,b,c']);
  });
  it('changes an axis and a button, and makes ids that are free', () => {
    expect(setAxis(start, 'top-leading', 'row')[0].axis).toBe('row');
    expect(updateButton(start, 'a', { label: 'Renamed' })[0].buttons[0].label).toBe('Renamed');
    expect(freshId(start, 'a')).toBe('a-2');
    expect(freshId(start, 'z')).toBe('z');
  });
});
