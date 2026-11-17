// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { replaceAt, valueAt, type EditorPath } from '../src/composition-editor';
import type { AlertSpec } from '../src/preview2/alert';
import { buildDocumentIndex } from '../src/preview2/model';
import { PushStack } from '../src/workspace2/kit';
import { RowsProvider, schemaAt } from '../src/workspace2/rows';
import { ActionRow } from '../src/workspace2/editors/ActionEditor';
import { askOf, askProblem, askSummary, withAsk as withAskTyped } from '../src/workspace2/editors/action';
import { AlertPreviewContext } from '../src/workspace2/editors/alertPreview';
import { copyOf, voiceIssues } from './support/copy';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const home = homeDomains.document as unknown as CompositionDocument;
const tile = [...buildDocumentIndex(home).entries.values()].find(entry => entry.node?.type === 'navigation-tile')!;
const actionPath: EditorPath = [...tile.path, 'action'];

const call = { type: 'call-service', domain: 'light', service: 'turn_off', target: { entity_id: { type: 'literal', value: 'light.demo_guest_room' } } };
const domain = { type: 'domain', sourceId: home.dataSources[0].id, intent: 'power.toggle', feedback: 'policy', confirmation: { type: 'policy' } };
/** `withAsk` over a loosely typed action, so a test can read the confirmation it wrote. */
const withAsk = (action: object, change: Parameters<typeof withAskTyped>[1], itemName?: string) => withAskTyped(action as { type: string }, change, itemName) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const withAction = (action: unknown) => replaceAt(home, actionPath, action) as CompositionDocument;

/** The "When tapped" row in a pushed-page surface, with the document live so each Done shows in the next render. */
function Surface({ action, onPublish }: { action: unknown; onPublish?: (alert: AlertSpec | undefined) => void }) {
  const [document, setDocument] = useState(withAction(action));
  const ctx = { document, onChange: setDocument, onError: () => {} };
  return <AlertPreviewContext.Provider value={onPublish}><RowsProvider value={ctx}>
    <PushStack rootTitle="Tile" root={<>
      <ActionRow label="When tapped" path={actionPath} schema={schemaAt(document, actionPath)} optional itemName="Guest Room" boundSourceId={home.dataSources[0].id}/>
      <output data-testid="doc">{JSON.stringify(valueAt(document, actionPath))}</output>
    </>}/>
  </RowsProvider></AlertPreviewContext.Provider>;
}
const saved = () => JSON.parse(screen.getByTestId('doc').textContent!);
const openAsk = () => { fireEvent.click(screen.getByRole('button', { name: /When tapped/ })); fireEvent.click(document.querySelector('[data-disclosure="ask-first"]')!); };
const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

describe('pick 5: the Ask First row and its words', () => {
  it('summarises as Off, or as the alert title', () => {
    expect(askSummary(call as never)).toBe('Off');
    expect(askSummary(withAsk(call, 'on', 'Guest Room') as never)).toBe('Turn Off Guest Room?');
    expect(askOf(domain as never)).toBeUndefined();
  });

  it('turns on with the tile defaults, keeps Cancel literal, and turns the domain action back to policy when off', () => {
    const on = withAsk(call, 'on', 'Guest Room');
    expect(on.confirmation).toEqual({ type: 'additional', style: 'alert', title: 'Turn Off Guest Room?', confirmLabel: 'Turn Off', cancelLabel: 'Cancel', destructive: false });
    expect((withAsk(on, { message: '' })).confirmation).not.toHaveProperty('message');
    expect(withAsk(on, { cancelLabel: 'Nope' as 'Cancel' }).confirmation).toHaveProperty('cancelLabel', 'Cancel');
    expect(withAsk(on, 'off')).not.toHaveProperty('confirmation');
    expect(withAsk({ ...domain, confirmation: askOf(withAsk(domain, 'on') as never) as never }, 'off').confirmation).toEqual({ type: 'policy' });
  });

  it('says what is missing', () => {
    expect(askProblem(withAsk(call, { title: ' ' }) as never)).toBe('Add a title.');
    expect(askProblem(withAsk(call, { confirmLabel: '' }) as never)).toBe('Add a button label.');
    expect(askProblem(call as never)).toBeUndefined();
  });
});

describe('pick 5: the Ask First page', () => {
  it('opens inside the inspector, not a dialog, and shows its rows only while on', () => {
    render(<Surface action={call}/>);
    openAsk();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Ask First' })).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    expect(field('Title').value).toBe('Turn Off Guest Room?');
    expect(field('Button').value).toBe('Turn Off');
    expect(field('Message').placeholder).toBe('Optional');
    const cancel = screen.getByTestId('ask-cancel');
    expect(cancel.textContent).toBe('Cancel');
    expect(cancel.querySelector('input')).toBeNull();
    expect(screen.getByText('The app always says Cancel.')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Red button' })).toBeTruthy();
  });

  it('needs a Title and a Button: a caption under the field and Done is disabled', () => {
    render(<Surface action={call}/>);
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    const row = document.querySelector('[data-disclosure="ask-first"]') as HTMLElement;
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    fireEvent.change(field('Title'), { target: { value: '' } });
    expect(screen.getByText('Add a title.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    expect((screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(document.querySelector('[data-disclosure="ask-first"]') as HTMLElement).getByText('Add a title.')).toBeTruthy();
  });

  it('draws a picture of the alert that follows typing, red with Red button', () => {
    render(<Surface action={call}/>);
    openAsk();
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    const picture = screen.getByRole('figure', { name: 'A picture of the alert' });
    expect(within(picture).getByText('Turn Off Guest Room?')).toBeTruthy();
    fireEvent.change(field('Title'), { target: { value: 'Switch it off?' } });
    fireEvent.change(field('Message'), { target: { value: 'Everyone in the room will notice.' } });
    expect(within(picture).getByText('Switch it off?')).toBeTruthy();
    expect(within(picture).getByText('Everyone in the room will notice.')).toBeTruthy();
    expect(picture.querySelector('[data-destructive]')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Red button' }));
    expect(picture.querySelector('[data-destructive]')).toBeTruthy();
    expect(within(picture).getAllByRole('button', { hidden: true }).map(button => button.textContent)).toEqual(['Cancel', 'Turn Off']);
  });

  it('writes the same confirmation shape for a service call and an on-or-off action', () => {
    const shapes: unknown[] = [];
    for (const action of [call, domain]) {
      render(<Surface action={action}/>);
      openAsk();
      fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
      fireEvent.change(field('Title'), { target: { value: 'Sure?' } });
      fireEvent.click(screen.getByRole('switch', { name: 'Red button' }));
      fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      shapes.push(saved().confirmation);
      cleanup();
    }
    expect(shapes[0]).toEqual({ type: 'additional', style: 'alert', title: 'Sure?', confirmLabel: 'Turn Off', cancelLabel: 'Cancel', destructive: true });
    expect(shapes[1]).toEqual(shapes[0]);
  });

  it('publishes the alert to the simulator while a field has focus, and drops it 150 ms after focus leaves', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    render(<Surface action={call} onPublish={publish}/>);
    openAsk();
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    publish.mockClear();
    act(() => { field('Title').focus(); });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Turn Off Guest Room?', cancelLabel: 'Cancel', destructive: false }));
    // Moving between fields does not blink.
    publish.mockClear();
    act(() => { field('Button').focus(); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(publish).not.toHaveBeenCalledWith(undefined);
    fireEvent.change(field('Button'), { target: { value: 'Switch Off' } });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'Switch Off' }));
    act(() => { field('Button').blur(); });
    act(() => { vi.advanceTimersByTime(149); });
    expect(publish).not.toHaveBeenLastCalledWith(undefined);
    act(() => { vi.advanceTimersByTime(2); });
    expect(publish).toHaveBeenLastCalledWith(undefined);
  });

  it('cancels with the footer Cancel and applies with Done, as one change', () => {
    render(<Surface action={call}/>);
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(document.querySelector('[data-disclosure="ask-first"]')!);
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(saved().confirmation).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    fireEvent.click(document.querySelector('[data-disclosure="ask-first"]')!);
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    fireEvent.click(screen.getByRole('button', { name: /When tapped/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(saved().confirmation.type).toBe('additional');
  });
});

describe('pick 5: the Ask First page copy', () => {
  it('reads as the snapshot and keeps to the voice rules', async () => {
    const { container } = render(<Surface action={call}/>);
    openAsk();
    fireEvent.click(screen.getByRole('switch', { name: 'Ask first' }));
    await expect(copyOf(container)).toMatchFileSnapshot('./snapshots/copy/ask-first.txt');
    expect(voiceIssues(container)).toEqual([]);
  });
});
