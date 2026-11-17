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
type Page = CompositionDocument['pages'][number];

/** Props of {@link SheetView}. */
export interface SheetViewProps {
  modal: Modal;
  /** Where the window puts the sheet ({@link sheetFrame}). */
  frame: SheetFrame;
  /** A page pushed inside the sheet, drawn in place of the modal's own components. */
  page?: Page;
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
export function SheetView({ modal, frame, page, top, onClose, onBack }: SheetViewProps) {
  const ctx = useRender();
  const selected = useIsSelected(ctx.store, `modal:${modal.id}`);
  // The present animation belongs to the sheet's arrival in Use. Fixed at mount: switching between Edit and Use never adds or
  // drops it, so an open sheet stays put instead of sliding in again.
  const [animate] = useState(ctx.mode === 'use');
  const { presentation } = modal;
  const surface = page ?? modal;
  return <div className="sh-sheet-layer" data-top={top ? '' : undefined} inert={!top || undefined} data-placement={frame.placement}
    style={{ '--sheet-w': frame.width === undefined ? undefined : `${frame.width}px`, '--sheet-h': frame.height === undefined ? undefined : `${frame.height}px`,
      '--sheet-max-h': frame.maxHeight === undefined ? undefined : `${frame.maxHeight}px`,
      '--sheet-safe': sheetReachesBottom(frame) ? 'var(--sh-safe-bottom)' : '0px' } as React.CSSProperties}>
    <div className="sh-dim"/>
    <section className="sh-sheet" role="dialog" aria-label={surface.title} data-sel={`modal:${modal.id}`} data-selected={selected && ctx.mode === 'edit' ? '' : undefined}
      data-height={presentation.height.type} data-full-screen={presentation.fullScreen ? '' : undefined} data-fills-height={frame.fillsHeight ? '' : undefined} data-appearance={sheetAppearance(presentation.appearance, ctx.appearance)} data-animate={animate ? '' : undefined}>
      <div className="sh-grabber" aria-hidden="true"/>
      <div className="sh-sheet-bar">
        <div className="sh-bar-side">{page && <button type="button" className="sh-circle" aria-label="Back" title="Back" onClick={() => { if (ctx.mode === 'use') onBack(); }}><ChevronLeft size={22}/></button>}</div>
        <h2 className="sh-sheet-title">{surface.title}</h2>
        <div className="sh-bar-side sh-trailing">{(presentation.close.visibility === 'all-depths' || !page) && <CloseButton onClose={onClose}/>}</div>
      </div>
      <PageBody key={surface.id} surface={surface} largeTitle={false}/>
    </section>
  </div>;
}
