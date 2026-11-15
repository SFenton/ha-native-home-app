/** The one place the preview's limits are said (spec 10, "Help"), and the keyboard shortcuts the Studio has. */
export const previewNote = 'The preview approximates iOS. Taps are simulated and never reach your devices.';

const shortcuts: readonly [keys: string, does: string][] = [
  ['⌘S or Ctrl S', 'Save the draft now'],
  ['Esc', 'Select what holds the selected tile'],
  ['↑ ↓ on Move', 'Move the tile one place'],
  ['Space or Enter on Move', 'Pick up a tile, then drop it'],
  ['↑ ↓ after picking up', 'Choose where it goes'],
  ['Esc while moving', 'Put it back'],
];

/** Project > Help: short and plain. */
export default function Help() {
  return <div className="w2-help">
    <p>{previewNote}</p>
    <section aria-label="Keyboard shortcuts"><h3 className="w2-group-title">Keyboard shortcuts</h3>
      <dl className="w2-shortcuts">{shortcuts.map(([keys, does]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{does}</dd></div>)}</dl>
    </section>
  </div>;
}
