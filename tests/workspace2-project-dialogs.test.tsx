// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { DialogBody, type DialogKey } from '../src/workspace2/projectDialogs';
import { previewNote } from '../src/workspace2/dialogs/Help';
import { newLocalState, renameLocalState, startingState } from '../src/workspace2/dialogs/states';
import { modelChoices, modelName, removeUnusedSources, sourceName, sourceUses } from '../src/workspace2/dialogs/sources';
import { ToastHost } from '../src/workspace2/toasts';
import { wallpaperImage } from '../src/preview2/wallpaper';
import type { HaPublicationSummary } from '../src/ha-publication';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/api', () => ({ apiUrl: (path: string) => path, request: api.request }));

afterEach(cleanup);
beforeEach(() => { api.request.mockReset(); });
const base = homeDomains.document as unknown as CompositionDocument;

/** A dialog body against a document the dialog itself edits; `seen` receives each edit. */
function Dialog({ dialog, document = base, stub, seen }: { dialog: DialogKey; document?: CompositionDocument; stub?: Parameters<typeof Project.workspace>[2]; seen?: (document: CompositionDocument) => void }) {
  return <ToastHost><Project.Live document={document} stub={stub} seen={seen}>{ws => <DialogBody dialog={dialog} ws={ws} close={() => {}} onError={() => {}}/>}</Project.Live></ToastHost>;
}

describe('Data', () => {
  const sample = (kind: 'used' | 'unused'): CompositionDocument => {
    const unused = { id: 'lonely-weather', kind: 'model', model: 'home-weather@1', inputs: { weatherEntityId: { type: 'literal', value: 'weather.demo_home' }, units: 'source@1' } };
    return { ...base, dataSources: kind === 'unused' ? [...base.dataSources, unused as never] : base.dataSources };
  };
  it('names models in the app\'s words and counts what reads each source', () => {
    expect(modelName('home-status@1')).toBe('Home status');
    expect(modelName('home-weather@1')).toBe('Weather');
    expect(modelName('camera-stream@1')).toBe('Camera');
    expect(modelName('some-new-model@2')).toBe('Some new model');
    const document = sample('unused');
    const uses = sourceUses(document);
    expect(uses.get('lonely-weather')).toBe(0);
    expect(uses.get('home-weather')).toBeGreaterThan(0);
    expect(sourceName(document.dataSources.find(source => source.id === 'home-weather')!)).toBe('Weather');
  });

  it('groups sources under Entities and Models with their id and "Used by n" or "Unused"', () => {
    render(<Dialog dialog="data" document={sample('unused')}/>);
    expect(within(screen.getByRole('region', { name: 'Entities' })).getAllByText(/^Used by \d+$|^Unused$/).length).toBeGreaterThan(0);
    const models = screen.getByRole('region', { name: 'Models' });
    expect(within(models).getByText('lonely-weather').tagName).toBe('CODE');
    expect(within(models).getByText('Unused')).toBeTruthy();
    expect(within(models).getAllByText(/^Used by \d+$/).length).toBeGreaterThan(10);
  });

  it('searches editable model sources by name or id without a manual cleanup action', () => {
    render(<Dialog dialog="data" document={sample('unused')}/>);
    fireEvent.change(screen.getByPlaceholderText('Search data'), { target: { value: 'lonely' } });
    expect(screen.getAllByRole('button', { name: /lonely-weather/ })).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('Search data'), { target: { value: '' } });
    expect(screen.queryByRole('button', { name: 'Remove Unused' })).toBeNull();
    expect(removeUnusedSources(base).dataSources.length).toBe(base.dataSources.length);
  });

  it('has no cleanup action, and says so when there is no data', () => {
    const { unmount } = render(<Dialog dialog="data"/>);
    expect(screen.queryByRole('button', { name: 'Remove Unused' })).toBeNull();
    unmount();
    render(<Dialog dialog="data" document={{ ...base, dataSources: [] }}/>);
    expect(screen.getByText('No data yet.')).toBeTruthy();
  });

  it('a row pushes the source\'s own fields, with Back to the list', () => {
    render(<Dialog dialog="data" document={sample('unused')}/>);
    fireEvent.click(screen.getByRole('button', { name: /lonely-weather/ }));
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeTruthy();
    expect(document.querySelector('[data-field-path="dataSources/' + (base.dataSources.length) + '/inputs/weatherEntityId"], [data-field-path^="dataSources/' + base.dataSources.length + '"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Data/ }));
    expect(screen.getByRole('button', { name: 'Add Source' })).toBeTruthy();
  });

  it('"Add Source" lists the models, adds the one chosen and opens its fields', () => {
    let last = base;
    render(<Dialog dialog="data" seen={next => { last = next; }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
    const names = modelChoices().map(choice => choice.name);
    expect(names).toContain('Weather');
    fireEvent.click(screen.getByRole('button', { name: 'Weather' }));
    expect(last.dataSources.length).toBe(base.dataSources.length + 1);
    expect(last.dataSources.at(-1)).toMatchObject({ kind: 'model', model: 'home-weather@1' });
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeTruthy();
  });
});

describe('Local State', () => {
  it('starts a state of each kind and renames one everywhere it is named', () => {
    expect(startingState('a', 'boolean')).toMatchObject({ type: 'boolean', initial: false });
    expect(startingState('a', 'number')).toMatchObject({ type: 'number', initial: 0 });
    expect(startingState('a', 'string')).toMatchObject({ type: 'string', initial: '' });
    expect(startingState('a', 'choice')).toMatchObject({ type: 'choice' });
    const made = newLocalState(base);
    expect(base.localState?.some(field => field.id === made.id)).toBe(false);
    const renamed = renameLocalState(base, 'hc-climate-tab', 'climate-view');
    expect(renamed.localState?.[0].id).toBe('climate-view');
    expect(JSON.stringify(renamed)).not.toContain('"hc-climate-tab"');
  });

  it('lists each state with its kind and starting value; "Add State" adds one and opens it', () => {
    let last = base;
    render(<Dialog dialog="local-state" seen={next => { last = next; }}/>);
    expect(screen.getByText('Kept on this device while a page is open. Not saved to Home Assistant.')).toBeTruthy();
    expect(screen.getByText('Choice · Rooms')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add State' }));
    expect(last.localState).toHaveLength(2);
    expect(last.localState?.[1]).toMatchObject({ type: 'boolean', initial: false });
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Kind')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Starting value' })).toBeTruthy();
  });

  it('changes a state\'s kind, edits a choice\'s options and its starting value, and removes it', () => {
    let last = base;
    render(<Dialog dialog="local-state" seen={next => { last = next; }}/>);
    fireEvent.click(screen.getByRole('button', { name: /hc-climate-tab/ }));
    expect(screen.getByRole('group', { name: 'Options' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Starting value'), { target: { value: 'tracking' } });
    expect((last.localState?.[0] as { initial: string }).initial).toBe('tracking');
    fireEvent.click(screen.getByRole('button', { name: 'Add Option' }));
    expect((last.localState?.[0] as { options: unknown[] }).options).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'number' } });
    expect(last.localState?.[0]).toMatchObject({ id: 'hc-climate-tab', type: 'number' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove State' }));
    expect(last.localState).toEqual([]);
    expect(screen.getByText('No local state.')).toBeTruthy();
  });

  it('refuses a name that is not valid or already taken, and keeps the state under its old name', () => {
    let last = base;
    render(<Dialog dialog="local-state" document={{ ...base, localState: [startingState('one', 'boolean'), startingState('two', 'boolean')] }} seen={next => { last = next; }}/>);
    fireEvent.click(screen.getByRole('button', { name: /^one/ }));
    const name = () => document.querySelector<HTMLInputElement>('[data-field-path="localState/0/id"] input')!;
    fireEvent.change(name(), { target: { value: 'two' } });
    expect(screen.getByText('Another state has this name.')).toBeTruthy();
    fireEvent.change(name(), { target: { value: 'bad name' } });
    expect(screen.getByText('Use letters, numbers, dots, dashes and underscores.')).toBeTruthy();
    expect(last).toBe(base);
    fireEvent.change(name(), { target: { value: 'three' } });
    expect(last.localState?.map(field => field.id)).toEqual(['three', 'two']);
  });
});

describe('App Launch', () => {
  it('shows one switch, and the launch rows only while it is on', () => {
    let last = base;
    render(<Dialog dialog="launch" seen={next => { last = next; }}/>);
    expect(screen.queryByLabelText('Ready announcement')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Custom launch text' }));
    expect(last.bootstrap).toBeTruthy();
    const form = within(document.querySelector<HTMLElement>('.w2-form')!);
    for (const label of ['Ready announcement', 'Loading title', 'Unavailable title', 'Unavailable message', 'Retry button', 'Notifications', 'Time Sensitive', 'Location']) expect(form.getByLabelText(label), label).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Why we ask' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Loading title'), { target: { value: 'Starting' } });
    expect(last.bootstrap?.recovery.loadingTitle).toBe('Starting');
    fireEvent.click(screen.getByRole('switch', { name: 'Custom launch text' }));
    expect(last.bootstrap).toBeUndefined();
  });
});

describe('Live Activities', () => {
  it('lists jobs and camera notifications; Add Activity and Add Camera open the new row\'s fields', () => {
    let last = base;
    render(<Dialog dialog="live" seen={next => { last = next; }}/>);
    expect(screen.getByText('No Live Activities.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add Activity' }));
    expect(last.liveActivities).toHaveLength(1);
    expect(screen.getByLabelText('Job ID')).toBeTruthy();
    expect(screen.getByText('Matches the job’s tag without “job.”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Activity' }));
    expect(last.liveActivities).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add Camera' }));
    expect(last.extensions?.cameras).toHaveLength(1);
    expect(screen.getByLabelText('Live label')).toBeTruthy();
  });
});

describe('Publish History', () => {
  const entry = (revision: number) => ({ revision, publishedAt: `2026-11-1${revision % 10}T10:00:00Z`, publishedBy: null, envelopeSha256: 'a'.repeat(64), capabilities: [] });
  const summary = (current: number, history: number[]): HaPublicationSummary => ({ epoch: 'e', current: entry(current), history: history.map(entry), storedAssets: 0 });

  it('says "Nothing published yet." with no revisions', async () => {
    render(<Dialog dialog="history" stub={{ publication: { epoch: 'e', current: null, history: [], storedAssets: 0 } }}/>);
    expect(await screen.findByText('Nothing published yet.')).toBeTruthy();
  });

  it('shows the reason and "Try Again" when the list cannot be read', async () => {
    const refresh = vi.fn(async () => undefined);
    render(<Dialog dialog="history" stub={{ publicationError: 'Home Assistant is not configured', refreshPublication: refresh }}/>);
    expect(await screen.findByText('Home Assistant is not configured')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('lists revisions newest first with "Live" on the current one and "Roll Back" on the others', async () => {
    render(<Dialog dialog="history" stub={{ publication: summary(12, [11, 10]) }}/>);
    const items = await screen.findAllByRole('listitem');
    expect(items.map(item => item.querySelector('strong')?.textContent)).toEqual(['Revision 12', 'Revision 11', 'Revision 10']);
    expect(within(items[0]).getByText('Live')).toBeTruthy();
    expect(within(items[0]).queryByRole('button')).toBeNull();
    expect(within(items[1]).getByRole('button', { name: /Roll Back/ })).toBeTruthy();
  });

  it('confirms before rolling back, and shows "Rolled back" when it works', async () => {
    api.request.mockResolvedValue({ epoch: 'e', revision: 13, envelopeSha256: 'b'.repeat(64) });
    const refresh = vi.fn(async () => undefined);
    render(<Dialog dialog="history" stub={{ publication: summary(12, [11]), refreshPublication: refresh }}/>);
    fireEvent.click((await screen.findAllByRole('button', { name: /Roll Back to Revision 11/ }))[0]);
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Roll Back to Revision 11?')).toBeTruthy();
    expect(within(confirm).getByText('It becomes the live layout as a new revision. Your draft does not change.')).toBeTruthy();
    expect(api.request).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Roll Back' }));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/native/api/ha/rollback', { method: 'POST', body: JSON.stringify({ revision: 11 }) }));
    expect(await screen.findByText('Rolled back')).toBeTruthy();
    expect(screen.queryByText('Roll Back to Revision 11?')).toBeNull();
  });

  it('disables the confirm while rolling back, and keeps it open with the reason and "Try Again" when it fails', async () => {
    let fail!: (reason: Error) => void;
    api.request.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    render(<Dialog dialog="history" stub={{ publication: summary(12, [11]) }}/>);
    fireEvent.click((await screen.findAllByRole('button', { name: /Roll Back to Revision 11/ }))[0]);
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Roll Back' }));
    await waitFor(() => expect((within(confirm).getByRole('button', { name: 'Rolling Back…' }) as HTMLButtonElement).disabled).toBe(true));
    expect((within(confirm).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fail(new Error('Revision 11 is no longer in the Home Assistant history')); });
    expect(within(confirm).getByRole('alert').textContent).toContain('no longer in the Home Assistant history');
    expect(within(confirm).getByRole('button', { name: 'Try Again' })).toBeTruthy();
    expect(screen.queryByText('Rolled back')).toBeNull();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Import, About, Activity and Help', () => {
  it('lists parse errors under the pasted text, and asks before replacing the draft', async () => {
    let last = base;
    render(<Dialog dialog="import" seen={next => { last = next; }}/>);
    expect((screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Paste JSON'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(last).toBe(base);
    fireEvent.change(screen.getByLabelText('Paste JSON'), { target: { value: JSON.stringify({ ...base, name: 'Imported house' }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('Replace the Draft?')).toBeTruthy();
    expect(within(confirm).getByText('Undo brings it back.')).toBeTruthy();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Replace' }));
    expect(last.name).toBe('Imported house');
    expect(screen.getByText('Adds the rooms and chores pages this draft does not have yet.')).toBeTruthy();
  });

  it('About lists the identifiers, each with its own Copy', () => {
    render(<Dialog dialog="about"/>);
    for (const label of ['Publisher ID', 'Document ID', 'Preview address', 'Capabilities', 'Manifest']) expect(screen.getByRole('button', { name: `Copy ${label}` }), label).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Freeze a Local Revision' })).toBeTruthy();
  });

  it('Activity says "Nothing yet." or lists its lines', () => {
    const { unmount } = render(<Dialog dialog="activity"/>);
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
    unmount();
    render(<Dialog dialog="activity" stub={{ activity: [{ id: 2, text: 'Saved' }, { id: 1, text: 'Simulated light.turn_on' }] }}/>);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['Saved', 'Simulated light.turn_on']);
  });

  it('Help carries the one preview note and the keyboard shortcuts', () => {
    render(<Dialog dialog="help"/>);
    expect(previewNote).toBe('The preview approximates iOS. Taps are simulated and never reach your devices.');
    expect(screen.getAllByText(previewNote)).toHaveLength(1);
    expect(screen.getByText('Save the draft now')).toBeTruthy();
    expect(document.querySelectorAll('kbd').length).toBeGreaterThan(3);
  });
});

describe('the preview wallpaper', () => {
  const asset = { id: 'wall', role: 'backdrop', source: { type: 'publisher', path: '/api/assets/abc.png' }, sha256: 'a'.repeat(64), mimeType: 'image/png', byteLength: 10, pixelWidth: 10, pixelHeight: 10 };
  const downloaded = (blur: unknown) => ({ ...base, assets: [asset], theme: { ...base.theme, background: { type: 'downloaded', assetId: 'wall', recipe: 'house-r3@1', blur, scrim: { type: 'canonical@1' }, motion: 'stationary@1', reducedTransparency: 'canonical-base@1' } } }) as unknown as CompositionDocument;
  it('draws nothing for the plain wallpaper and the chosen image, blurred by the setting, once there is one', () => {
    expect(wallpaperImage(base)).toBeUndefined();
    expect(wallpaperImage(downloaded({ type: 'preference', key: 'backdrop-blur', initialPercent: 50 }))).toEqual({ url: '/native/api/assets/abc.png', blur: 12 });
    expect(wallpaperImage(downloaded({ type: 'fixed', percent: 0 }))?.blur).toBe(0);
    expect(wallpaperImage({ ...downloaded({ type: 'fixed', percent: 10 }), assets: [] })).toBeUndefined();
  });
});
