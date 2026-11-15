import { ChevronLeft } from 'lucide-react';
import type { CompositionDocument } from '../shared/composition/schema';
import { CloseButton } from './Chrome';
import { PageBody } from './PageView';
import { useRender } from './render-context';
import { useIsSelected } from './selection-store';

type Modal = CompositionDocument['modals'][number];
type Page = CompositionDocument['pages'][number];

/** Props of {@link SheetView}. */
export interface SheetViewProps {
  modal: Modal;
  /** A page pushed inside the sheet, drawn in place of the modal's own components. */
  page?: Page;
  /** Only the top sheet takes input. */
  top: boolean;
  onClose: () => void;
  onBack: () => void;
}
/**
 * A sheet drawn presented: a ground that follows the browser's appearance (dark when the sheet asks for it), the grabber, an
 * inline title with a back button when a page is pushed and the circle close button trailing. `Fitted` sizes to its content up
 * to the large height; `Full` fills it. A full-screen sheet covers the whole window.
 */
export function SheetView({ modal, page, top, onClose, onBack }: SheetViewProps) {
  const ctx = useRender();
  const selected = useIsSelected(ctx.store, `modal:${modal.id}`);
  const { presentation } = modal;
  const surface = page ?? modal;
  return <div className="sh-sheet-layer" data-top={top ? '' : undefined} inert={!top || undefined}>
    <div className="sh-dim"/>
    <section className="sh-sheet" role="dialog" aria-label={surface.title} data-sel={`modal:${modal.id}`} data-selected={selected && ctx.mode === 'edit' ? '' : undefined}
      data-height={presentation.height.type} data-full-screen={presentation.fullScreen ? '' : undefined} data-appearance={presentation.appearance} data-animate={ctx.mode === 'use' ? '' : undefined}>
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
