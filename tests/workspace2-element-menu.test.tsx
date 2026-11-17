// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { buildDocumentIndex } from '../src/preview2/model';
import ElementContextMenu from '../src/workspace2/ElementContextMenu';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { Project } from './support/workspace2-surfaces';

afterEach(cleanup);
const home = homeDomains.document as unknown as CompositionDocument;
const index = buildDocumentIndex(home);
const nodes = [...index.entries.values()].filter(entry => entry.node && entry.key.startsWith('node:'));
const chosen = nodes.find(entry => entry.node!.type === 'status-chip')!;

/** A stage with the chosen node and the page drawn the way the preview marks them, and the menu listening to it. */
function Stage({ mode, onSelect, extra }: { mode: 'edit' | 'use'; onSelect: (key: string | undefined) => void; extra?: Record<string, unknown> }) {
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const ws = Project.workspace(home, undefined, { extra: { mode, select: onSelect, ...extra } });
  return <>
    <div ref={setStage} data-testid="stage">
      <div data-sel={`page:${home.navigation.initialPageId}`} data-testid="page"><div data-sel={chosen.key} data-testid="tile">{chosen.node!.title}</div>
        <button type="button" data-passthrough data-sel={chosen.key} data-testid="pass">pass</button></div>
    </div>
    <ElementContextMenu ws={ws} stage={stage} onError={() => {}}/>
  </>;
}

describe('G14: the right-click menu on the simulator', () => {
  it('in Edit, a right-click on an element selects it and opens its More menu with the same items as the ••• button', async () => {
    const select = vi.fn();
    render(<Stage mode="edit" onSelect={select}/>);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
    screen.getByTestId('tile').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(select).toHaveBeenCalledWith(chosen.key);
    const menu = await screen.findByTestId('element-menu');
    const items = within(menu).getAllByRole('menuitem').map(item => item.textContent);
    expect(items).toEqual(['Duplicate', 'Move Up', 'Move Down', 'Save as Template…', 'Delete']);
  });

  it('runs the item\'s action: Duplicate applies a document with one more node', async () => {
    const apply = vi.fn();
    render(<Stage mode="edit" onSelect={() => {}} extra={{ studio: { apply } }}/>);
    screen.getByTestId('tile').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it('in Use, a right-click does nothing special: no menu, no selection, the browser\'s own default', () => {
    const select = vi.fn();
    render(<Stage mode="use" onSelect={select}/>);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getByTestId('tile').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByTestId('element-menu')).toBeNull();
  });

  it('ignores the contextmenu a touch long press raises, which belongs to the touch drag', () => {
    render(<Stage mode="edit" onSelect={() => {}}/>);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerType', { value: 'touch' });
    screen.getByTestId('tile').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId('element-menu')).toBeNull();
  });

  it('leaves a page, and a passthrough control, to the browser', () => {
    render(<Stage mode="edit" onSelect={() => {}}/>);
    for (const id of ['page', 'pass']) {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      screen.getByTestId(id).dispatchEvent(event);
      expect(event.defaultPrevented, id).toBe(false);
    }
    expect(screen.queryByTestId('element-menu')).toBeNull();
  });

  it('Shift+F10 opens the menu for the selected element', async () => {
    const target = { kind: 'node', key: chosen.key, path: chosen.path };
    function Keyed() {
      const [stage, setStage] = useState<HTMLElement | null>(null);
      const ws = Project.workspace(home, target as never, { extra: { mode: 'edit' } });
      return <><div ref={setStage} data-testid="stage"><div data-sel={chosen.key}>{chosen.node!.title}</div></div><ElementContextMenu ws={ws} stage={stage} onError={() => {}}/></>;
    }
    render(<Keyed/>);
    const event = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    screen.getByTestId('stage').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByTestId('element-menu')).toBeTruthy();
  });
});
