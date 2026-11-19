/**
 * Rewrites a stored document so the current compiler accepts what an earlier Studio wrote and the app now rejects.
 * Pure and idempotent: a document that needs nothing comes back unchanged with no changes listed.
 */
import { areasToNode, type TabsNode } from './layout-blocks';

const removedBedroomBedFields = ['tonightScript', 'outsideScheduleScript'] as const;
const removedBedroomEnvironmentFields = ['scheduleSetTopic', 'hotFlashBrokerScript', 'householdAwayScript'] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface CompositionMigration {
  document: unknown;
  /** One line per rewrite, with the pointer it applies to. */
  changes: string[];
}

/** Removes the five `bedroom-config@1` fields the app dropped (scripts and topics now resolve from the house document). */
export function migrateComposition(input: unknown): CompositionMigration {
  const document = structuredClone(input);
  const changes: string[] = [];
  const sources = record(document) && Array.isArray(document.dataSources) ? document.dataSources : [];
  sources.forEach((source, index) => {
    if (!record(source) || source.model !== 'bedroom-config@1' || !record(source.inputs)) return;
    const base = `/dataSources/${index}/inputs`;
    const beds = Array.isArray(source.inputs.beds) ? source.inputs.beds : [];
    beds.forEach((bed, bedIndex) => {
      if (!record(bed) || !record(bed.configuration)) return;
      for (const field of removedBedroomBedFields) {
        if (Object.hasOwn(bed.configuration, field)) { delete bed.configuration[field]; changes.push(`remove ${base}/beds/${bedIndex}/configuration/${field}`); }
      }
    });
    if (record(source.inputs.environment)) {
      for (const field of removedBedroomEnvironmentFields) {
        if (Object.hasOwn(source.inputs.environment, field)) { delete source.inputs.environment[field]; changes.push(`remove ${base}/environment/${field}`); }
      }
    }
  });
  return { document, changes };
}

/**
 * Stores every tab container's areas as `blocks` (`sh.tab-blocks@1`): the shipped shape's tab children become one area per tab, named by the tab id.
 * Pure and idempotent; a container that already has `blocks` is left as it is. The Studio calls this only through the storage rule (`areasToNode`),
 * never on load.
 */
export function tabsToBlocks(input: unknown): CompositionMigration {
  return rewriteTabs(input, node => {
    if (node.blocks) return undefined;
    return { ...node, tabs: node.tabs.map(tab => ({ ...tab, children: [] })), blocks: node.tabs.map(tab => ({ id: tab.id, tabs: [tab.id], children: tab.children })) };
  }, 'store areas as blocks');
}
/** The reverse: a container whose areas fit the shipped shape is written as `tabs[i].children` again. A container whose areas do not fit is left as it is. */
export function blocksToTabs(input: unknown): CompositionMigration {
  return rewriteTabs(input, node => {
    if (!node.blocks) return undefined;
    const next = areasToNode(node, node.blocks);
    return next.blocks ? undefined : next;
  }, 'store areas as tab children');
}
function rewriteTabs(input: unknown, change: (node: TabsNode) => TabsNode | undefined, what: string): CompositionMigration {
  const document = structuredClone(input);
  const changes: string[] = [];
  const visit = (value: unknown, pointer: string): unknown => {
    if (Array.isArray(value)) return value.map((item, index) => visit(item, `${pointer}/${index}`));
    if (!record(value)) return value;
    let node: Record<string, unknown> = value;
    if (value.type === 'local-tabs' && Array.isArray(value.tabs)) {
      const changed = change(value as unknown as TabsNode);
      if (changed) { node = changed as unknown as Record<string, unknown>; changes.push(`${what} at ${pointer}`); }
    }
    for (const key of Object.keys(node)) node[key] = visit(node[key], `${pointer}/${key}`);
    return node;
  };
  return { document: visit(document, ''), changes };
}

/**
 * "Start a new column set here" (`standalone`) is "Full width" plus "Open pages beside this one" (`wideOpen: "full"`, `sh.page-wide-open@1`): each columns page with
 * `standalone: true` and no `wideOpen` of its own gets `wideOpen: "full"`. The contract keeps accepting `standalone`, so it stays where it is. Pure and idempotent.
 *
 * Writing the field makes the document need `sh.page-wide-open@1`, which an older app refuses, so the Studio calls this only for a target that has the capability,
 * never on load.
 */
export function standaloneToWideOpen(input: unknown): CompositionMigration {
  const document = structuredClone(input);
  const changes: string[] = [];
  const pages = record(document) && Array.isArray(document.pages) ? document.pages : [];
  pages.forEach((page, index) => {
    if (!record(page) || !record(page.navigation) || page.navigation.type !== 'navigation-columns' || page.navigation.standalone !== true || page.wideOpen !== undefined) return;
    page.wideOpen = 'full';
    changes.push(`write wideOpen full at /pages/${index}/wideOpen`);
  });
  return { document, changes };
}
