import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { StudioStore } from '../server/store';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { importHouseLayout } from '../src/shared/composition/house-import';
import type { CompositionDocument } from '../src/shared/composition/schema';
import type { CompositionDraft } from '../src/shared/composition/workspace';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import { fakeHomeAssistant } from './fake-ha-publication';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

/** A synthetic house: two chores pages (one personal with a per-user list), one grocery page, one room and its navigation item. */
const house = () => ({
  chores: {
    people: [{ key: 'resident_1', name: 'Alex', haUserId: 'user-1' }],
    quickLinks: [{ title: 'Chores', pageId: 'chores', tint: { red: 1, green: 0, blue: 0 }, countsGroceries: false, resident: 'resident_1' },
      { title: 'Groceries', pageId: 'groceries', tint: { red: 0, green: 1, blue: 0 }, countsGroceries: true }],
    pages: [
      { id: 'chores', title: 'Chores', emptyTitle: 'No Chores', emptyDescription: 'Nothing due.', hasTaskForm: true, hiddenByVacation: true,
        hideListHeaders: false, addAction: { assignedTask: { defaultAssignee: '' } }, resident: 'resident_1',
        lists: [{ title: 'Overdue', entityId: 'todo.demo_overdue', hideCompleted: true, hideWhenNoOpenItems: true, userIds: ['user-1'], countBucket: 'overdue' },
          { title: 'Later', entityId: 'todo.demo_later', hideCompleted: true, hideWhenNoOpenItems: false, userIds: [], completionScript: 'script.demo_done' }] },
      { id: 'groceries', title: 'Groceries', emptyTitle: 'None', emptyDescription: '', hasTaskForm: false, hiddenByVacation: false, hideListHeaders: true,
        addAction: { groceryItem: { entityId: 'todo.demo_groceries' } },
        lists: [{ title: 'Groceries', entityId: 'todo.demo_groceries', hideCompleted: false, hideWhenNoOpenItems: false, userIds: [] }] },
      { id: 'broken', title: 'Broken', emptyTitle: 'None', emptyDescription: '', addAction: { groceryItem: { entityId: 'todo.demo_missing' } },
        lists: [{ title: 'Only', entityId: 'todo.demo_only', hideCompleted: true, hideWhenNoOpenItems: false, userIds: [] }] },
    ],
  },
  rooms: {
    items: [{ path: 'den', title: 'Den', icon: 'mdi:sofa', color: { red: 0.2, green: 0.4, blue: 0.6, opacity: 1 }, accessKey: 'den', accessCounterEntityId: 'counter.demo_den' }],
    quickLinks: [{ id: 'rooms', title: 'Rooms' }],
    pages: [{ id: 'den', title: 'Den', extra: true,
      overviewCards: [{ kind: 'light', entityId: 'light.demo_den', title: 'Lights', icon: 'mdi:lightbulb', sheet: 'lights-den', showState: true,
        activeStates: ['on'], disabledStates: [], stateLabels: { on: 'On' }, subtitleEntityIds: [], modalItems: [], stateColors: {}, isFullWidth: true },
      { kind: 'teleporter', entityId: 'switch.demo_x', title: 'X', icon: 'mdi:x' }],
      sections: [] }],
  },
});

function draft(): CompositionDocument {
  const document = createCompositionDocument('house-import');
  document.dataSources.push({
    id: 'source-rooms', kind: 'model', model: 'room-navigation@1', ranking: 'configured', items: [],
  } as unknown as CompositionDocument['dataSources'][number]);
  return document;
}

describe('importing house-config layout into the draft', () => {
  it('adds chores pages as todo collections, personalises the resident page and compiles', () => {
    const result = importHouseLayout(draft(), house());
    expect(result.added).toContain('records-chores');
    expect(result.added).toContain('records-groceries');
    const chores = result.document.dataSources.find(source => source.id === 'records-chores') as any;
    expect(chores.model).toBe('todo-collection@1');
    expect(chores.inputs.addAction).toEqual({ type: 'task', defaultAssignee: '' });
    expect(chores.inputs.lists[0]).toMatchObject({ visibleWhen: { type: 'viewer', userIds: ['user-1'] }, whenUnknown: 'hide' });
    expect(chores.inputs.lists[1].completionScript).toEqual({ type: 'literal', value: 'script.demo_done' });
    expect(chores.inputs.personalization).toEqual({ residentId: 'resident_1', ownTitle: 'Your Chores', otherTitle: "Alex's Chores" });
    const groceries = result.document.dataSources.find(source => source.id === 'records-groceries') as any;
    expect(groceries.inputs).toMatchObject({ hideListHeaders: true, addAction: { type: 'grocery', entityId: { value: 'todo.demo_groceries' } } });
    expect(compileCompositionDocument(result.document).capabilities).toContain('sh.todo-collection@1');
  });

  it('reports every behaviour it could not express by field path', () => {
    const { dropped } = importHouseLayout(draft(), house());
    const paths = dropped.map(note => note.path);
    expect(paths).toEqual(expect.arrayContaining([
      'chores.pages[0].lists[0].countBucket', 'chores.quickLinks[0].tint', 'chores.quickLinks[1].countsGroceries', 'chores.quickLinks[1].tint',
      'chores.pages[2]', 'rooms.quickLinks', 'rooms.pages[0].extra', 'rooms.pages[0].overviewCards[0].sheet',
      'rooms.pages[0].overviewCards[0].isFullWidth', 'rooms.pages[0].overviewCards[1].kind',
    ]));
    expect(dropped.every(note => note.reason.length > 0)).toBe(true);
  });

  it('rolls back a page the compiler refuses and still imports the rest', () => {
    const result = importHouseLayout(draft(), house());
    expect(result.added).not.toContain('records-broken');
    expect(result.document.dataSources.some(source => source.id === 'records-broken')).toBe(false);
    expect(result.dropped.find(note => note.path === 'chores.pages[2]')?.reason).toMatch(/compiler refused/);
  });

  it('adds a room page with cards and its navigation item', () => {
    const result = importHouseLayout(draft(), house());
    expect(result.added).toContain('room-den');
    const page = result.document.pages.find(item => item.id === 'room-den');
    expect(page?.title).toBe('Den');
    expect(JSON.stringify(page)).toContain('room-card');
    const navigation = result.document.dataSources.find(source => source.id === 'source-rooms') as any;
    expect(navigation.items[0]).toMatchObject({ id: 'den', fill: { red: 51, green: 102, blue: 153 } });
    expect(navigation.items[0].visitKey).toBeUndefined();
    expect(result.dropped.map(note => note.path)).toContain('rooms.items[0].accessKey');
  });

  it('never overwrites what the draft already authors', () => {
    const first = importHouseLayout(draft(), house());
    const edited = structuredClone(first.document);
    (edited.dataSources.find(source => source.id === 'records-chores') as any).inputs.title = 'Authored Title';
    edited.pages.find(item => item.id === 'room-den')!.title = 'Authored Den';
    const again = importHouseLayout(edited, house());
    expect(again.added).toEqual([]);
    expect(again.kept).toEqual(expect.arrayContaining(['records-chores', 'records-groceries', 'room-den']));
    expect(again.document).toEqual(edited);
  });

  it('matches a room the draft authors under another page id and leaves it alone', () => {
    const authored = draft();
    authored.pages.push({ ...structuredClone(authored.pages[0]), id: 'den', title: 'My Den' });
    const result = importHouseLayout(authored, house());
    expect(result.added).not.toContain('room-den');
    expect(result.kept).toContain('room-den');
    expect(result.document.pages.filter(item => item.title === 'My Den')).toHaveLength(1);
  });

  it('imports nothing from an empty house and never throws', () => {
    const result = importHouseLayout(draft(), {});
    expect(result.added).toEqual([]);
    expect(result.dropped).toEqual([]);
  });
});

describe('POST /native/api/import-house-config', () => {
  const haToken = 'synthetic-ha-token-that-must-never-leave-the-server';
  const token = 'synthetic-import-token';
  async function studio(houseConfig: Record<string, unknown>) {
    const fake = await fakeHomeAssistant({ token: haToken, houseConfig });
    cleanup.push(() => fake.close());
    const directory = await mkdtemp(path.join(os.tmpdir(), 'house-import-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const store = await StudioStore.open(directory);
    cleanup.push(() => store.close());
    const application = createApp(store, { production: false, port: 0, host: '127.0.0.1', dataDir: directory,
      authToken: token, haUrl: fake.url, haToken });
    application.app.use(application.errorHandler);
    const server = http.createServer(application.app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => { application.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = (endpoint: string, method = 'GET', body?: unknown) => fetch(`${base}${endpoint}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { fake, request, draft: async (): Promise<CompositionDraft> => (await request('/native/api/draft')).json() };
  }

  it('reads the live house config, saves the added parts as a new revision and lists what was dropped', async () => {
    const f = await studio(house());
    const before = await f.draft();
    const response = await f.request('/native/api/import-house-config', 'POST', { expectedRevision: before.revision });
    expect(response.status).toBe(200);
    const body = await response.json() as { revision: number; added: string[]; kept: string[]; dropped: { path: string; reason: string }[] };
    expect(body.revision).toBe(before.revision + 1);
    expect(body.added).toEqual(expect.arrayContaining(['records-chores', 'records-groceries']));
    expect(body.dropped.map(note => note.path)).toContain('chores.quickLinks[0].tint');
    const after = await f.draft();
    expect(after.revision).toBe(body.revision);
    expect(after.document.dataSources.some(source => source.id === 'records-chores')).toBe(true);
    expect(JSON.stringify(body)).not.toContain(haToken);
    const second = await (await f.request('/native/api/import-house-config', 'POST', { expectedRevision: after.revision })).json() as typeof body;
    expect(second.added).toEqual([]);
    expect(second.revision).toBe(after.revision);
  });

  it('refuses a stale revision without touching the draft', async () => {
    const f = await studio(house());
    const before = await f.draft();
    expect((await f.request('/native/api/import-house-config', 'POST', { expectedRevision: before.revision + 5 })).status).toBe(409);
    expect((await f.draft()).revision).toBe(before.revision);
  });
});
