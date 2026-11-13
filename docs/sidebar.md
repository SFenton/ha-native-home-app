# Pages, tabs, and component placement

The Project sidebar is a view of configured navigation, not a second folder
structure. Documents still store a flat `pages` array.

- **Tab root:** the page opened by that tab. A route into another tab's root
  does not make that root or its descendants children of the first tab.
- **Linked child:** reachable from one tab through component or toolbar
  actions, including routes through modals. Nesting and order show the first
  discovered route (toolbar actions, then components in their configured
  order). Cycles and repeated routes are not expanded repeatedly.
- **Shared page:** reachable from multiple tabs, listed separately with its
  owners rather than given an invented parent.
- **Unassigned page:** no tab route reaches it. This is not a deletion or an
  error; the initial page can also be unassigned. Ownership considers configured
  links, not current visibility conditions or whether a collection has records.

## Add, remove, and reorganize

**Add page** immediately creates and selects a child of the current page. The
**+** on a tab creates a child of that tab's root instead. Both create a real,
editable navigation tile in the source page in the same undoable edit as the
new page. Edit the new page in the inspector and edit its navigation tile
independently. When a modal/activity is selected, Add page creates an unassigned
page. Page organization actions also has an explicit **Add unassigned page**.

**Add tab** can create a root page or use an existing page. Tab actions include
rename and move earlier/later. Removing a tab keeps its pages and links.
Deleting a page clears references and removes tabs rooted on that page, using
the editor's existing deletion helper. Child pages are not deleted. Page/tab
removal requires confirmation; the last page cannot be deleted.

Use a page's **Links & placement** action to add a link or select one incoming
link to move. Choose its source page and start/end, before/after, or inside-group
placement. Moving one link leaves other incoming routes alone, so the page
may remain shared. Moving a toolbar link preserves its leading/trailing
placement and offers start/end within the destination toolbar. Removing a link
clears only that action, retaining the component or toolbar item and the page.

Page rows are not draggable folders. Their order follows real navigation
actions; reorder those links using Links & placement or the layer tools.
Direct destinations for moved links are pages; existing links from modals and
activity variants can be selected as sources. This bounded editor does not
bulk-reparent every route to a shared page.

## Context and keyboard operations

Use the visible action buttons or right-click tabs, pages, modals, activities,
layers, palette entries, or the page header. Focus an item and press
**Shift+F10** or the **Menu** key for the same contextual operations. Arrow
keys, Home, and End move among enabled commands. Escape dismisses the menu
and restores focus; clicking outside or leaving with Tab dismisses it too.

Layer **Move to** provides non-drag placement across surfaces, including
inside a group and before/after a component. Self/descendant destinations are
excluded and rejected. The complete proposal is validated before applying;
invalid depth, capacity, or references report an error without changing the
draft. Existing layer reorder controls and palette add/drag handles remain.
The palette context menu can explicitly insert inside the selected group.

All structural changes go through `SidebarProps.apply`, retaining the editor's
Undo history and unsaved draft behavior. The sidebar never saves, publishes,
or operates devices.

## Integration and focused checks

`SidebarProps` requires:

```ts
apply: (change: (draft: StudioDocument) => void) => void
```

`src/shared/navigation.ts` exports
`owningTabIds(document: StudioDocument, pageId: string): string[]`, in tab order,
and `linkedPageIds` for modal-aware direct-page adjacency. Neither mutates the
document.

Run the bounded suite:

```sh
npm test -- tests/sidebar.test.tsx tests/sidebar-commands.test.ts
```

These are document and jsdom interaction checks, not physical-device or live
Home Assistant evidence. The parent integration owns the full build and
browser checks.
