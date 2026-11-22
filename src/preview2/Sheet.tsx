import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';
import { CloseButton } from './Chrome';
import { PageBody } from './PageView';
import { useRender } from './render-context';
import { useIsSelected } from './selection-store';
import type { SheetFrame } from './sheet-frame';
import { sheetAppearance } from './sheet-appearance';
import { sheetReachesBottom } from './tab-dock';

type Modal = CompositionDocument['modals'][number];
type Page = CompositionDocument['pages'][number] | NonNullable<CompositionDocument['levels']>[number];

/** Props of {@link SheetView}. */
export interface SheetViewProps {
  modal: Modal;
  /** Where the window puts the sheet ({@link sheetFrame}). */
  frame: SheetFrame;
  /** A page (or, with `levels[]`, a level) pushed inside the sheet, drawn in place of the modal's own components. */
  page?: Page;
  /** A level shows Close at every depth beside Back (a level stays in its sheet with Back and Close); neither is ever hidden. */
  closeAlways?: boolean;
  /** A level no sheet opens, drawn in a sheet of its own: no modal stands behind it, so the sheet's own selection is the level on show. */
  alone?: boolean;
  /** Whether a level is pushed beneath the one on show, so Back has somewhere to go. A level drawn alone has none until it pushes another. */
  back?: boolean;
  /** The title of the surface Back returns to: the sheet, or the level beneath. Back is live in Edit as well as in Use; Close is not. */
  backTo?: string;
  /** The folded Duo: Back and Close sit in the rail on the camera's centre line, below its keep-clear region, and the bar holds the title alone. */
  rail?: { centre: number; top: number; side: 'leading' | 'trailing'; back: boolean };
  /** Only the top sheet takes input. */
  top: boolean;
  onClose: () => void;
  onBack: () => void;
}
/**
 * A sheet drawn presented: a ground that follows the Studio's Appearance setting, or the browser's when that follows the system (dark when the sheet asks for it, {@link sheetAppearance}), the grabber, an
 * inline title with a back button when a page is pushed and the circle close button trailing. `Fitted` sizes to its content up
 * to the large height; `Full` fills it. A full-screen sheet covers the whole window. The frame says where it sits: full-width
 * bottom card, the Duo's leading half, or a centred form or page sheet.
 */
export function SheetView({ modal, frame, page, closeAlways, alone, back, backTo, rail, top, onClose, onBack }: SheetViewProps) {
  const ctx = useRender();
  // A level on show is the surface: a click on its bar or empty area selects the level (its Level Settings), not the sheet it is shown in. A page pushed in a sheet of a document without levels is the sheet's.
  const ownKey = (alone || closeAlways) && page ? `level:${page.id}` as const : `modal:${modal.id}` as const;
  const selected = useIsSelected(ctx.store, ownKey);
  // The present animation belongs to the sheet's arrival in Use. Fixed at mount: switching between Edit and Use never adds or
  // drops it, so an open sheet stays put instead of sliding in again.
  const [animate] = useState(ctx.mode === 'use');
  const { presentation } = modal;
  const surface = page ?? modal;
  const backTitle = backTo ? `Back to ${backTo}` : 'Back';
  return <div className="sh-sheet-layer" data-top={top ? '' : undefined} inert={!top || undefined} data-placement={frame.placement}
    style={{ '--sheet-w': frame.width === undefined ? undefined : `${frame.width}px`, '--sheet-h': frame.height === undefined ? undefined : `${frame.height}px`,
      '--sheet-max-h': frame.maxHeight === undefined ? undefined : `${frame.maxHeight}px`,
      '--sheet-safe': sheetReachesBottom(frame) ? 'var(--sh-safe-bottom)' : '0px' } as React.CSSProperties}>
    <div className="sh-dim"/>
    <section className="sh-sheet" role="dialog" aria-label={surface.title} data-sel={ownKey} data-selected={selected && ctx.mode === 'edit' ? '' : undefined}
      data-height={presentation.height.type} data-full-screen={presentation.fullScreen ? '' : undefined} data-fills-height={frame.fillsHeight ? '' : undefined} data-appearance={sheetAppearance(presentation.appearance, ctx.appearance)} data-rail-side={rail?.side} data-animate={animate ? '' : undefined}>
      <div className="sh-grabber" aria-hidden="true"/>
      <div className="sh-sheet-bar">
        <div className="sh-bar-side">{page && (back ?? !alone) && !rail && <button type="button" className="sh-circle" aria-label="Back" title={backTitle} data-passthrough="" onClick={onBack}><ChevronLeft size={22}/></button>}</div>
        <h2 className="sh-sheet-title">{surface.title}</h2>
        <div className="sh-bar-side sh-trailing">{!rail && (closeAlways || presentation.close.visibility === 'all-depths' || !page) && <CloseButton onClose={onClose}/>}</div>
      </div>
      <PageBody key={surface.id} surface={surface} largeTitle={false}/>
    </section>
    {rail && <div className="sh-sheet-rail" data-side={rail.side} data-appearance={sheetAppearance(presentation.appearance, ctx.appearance)} style={{ left: rail.centre, top: rail.top } as React.CSSProperties}>
      {rail.back && <button type="button" className="sh-circle" aria-label="Back" title={backTitle} data-leading="back" data-passthrough="" onClick={onBack}><ChevronLeft size={22}/></button>}
      {(closeAlways || presentation.close.visibility === 'all-depths' || !page) && <CloseButton onClose={onClose}/>}
    </div>}
  </div>;
}
