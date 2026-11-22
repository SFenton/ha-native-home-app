import { compileCompositionDocument } from './compiler';
import { CompositionValidationError } from './json';
import type { CompositionDocument } from './schema';
import { compositionSymbol } from './workspace';

type J = Record<string, any>;

/** One house-config behaviour the import could not express, with the field it came from. */
export interface HouseImportNote { path: string; reason: string }

/** What an import did to the draft. `document` is the draft with the missing layout parts added. */
export interface HouseImportResult {
  document: CompositionDocument;
  /** Ids of the sources and surfaces the import added. */
  added: string[];
  /** Ids the draft already authors; the import left them untouched. */
  kept: string[];
  /** House-config behaviour that has no expression in the publication, by field path. */
  dropped: HouseImportNote[];
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const roomKinds = new Set(['air', 'appliance', 'climate', 'contact', 'fan', 'grill', 'humidifier', 'laundry',
  'light', 'media', 'occupancy', 'power', 'vacuum', 'vent', 'wake-light']);
const literal = (value: string) => ({ type: 'literal', value });
const isRecord = (value: unknown): value is J => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): J[] => Array.isArray(value) ? value.filter(isRecord) : [];

/**
 * The icon names the import knows; any other house icon falls back to the generic symbol and is reported. The names agree with
 * the native app's own icon map (`HassDesign/SymbolMap.swift`), so a room card shows the symbol the app already uses for that icon.
 */
const symbols: Record<string, string> = {
  'mdi:lightbulb-group': 'lightbulb.2', 'mdi:lightbulb': 'lightbulb', 'mdi:thermometer': 'thermometer.medium', 'mdi:sofa': 'sofa',
  'mdi:bed': 'bed.double', 'mdi:air-filter': 'wind', 'mdi:fan': 'fan', 'mdi:door': 'door.left.hand.closed',
  'mdi:motion-sensor': 'figure.walk.motion', 'mdi:window-closed': 'window.vertical.closed', 'mdi:air-purifier': 'air.purifier',
  'mdi:robot-vacuum': 'robotic.vacuum', 'mdi:remote': 'appletvremote.gen4', 'mdi:weather-sunset-up': 'sunrise', 'mdi:apple': 'apple.logo',
  'mdi:air-humidifier': 'humidifier', 'mdi:controller': 'gamecontroller', 'mdi:gamepad': 'gamecontroller', 'mdi:dishwasher': 'dishwasher',
  'mdi:grill': 'flame', 'mdi:microsoft-xbox': 'gamecontroller', 'mdi:server': 'server.rack', 'mdi:microsoft-windows': 'pc',
  'mdi:projector': 'videoprojector', 'mdi:television': 'tv', 'mdi:washing-machine': 'washer', 'mdi:tumble-dryer': 'dryer',
  'mdi:garage': 'door.garage.closed', 'mdi:heat-wave': 'heat.waves',
};
/** A house colour channel (0 to 1) as the publication's 0 to 255 channel. */
const channel = (value: unknown) => Math.max(0, Math.min(255, Math.round(Number(value ?? 0) * 255)));
const solidRgb = (color: J) => ({ type: 'solid-rgb', red: channel(color.red), green: channel(color.green), blue: channel(color.blue) });

/**
 * Adds the layout house configuration used to carry to `draft`: chores pages as `todo-collection@1` sources and the rooms the
 * draft does not yet author as pages of room cards. An exact generic light-group sheet is composed from its authored group and
 * member entities; other sheet references remain unlinked. Nothing the draft already authors is changed: a source or page whose
 * id (or, for a room, whose room id) is present is left alone and listed in `kept`. A part the publication cannot express is
 * left out and listed in `dropped` by its house-config field path. Each added part is compiled on its own, and one that the
 * compiler refuses is rolled back and reported rather than failing the import.
 */
export function importHouseLayout(draft: CompositionDocument, houseConfig: Record<string, unknown>): HouseImportResult {
  const result: HouseImportResult = { document: structuredClone(draft), added: [], kept: [], dropped: [] };
  importChores(result, isRecord(houseConfig.chores) ? houseConfig.chores : {});
  importRooms(result, isRecord(houseConfig.rooms) ? houseConfig.rooms : {});
  return result;
}

/** Adds `apply`'s edits to the document, keeping them only when the whole document still compiles. */
function attempt(result: HouseImportResult, path: string, apply: (document: CompositionDocument) => void): boolean {
  const candidate = structuredClone(result.document);
  apply(candidate);
  try { compileCompositionDocument(candidate); } catch (error) {
    const issue = error instanceof CompositionValidationError ? error.issues[0] : undefined;
    result.dropped.push({ path, reason: issue ? `The compiler refused it (${issue.code} at ${issue.pointer}).` : 'The compiler refused it.' });
    return false;
  }
  result.document = candidate;
  return true;
}

// MARK: Chores

function importChores(result: HouseImportResult, chores: J) {
  const people = list(chores.people);
  const links = list(chores.quickLinks);
  list(chores.pages).forEach((page, index) => {
    const path = `chores.pages[${index}]`;
    const sourceId = `records-${page.id}`;
    if (typeof page.id !== 'string' || !identifier.test(sourceId)) {
      result.dropped.push({ path: `${path}.id`, reason: 'The id cannot name a publication source.' }); return;
    }
    if (result.document.dataSources.some(source => source.id === sourceId)) { result.kept.push(sourceId); return; }
    const notes: HouseImportNote[] = [];
    const link = links.find(item => item.pageId === page.id);
    const linkIndex = link ? links.indexOf(link) : -1;
    if (link?.tint) notes.push({ path: `chores.quickLinks[${linkIndex}].tint`, reason: 'Tiles are coloured by their family, not a stored colour.' });
    if (link?.countsGroceries) notes.push({ path: `chores.quickLinks[${linkIndex}].countsGroceries`, reason: 'The count subtitle is authored on the navigation tile.' });
    const lists = list(page.lists).map((item, listIndex) => {
      if (item.countBucket) notes.push({ path: `${path}.lists[${listIndex}].countBucket`, reason: 'Count buckets are not part of a todo collection.' });
      const entry: J = {
        title: item.title, entityId: literal(item.entityId),
        hideCompleted: item.hideCompleted !== false, hideWhenNoOpenItems: item.hideWhenNoOpenItems === true,
      };
      if (typeof item.completionScript === 'string') entry.completionScript = literal(item.completionScript);
      if (Array.isArray(item.userIds) && item.userIds.length > 0) {
        entry.visibleWhen = { type: 'viewer', userIds: item.userIds };
        entry.whenUnknown = 'hide';
      }
      return entry;
    });
    const action = isRecord(page.addAction) ? page.addAction : {};
    let addAction: J | undefined;
    if (isRecord(action.assignedTask)) addAction = { type: 'task', defaultAssignee: String(action.assignedTask.defaultAssignee ?? '') };
    else if (isRecord(action.groceryItem)) addAction = { type: 'grocery', entityId: literal(action.groceryItem.entityId) };
    else if (isRecord(action.adminTodo)) addAction = { type: 'admin', entityId: literal(action.adminTodo.entityId) };
    if (!addAction) { result.dropped.push({ path: `${path}.addAction`, reason: 'Unknown add action; the page was not imported.' }); return; }
    if (Boolean(page.hasTaskForm) !== (addAction.type === 'task')) {
      notes.push({ path: `${path}.hasTaskForm`, reason: 'The task form follows the add action; the stored flag disagrees and is ignored.' });
    }
    const inputs: J = {
      title: page.title, lists, addAction,
      hideListHeaders: page.hideListHeaders === true, hiddenByVacation: page.hiddenByVacation === true,
      empty: { title: page.emptyTitle ?? '', description: page.emptyDescription ?? '' },
    };
    const residentKey = page.resident ?? link?.resident;
    const person = people.find(item => item.key === residentKey);
    if (typeof residentKey === 'string' && person) {
      inputs.personalization = { residentId: residentKey, ownTitle: 'Your Chores', otherTitle: `${person.name}'s Chores` };
    } else if (residentKey !== undefined) {
      notes.push({ path: `${path}.resident`, reason: 'The resident is not among chores.people; the page is not personalised.' });
    }
    const source = { id: sourceId, kind: 'model', model: 'todo-collection@1', inputs } as unknown as CompositionDocument['dataSources'][number];
    if (attempt(result, path, document => { document.dataSources.push(source); })) {
      result.added.push(sourceId);
      result.dropped.push(...notes);
    }
  });
}

// MARK: Rooms

/** Whether the draft already authors this room: a page, source, navigation item or node carries its id. */
function authorsRoom(document: CompositionDocument, roomId: string): boolean {
  const names = new Set([roomId, `room-${roomId}`, `page-${roomId}`]);
  const seen = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(seen);
    if (!isRecord(value)) return false;
    return (typeof value.id === 'string' && names.has(value.id)) || Object.values(value).some(seen);
  };
  return seen(document.pages) || seen(document.modals) || seen(document.dataSources);
}

function importRooms(result: HouseImportResult, rooms: J) {
  const items = list(rooms.items);
  const lightGroups = list(rooms.lightGroups);
  if (list(rooms.quickLinks).length > 0) result.dropped.push({ path: 'rooms.quickLinks', reason: 'Quick links are authored as navigation tiles on a page.' });
  if (isRecord(rooms.grid) && Object.keys(rooms.grid).length > 0) result.dropped.push({ path: 'rooms.grid', reason: 'The grid is authored as a room-navigation grid.' });
  list(rooms.pages).forEach((room, index) => {
    const path = `rooms.pages[${index}]`;
    for (const key of Object.keys(room)) {
      if (!['id', 'title', 'overviewCards', 'sections'].includes(key)) result.dropped.push({ path: `${path}.${key}`, reason: 'Not part of a room page the publication can express.' });
    }
    const roomId = room.id;
    if (typeof roomId !== 'string' || !identifier.test(`room-${roomId}`)) {
      result.dropped.push({ path: `${path}.id`, reason: 'The id cannot name a publication page.' }); return;
    }
    if (authorsRoom(result.document, roomId)) { result.kept.push(`room-${roomId}`); return; }
    const notes: HouseImportNote[] = [];
    const sources: J[] = [];
    const modals: J[] = [];
    const importedSheets = new Map<string, { entityId: string; title: string; icon: string }>();
    const entity = (entityId: unknown, label: string): string | undefined => {
      if (typeof entityId !== 'string') return undefined;
      const existing = ([...result.document.dataSources, ...sources] as J[]).find(source => source.kind === 'ha-entity' && source.entityId?.value === entityId);
      if (existing) return existing.id;
      const id = `room-${roomId}-${label}`;
      sources.push({ id, kind: 'ha-entity', entityId: literal(entityId) });
      return id;
    };
    const lightSource = (entityId: string, memberEntityIds: string[], label: string): string => {
      const sameInputs = (source: J) => source.kind === 'model' && source.model === 'home-light@1'
        && source.inputs?.entityId?.value === entityId
        && JSON.stringify(source.inputs?.memberEntityIds ?? []) === JSON.stringify(memberEntityIds.map(literal));
      const existing = ([...result.document.dataSources, ...sources] as J[]).find(sameInputs);
      if (existing) return existing.id;
      const id = `room-${roomId}-${label}`;
      sources.push({
        id, kind: 'model', model: 'home-light@1',
        inputs: { entityId: literal(entityId), ...(memberEntityIds.length > 0 ? { memberEntityIds: memberEntityIds.map(literal) } : {}) },
      });
      return id;
    };
    const lightEntity = (value: unknown): value is string => typeof value === 'string'
      && /^(light|switch|input_boolean)\.[a-z0-9_]+$/.test(value);
    const lightSheet = (card: J, cardPath: string, position: string): string | undefined => {
      const path = `${cardPath}.sheet`;
      const unsupported = (reason: string) => {
        notes.push({ path, reason });
        return undefined;
      };
      if (typeof card.sheet !== 'string' || !identifier.test(card.sheet)) {
        return unsupported('The detail sheet id cannot name a publication surface; the card is not linked.');
      }
      if (card.kind !== 'light') return unsupported('This detail sheet is not part of the supported generic light-group composition; the card is not linked.');
      if (list(card.modalItems).length > 0) return unsupported('Items take precedence over the native light-group route; the card is not linked.');
      if (card.control !== undefined || card.action !== undefined || card.semantics !== undefined) {
        return unsupported('The card has device-specific or custom sheet dispatch; the card is not linked.');
      }
      if (typeof room.title !== 'string' || room.title.length === 0) {
        return unsupported('The room has no exact authored title for the light-group lookup; the card is not linked.');
      }
      const matches = lightGroups.map((group, index) => ({ group, index })).filter(({ group }) => group.room === room.title);
      if (matches.length !== 1) {
        return unsupported(matches.length === 0
          ? 'No light group has this exact room title; the card is not linked.'
          : 'More than one light group has this room title; the supported route is ambiguous and the card is not linked.');
      }
      const { group, index: groupIndex } = matches[0];
      if (!lightEntity(group.entityId) || group.entityId !== card.entityId) {
        notes.push({
          path: `rooms.lightGroups[${groupIndex}].entityId`,
          reason: 'The group entity does not exactly match the light card; the detail sheet is not linked.',
        });
        return unsupported('The exact room light group does not match this card entity; the card is not linked.');
      }
      if (!Array.isArray(group.items) || group.items.length === 0 || group.items.length !== list(group.items).length) {
        return unsupported('The room light group has no complete member list; the card is not linked.');
      }
      const members = list(group.items);
      if (members.some(member => typeof member.title !== 'string' || member.title.length === 0
        || !lightEntity(member.entityId) || member.resident !== undefined)) {
        return unsupported('The light group members are incomplete or contain personalised titles the generic composition cannot preserve; the card is not linked.');
      }
      const memberEntityIds = members.map(member => member.entityId);
      const hasGroupControl = members.length > 1 && group.entityId.startsWith('light.');
      if (new Set(memberEntityIds).size !== memberEntityIds.length || (hasGroupControl && memberEntityIds.includes(group.entityId))) {
        return unsupported('The light group repeats an entity; the card is not linked.');
      }
      const sheetTitle = card.modalTitle ?? card.title;
      if (typeof sheetTitle !== 'string' || sheetTitle.length === 0) {
        return unsupported('The light sheet has no valid authored title; the card is not linked.');
      }
      const title = `${room.title} ${sheetTitle}`;
      const icon = symbols[String(card.icon)] ?? 'square.grid.2x2';
      const existing = importedSheets.get(card.sheet);
      if (existing) {
        if (existing.entityId !== group.entityId || existing.title !== title || existing.icon !== icon) {
          return unsupported('One sheet id resolves to more than one light sheet composition; the card is not linked.');
        }
        return card.sheet;
      }
      const heading = members.length === 1 ? 'Light' : 'Lights';
      const groupTile = hasGroupControl ? [{
        id: `room-${roomId}-card-${position}-light-group`,
        title: `${room.title} Lights`,
        layout: { span: 1 },
        type: 'light-group-tile',
        props: { sourceId: lightSource(group.entityId, memberEntityIds, `${position}-light-group`) },
      }] : [];
      const memberNodes = members.map((member, memberIndex) => ({
        id: `room-${roomId}-card-${position}-light-${memberIndex + 1}`,
        title: member.title,
        layout: { span: 1 },
        type: 'light-group-tile',
        props: { sourceId: lightSource(member.entityId, [], `${position}-light-${memberIndex + 1}`) },
      }));
      modals.push({
        id: card.sheet,
        title,
        icon: compositionSymbol(icon),
        parameters: {},
        toolbar: { type: 'replace', groups: [] },
        layout: {
          type: 'column',
          padding: {
            top: { type: 'token', name: 'l' }, leading: { type: 'token', name: 'l' },
            bottom: { type: 'token', name: 'l' }, trailing: { type: 'token', name: 'l' },
          },
          spacing: { type: 'token', name: 'l' },
          maxWidth: { type: 'points', value: 720 },
          scroll: 'content-fit@1', chrome: 'canonical-page@1', ground: 'host',
        },
        presentation: {
          type: 'sheet', width: 'page', height: { type: 'full' }, appearance: 'dark',
          placement: 'canonical-sheet@1', grabber: 'canonical', navigation: 'local-stack@1',
          close: {
            type: 'close', visibility: 'all-depths', placement: 'trailing', rail: 'automatic',
            guard: { type: 'none' },
          },
        },
        components: [{
          id: `room-${roomId}-card-${position}-lights`,
          title: heading,
          layout: { span: 1 },
          type: 'section',
          props: {
            header: heading, footer: '', style: 'plain', density: 'thin', hasGlyphs: true,
            spacing: { type: 'token', name: 'm' },
          },
          children: [
            ...groupTile,
            {
              id: `room-${roomId}-card-${position}-light-members`,
              title: heading,
              layout: { span: 1 },
              type: 'tile-grid',
              props: {
                minimum: 'tile-dynamic-type@1', maxColumns: 4,
                spacing: { type: 'token', name: 'm' }, equalRowHeights: true,
                shortRow: 'share', fold: 'container',
              },
              children: memberNodes,
            },
          ],
        }],
      });
      importedSheets.set(card.sheet, { entityId: group.entityId, title, icon });
      return card.sheet;
    };
    // `scope` is the card group's position in the room ('o' for the overview, 's<n>' for section n); with the card's index it
    // names every generated id, so ids stay unique and stable however the labels repeat.
    const cardsOf = (cards: J[], base: string, scope: string) => cards.flatMap((card, cardIndex) => {
      const cardPath = `${base}[${cardIndex}]`;
      const position = `${scope}-c${cardIndex}`;
      if (!roomKinds.has(card.kind)) { notes.push({ path: `${cardPath}.kind`, reason: `Card kind "${card.kind}" has no room card; the card was not imported.` }); return []; }
      const sourceId = entity(card.entityId, position);
      if (!sourceId) { notes.push({ path: `${cardPath}.entityId`, reason: 'The card has no entity; it was not imported.' }); return []; }
      const sheetId = card.sheet ? lightSheet(card, cardPath, position) : undefined;
      if (list(card.modalItems).length > 0) notes.push({ path: `${cardPath}.modalItems`, reason: 'Modal items are not carried.' });
      if (card.isFullWidth) notes.push({ path: `${cardPath}.isFullWidth`, reason: 'Card width follows the section arrangement.' });
      const symbolName = symbols[String(card.icon)];
      if (!symbolName) notes.push({ path: `${cardPath}.icon`, reason: `Icon "${card.icon}" has no symbol mapping; a generic symbol was used.` });
      const subtitleSourceIds = (Array.isArray(card.subtitleEntityIds) ? card.subtitleEntityIds : [])
        .map((value: unknown, subIndex: number) => entity(value, `${position}-sub${subIndex}`)).filter(Boolean);
      const props: J = {
        kind: card.kind, showState: card.showState !== false, subtitleSourceIds,
        activeStates: card.activeStates ?? [], disabledStates: card.disabledStates ?? [],
        stateLabels: Object.entries(isRecord(card.stateLabels) ? card.stateLabels : {}).map(([state, label]) => ({ state, label })),
      };
      if (sheetId) props.action = { type: 'present', modalId: sheetId, arguments: {}, ifPresented: 'reject' };
      if (card.climateActionTone) props.climateActionTone = true;
      const stateColors = Object.entries(isRecord(card.stateColors) ? card.stateColors : {}).filter(([, color]) => isRecord(color));
      if (stateColors.length > 0) props.stateColors = stateColors.map(([state, color]) => ({ state, fill: solidRgb(color as J) }));
      return [{
        id: `room-${roomId}-card-${position}`, title: String(card.title ?? 'Card'), type: 'room-card', layout: { span: 1 },
        icon: compositionSymbol(symbolName), binding: { sourceId, projection: 'room-state@1' }, props,
      }];
    });
    const sections: J[] = [];
    const overview = cardsOf(list(room.overviewCards), `${path}.overviewCards`, 'o');
    if (overview.length > 0) sections.push({ id: `room-${roomId}-overview`, title: 'Overview', type: 'room-section', layout: { span: 1 },
      props: { arrangement: 'grid', leadJoinsAtRegularWidth: false }, children: overview });
    list(room.sections).forEach((section, sectionIndex) => {
      const children = cardsOf(list(section.cards), `${path}.sections[${sectionIndex}].cards`, `s${sectionIndex}`);
      if (children.length > 0) sections.push({ id: `room-${roomId}-section-${sectionIndex}`, title: String(section.title ?? 'Devices'), type: 'room-section',
        layout: { span: 1 }, props: { arrangement: 'grid', leadJoinsAtRegularWidth: false }, children });
    });
    if (sections.length === 0) { result.dropped.push({ path, reason: 'The room has no card the publication can express; the page was not imported.' }); return; }
    const pageId = `room-${roomId}`;
    const added = attempt(result, path, document => {
      document.dataSources.push(...(sources as unknown as CompositionDocument['dataSources']));
      document.modals.push(...(modals as unknown as CompositionDocument['modals']));
      const page = { ...structuredClone(document.pages[0]), id: pageId, title: String(room.title ?? roomId), icon: compositionSymbol('house'), components: sections };
      document.pages.push(page as unknown as CompositionDocument['pages'][number]);
    });
    if (!added) return;
    result.added.push(pageId, ...modals.map(modal => modal.id as string));
    result.dropped.push(...notes);
    // The room's entry in the navigation grid, only where the draft already has a room-navigation source to hold it.
    const item = items.find(entry => entry.path === roomId);
    const navigation = result.document.dataSources.find(source => source.kind === 'model' && (source as J).model === 'room-navigation@1') as J | undefined;
    if (item && navigation && !navigation.items.some((existing: J) => existing.id === roomId)) {
      const color = isRecord(item.color) ? item.color : {};
      const ranked = navigation.ranking !== 'configured';
      if (!ranked && (item.accessCounterEntityId || item.accessKey)) {
        result.dropped.push({ path: `rooms.items[${items.indexOf(item)}].accessKey`, reason: 'The draft ranks rooms as configured; visit counting is not carried.' });
      }
      const symbolName = symbols[String(item.icon)];
      if (!symbolName) result.dropped.push({ path: `rooms.items[${items.indexOf(item)}].icon`, reason: `Icon "${item.icon}" has no symbol mapping; a generic symbol was used.` });
      attempt(result, `rooms.items[${items.indexOf(item)}]`, document => {
        const target = document.dataSources.find(source => source.id === navigation.id) as J;
        target.items.push({
          id: roomId, title: String(item.title ?? roomId), icon: compositionSymbol(symbolName),
          fill: solidRgb(color),
          ...(ranked && typeof item.accessCounterEntityId === 'string' ? { counterEntityId: literal(item.accessCounterEntityId) } : {}),
          ...(ranked && typeof item.accessKey === 'string' ? { visitKey: item.accessKey } : {}),
          bodyHint: `Opens ${String(item.title ?? roomId)}`,
          action: { type: 'dismiss-then-push', destination: { type: 'push', pageId, arguments: {}, origin: 'sender', duplicate: 'reuse-nearest' } },
        });
      });
    } else if (item && !navigation) {
      result.dropped.push({ path: `rooms.items[${items.indexOf(item)}]`, reason: 'The draft has no room-navigation source to hold the room; the page is reachable by its id only.' });
    }
  });
}
