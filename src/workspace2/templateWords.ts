/** The words of the Templates list, the Uses level, the editor and the delete question (studio-tpl-ux). Sentences say "places", never "uses". */
const places = (count: number) => `${count} ${count === 1 ? 'place' : 'places'}`;
export const templateWords = {
  add: 'Add to Page', addLabel: (name: string) => `Add ${name} to the page`, edit: 'Edit Template', rename: 'Rename', showUses: 'Show Uses', delete: 'Delete…', deletePlain: 'Delete',
  usesTitle: 'Uses', usesSummary: (count: number, pages: number, sheets = 0) => `${places(count)} on ${[pages && `${pages} ${pages === 1 ? 'page' : 'pages'}`, sheets && `${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`].filter(Boolean).join(' and ')}`, findUses: 'Find in uses',
  editorLine: (count: number) => count === 0 ? 'Template · Not used yet' : `Template · Used in ${places(count)}`,
  everywhere: (count: number) => count < 2 ? '' : `A change here shows in all ${places(count)}.`,
  deleteTitle: (name: string) => `Delete “${name}”?`,
  deleteText: (count: number) => count === 1
    ? 'It is used in 1 place. That place becomes its own copy, with the settings it has now, so its page looks the same. After that you change it on its own.'
    : `It is used in ${places(count)}. Each one becomes its own copy, with the settings it has now, so every page looks the same. After that you change each one on its own.`,
  deleteConfirm: 'Delete Template', cancel: 'Cancel',
  deleted: (name: string) => `Deleted ${name}.`, deletedCopies: (name: string, count: number) => `Deleted ${name}. ${count === 1 ? '1 place is now its own copy.' : `${count} places are now their own copies.`}`,
  find: 'Find Repeated Pieces', footHint: 'Drag onto the page. Click a template to edit it, or a component to add it.',
} as const;
