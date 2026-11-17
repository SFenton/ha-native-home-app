import { describe, expect, it } from 'vitest';
import deviceControls from '../src/preview2/fixtures/device-controls.json';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { fidtilesStory } from '../src/preview2/fixtures/fidtiles-story';

/** The tile-fidelity story: no compile issue on the pages it adds, and nothing but demo ids (lane `fidtiles`). */
describe('the tile-fidelity story', () => {
  it('adds five pages that compile with no issue of their own', () => {
    const { document } = fidtilesStory();
    const first = deviceControls.document.pages.length;
    const issues = (() => { try { compileCompositionDocument(document); return []; } catch (error) { return (error as { issues?: { pointer: string; code: string }[] }).issues ?? []; } })();
    const mine = issues.filter(issue => {
      const page = /^\/document\/pages\/(\d+)\//.exec(issue.pointer);
      return page ? Number(page[1]) >= first : /\/dataSources\//.test(issue.pointer) && Number(/dataSources\/(\d+)/.exec(issue.pointer)?.[1]) >= deviceControls.document.dataSources.length;
    });
    expect(mine).toEqual([]);
    expect(document.pages.length - first).toBe(5);
    expect(document.modals.some(modal => modal.id === 'modal-fid-lights')).toBe(true);
  });
  it('uses synthetic ids only', () => {
    const own = JSON.stringify(fidtilesStory().document.pages.slice(deviceControls.document.pages.length));
    expect(own).not.toMatch(/"(light|sensor|cover|binary_sensor|input_text|alarm_control_panel)\.(?![a-z0-9_]*demo_)[a-z0-9_]+"/);
  });
});
