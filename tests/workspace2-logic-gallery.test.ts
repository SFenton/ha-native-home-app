import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { evaluateOperand, evaluatePredicate, type Environment } from '../src/shared/composition/evaluator';
import { assertNoLogic, expandLogic } from '../src/shared/composition/logic-library';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { useCount } from '../src/workspace2/data/logic/logicModel';

/** The Logic Gallery sample: three logic templates on nine places, over invented demo_ entities only. */
const sample = JSON.parse(readFileSync(new URL('../src/preview2/fixtures/logic-gallery.json', import.meta.url), 'utf8')) as { document: CompositionDocument };
type J = Record<string, any>;
const env = (states: Record<string, string>, person: string, minute: number): Environment => ({
  read: (id: string, path: string[]) => path[0] === 'minuteOfDay' ? { status: 'value', value: minute } : id in states ? { status: 'value', value: states[id] } : { status: 'unavailable' },
  viewer: { personEntityId: person },
} as unknown as Environment);
const plain = () => expandLogic(sample.document).document as J;
const tiles = () => plain().pages[0].components[0].children;
const text = (slot: J, e: Environment) => { const out = evaluateOperand(slot.type === 'expr' ? slot.value : slot, e); return out.status === 'value' ? out.value : out.status; };

describe('the Logic Gallery sample', () => {
  it('compiles, and its publication holds plain logic only', () => {
    const compiled = compileCompositionDocument(sample.document);
    expect(() => assertNoLogic(compiled.expanded)).not.toThrow();
    expect(JSON.stringify(compiled.expanded)).not.toMatch(/logic-ref|"hole"|logicLibrary/);
  });
  it('holds three templates, each used on three places, and no house data', () => {
    expect(sample.document.logicLibrary!.map(entry => entry.name)).toEqual(['Count or All', 'Yours or Theirs', 'Night Hours']);
    for (const entry of sample.document.logicLibrary!) expect(useCount(sample.document, entry.id)).toBe(3);
    const entityIds = JSON.stringify(sample.document).match(/"(?:switch|light|person|binary_sensor|sensor)\.[a-z0-9_]+"/g) ?? [];
    expect(entityIds.length).toBeGreaterThan(0);
    for (const id of entityIds) expect(id).toMatch(/\.demo_/);
  });
  it('says 3 On, 1 Open and All Closed, and counts in place as switches change', () => {
    const on = env({ 'demo-light-1': 'on', 'demo-light-2': 'on', 'demo-light-3': 'on', 'demo-door': 'on', 'demo-window': 'off' }, 'person.demo_sam', 600);
    expect(tiles().map((tile: J) => text(tile.props.subtitle, on))).toEqual(['3 On', '1 Open', 'All Closed']);
    const off = env({ 'demo-light-1': 'on', 'demo-light-2': 'off', 'demo-light-3': 'off', 'demo-door': 'off', 'demo-window': 'off' }, 'person.demo_sam', 600);
    expect(tiles().map((tile: J) => text(tile.props.subtitle, off))).toEqual(['1 On', 'All Closed', 'All Closed']);
    const none = env({ 'demo-light-1': 'off', 'demo-light-2': 'off', 'demo-light-3': 'off', 'demo-door': 'off', 'demo-window': 'off' }, 'person.demo_sam', 600);
    expect(text(tiles()[0].props.subtitle, none)).toBe('All Off');
  });
  it('says Your for the person using the app and a name for the others', () => {
    const rows = plain().pages[0].components[1].children;
    const sam = env({}, 'person.demo_sam', 600), alex = env({}, 'person.demo_alex', 600);
    expect(rows.map((row: J) => text(row.props.primary, sam))).toEqual(['Your Chores', 'Alex’s Chores', 'Your Side']);
    expect(rows.map((row: J) => text(row.props.primary, alex))).toEqual(['Sam’s Chores', 'Your Chores', 'Sam’s Side']);
  });
  it('is night from 10:00 PM to 7:00 AM, shows and hides the banner and the chime row in place', () => {
    const banner = plain().pages[0].components[2], chime = plain().pages[0].components[3].children[0], value = plain().pages[0].components[3].children[1];
    const at = (minute: number) => env({}, 'person.demo_sam', minute);
    for (const [minute, night] of [[23 * 60, true], [3 * 60, true], [12 * 60, false], [20 * 60, false]] as const) {
      expect(evaluatePredicate(banner.visibleWhen, at(minute))).toBe(night ? 'yes' : 'no');
      expect(evaluatePredicate(chime.enabledWhen.condition, at(minute))).toBe(night ? 'no' : 'yes');
      expect(text(value.props.value, at(minute))).toBe(night ? 'Off Until 7:00 AM' : 'On');
    }
  });
});
