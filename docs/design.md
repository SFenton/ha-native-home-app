# Studio design notes

The Studio has one workspace: **direction A, Preview first**. The spec is
`build/design/studio-ux/spec.md`; these are the rules that outlast it.

- **Preview first.** The canvas is the page. Properties appear for the selection only: a 376 px card wide, a bottom sheet narrow (snap points 88 px, half, full; opens at half; a swipe down from the header alone closes it).
- **Narrow rule.** `(max-width: 870px), (max-height: 500px)`. Targets are 44 px on coarse pointers. One sheet at a time; deeper pages push inside it.
- **Control budget.** Wide: 9 controls on the top bar. Narrow: 4 on the top bar and Edit/Use below.
- **Fields.** Properties reuse the field generator with a label map (`src/workspace2/labels.ts`); fixed single-value fields are hidden; unmapped fields go to Advanced with a mechanical label.
- **No generated lists.** In the workspace the field generator draws rows only: a part is a titled group, a list item is a disclosure row (`src/workspace2/Disclosure.tsx`), never a fieldset or a `<details>`. The Project dialogs (`src/workspace2/dialogs/`) are authored rows; a list row pushes a page of its own fields. The one place the document shows as it is stored is Edit as JSON. `tests/workspace2-no-generated-lists.test.tsx` fails when either markup returns.
- **Words.** Title Case for buttons and menu commands, sentence case elsewhere; the only product name is "S+H Studio".
- **Theme.** The chrome reads Home Assistant's variables from the parent frame when it is same-origin, follows `prefers-color-scheme` otherwise, corrects derived text colours to 4.5:1, and gives the preview `--studio-selection`. The preview never takes chrome colours.
- **Saving.** Autosave after 1.5 s with a visible status tag. One Publish; a conflict asks which version to keep.
- **Drag and drop.** A drop target shows the exact insertion point. Handles also take Space, arrow keys and Escape. Touch dragging needs a deliberate hold and cancels when a second finger joins; the properties menu offers a non-drag move.
- **Safety.** Service calls in the preview are simulated; previewing a button never controls the house. Device frames are browser previews, not iOS emulators. The one place that says so is Project > Help.
- **Copy.** Every surface's visible text is a snapshot in `tests/snapshots/copy/` and is held to the voice rules by `tests/support/copy.ts` (Title Case buttons, sentence case labels, no dashes, AI-isms or reassurance). A copy change updates the snapshot in the same commit (`vitest -u`) and is read in the diff.

The preview (`src/preview2/`) renders the composition from `src/shared/composition/`
and the house states from `/api/native-home`; the workspace chrome is
`src/workspace2/`.
