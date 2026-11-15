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

  /** Two rooms whose cards share a title and kind across the overview and two sections, with subtitle entities and state colours. */
  const twoRooms = () => {
    const card = (entity: string, extra: Record<string, unknown> = {}) => ({ kind: 'light', entityId: entity, title: 'Lights', icon: 'mdi:lightbulb', showState: true,
      activeStates: ['on'], disabledStates: [], stateLabels: {}, subtitleEntityIds: [], ...extra });
    const room = (id: string, title: string) => ({ id, title, overviewCards: [card(`light.demo_${id}_overview`), card(`light.demo_${id}_second`)],
      sections: [{ title: 'Devices', cards: [card(`light.demo_${id}_a`, { subtitleEntityIds: [`sensor.demo_${id}_one`, `sensor.demo_${id}_two`] }), card(`light.demo_${id}_b`)] },
        { title: 'Devices', cards: [card(`light.demo_${id}_c`, { icon: 'mdi:television', stateColors: { on: { red: 1, green: 0.5, blue: 0, opacity: 1 } } })] }] });
    return { rooms: { items: [], pages: [room('den', 'Den'), room('loft', 'Loft')] } };
  };

  /** Every `id` in a document, including the ids of nested nodes, items and data sources. */
  const ids = (value: unknown, found: string[] = []): string[] => {
    if (Array.isArray(value)) value.forEach(item => ids(item, found));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { if (key === 'id' && typeof child === 'string') found.push(child); else ids(child, found); }
    }
    return found;
  };

  it('gives every generated component and source an id from the room and the card position, so repeated labels never collide', () => {
    const result = importHouseLayout(draft(), twoRooms());
    expect(result.added).toEqual(expect.arrayContaining(['room-den', 'room-loft']));
    expect(result.dropped.filter(note => /compiler refused/.test(note.reason))).toEqual([]);
    const all = ids(result.document);
    expect(new Set(all).size).toBe(all.length);
    const den = result.document.pages.find(page => page.id === 'room-den');
    expect(ids(den)).toEqual(expect.arrayContaining(['room-den-card-o-c0', 'room-den-card-o-c1', 'room-den-card-s0-c0', 'room-den-card-s0-c1', 'room-den-card-s1-c0']));
    expect(result.document.dataSources.map(source => source.id)).toEqual(expect.arrayContaining(['room-loft-o-c0', 'room-loft-s0-c0-sub1', 'room-loft-s1-c0']));
  });

  it('does not change a card id when another room is added or the labels change', () => {
    const only = importHouseLayout(draft(), { rooms: { items: [], pages: [twoRooms().rooms.pages[1]] } });
    const both = importHouseLayout(draft(), twoRooms());
    const loftIds = (document: CompositionDocument) => ids(document.pages.find(page => page.id === 'room-loft'));
    expect(loftIds(both.document)).toEqual(loftIds(only.document));
    const relabelled = twoRooms();
    relabelled.rooms.pages[1].sections[0].title = 'Renamed';
    relabelled.rooms.pages[1].overviewCards[0].title = 'Overhead';
    expect(loftIds(importHouseLayout(draft(), relabelled).document).filter(id => id.includes('-card-')))
      .toEqual(loftIds(both.document).filter(id => id.includes('-card-')));
  });

  it('is idempotent: importing again changes and adds nothing', () => {
    const first = importHouseLayout(draft(), { ...house(), ...twoRooms() });
    const second = importHouseLayout(first.document, { ...house(), ...twoRooms() });
    expect(second.added).toEqual([]);
    expect(second.document).toEqual(first.document);
    expect(second.kept).toEqual(expect.arrayContaining(['room-den', 'room-loft']));
    expect(() => compileCompositionDocument(second.document)).not.toThrow();
  });

  it('carries state colours and the symbols the app already maps, and reports only an unknown icon', () => {
    const result = importHouseLayout(draft(), { rooms: { items: [], pages: [{ ...twoRooms().rooms.pages[0], id: 'den' }, { id: 'hall', title: 'Hall',
      overviewCards: [{ kind: 'light', entityId: 'light.demo_hall', title: 'Lamp', icon: 'mdi:demo-unmapped', showState: true, activeStates: [], disabledStates: [], stateLabels: {}, subtitleEntityIds: [] }], sections: [] }] } });
    const den = JSON.stringify(result.document.pages.find(page => page.id === 'room-den'));
    expect(den).toContain('"name":"tv"');
    expect(den).toContain('"stateColors":[{"state":"on","fill":{"type":"solid-rgb","red":255,"green":128,"blue":0}}]');
    expect(result.dropped.map(note => note.path)).toEqual(['rooms.pages[1].overviewCards[0].icon']);
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
