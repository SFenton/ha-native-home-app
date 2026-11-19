import { AppWindow, Database, Dock, Layers, PanelBottom, LayoutGrid, SlidersHorizontal, Workflow } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { categories, type Category } from './layout';

/** What the rail and the panel call a category, and its glyph. The label is the visible word, so it is also the accessible name. */
export const categoryInfo: Record<Category, { label: string; icon: (size: number) => ReactNode }> = {
  tabs: { label: 'Tabs', icon: size => <Dock size={size} aria-hidden/> },
  pages: { label: 'Pages', icon: size => <Layers size={size} aria-hidden/> },
  sheets: { label: 'Sheets', icon: size => <PanelBottom size={size} aria-hidden/> },
  modals: { label: 'Modals', icon: size => <AppWindow size={size} aria-hidden/> },
  components: { label: 'Components', icon: size => <LayoutGrid size={size} aria-hidden/> },
  controls: { label: 'Controls', icon: size => <SlidersHorizontal size={size} aria-hidden/> },
  flows: { label: 'Flows', icon: size => <Workflow size={size} aria-hidden/> },
  data: { label: 'Data', icon: size => <Database size={size} aria-hidden/> },
};

/**
 * The library rail's category buttons on the leading edge. The button whose panel is open is pressed; pressing it closes the
 * panel, pressing another switches category. Arrow keys move between the buttons (one tab stop, as a toolbar does).
 */
export default function LibraryRail({ category, open, onPress, inert }: { category: Category; open: boolean; onPress: (category: Category) => void; /** The flyout covers the rail; nothing under it takes focus. */ inert?: boolean }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: -1000, End: 1000 };
    if (!(event.key in keys)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = Math.min(buttons.length - 1, Math.max(0, event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : at + keys[event.key]));
    event.preventDefault();
    buttons[next]?.focus();
  };
  return <div className="w2-lib-rail" role="toolbar" aria-label="Library" aria-orientation="vertical" onKeyDown={move} inert={inert} data-testid="library-rail">
    {categories.map(item => <button key={item} type="button" className="w2-lib-rail-button" data-category={item} aria-pressed={open && item === category} tabIndex={item === category ? 0 : -1}
      onClick={() => onPress(item)}><span className="w2-lib-glyph">{categoryInfo[item].icon(20)}</span><span className="w2-lib-label">{categoryInfo[item].label}</span></button>)}
  </div>;
}
