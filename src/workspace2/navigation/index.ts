/** Navigation authoring: the entry points the action editor's "New Page…" and "New Sheet…" rows call at merge. */
export { createLevel, createPage, createSheet, createTab, type CreatePageOptions, type CreateSheetOptions } from './controller';

import type { CompositionDocument } from '../../shared/composition/schema';
import type { CreateFlow } from '../pickers/WorkspaceData';
import { createPage, createSheet } from './controller';

/**
 * The action editor's "New Page…": the one New Page dialog without "Link from" (the action is the link), staying on the page being
 * edited. The editor adopts the new page into its draft, so the page and the action it points at land in one undo step on Done.
 */
export const newPageFlow: CreateFlow = done => {
  let after: CompositionDocument | undefined;
  void createPage({ hideLink: true, switchTo: false, connect: (document) => { after = document; return document; } })
    .then(id => { if (id && after) done({ id, document: after }); });
};

/** The action editor's "New Sheet…": the one New Sheet dialog, leaving the preview where it is. */
export const newSheetFlow: CreateFlow = done => {
  let after: CompositionDocument | undefined;
  void createSheet({ open: false, connect: document => { after = document; return document; } })
    .then(id => { if (id && after) done({ id, document: after }); });
};
