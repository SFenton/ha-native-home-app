import type { CompositionDocument } from '../shared/composition/schema';

type Level = NonNullable<CompositionDocument['levels']>[number];
type Modal = CompositionDocument['modals'][number];

/**
 * The sheet a level no sheet opens is drawn in: the app's canonical form sheet, sized to its content, with Close and no Back. A level carries no
 * presentation of its own (`sh.sheet-levels@1`), so the Studio shows it the way it shows any sheet nothing presents, over the dimmed empty page.
 */
export function aloneSheet(level: Level): Modal {
  return {
    ...level,
    presentation: {
      type: 'sheet', width: 'form', height: { type: 'fitted', follows: 'root', firstOpen: 'canonical@1' }, appearance: 'system', placement: 'canonical-sheet@1',
      grabber: 'canonical', navigation: 'local-stack@1',
      close: { type: 'close', visibility: 'root-only', placement: 'trailing', rail: 'automatic', guard: { type: 'none' } },
    },
  };
}
