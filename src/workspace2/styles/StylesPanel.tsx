import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronRight, Lock, MoreHorizontal } from 'lucide-react';
import { builtInStyles } from '../../shared/composition/state-styles';
import { deleteBlock, deleteStyle, duplicateStyle, renameStyle, usedByText } from '../../shared/composition/state-style-library';
import { usePush } from '../kit';
import { TextInput } from '../editors/controls';
import { useRows } from '../rowsContext';
import { NewFromEntity } from './NewFromEntity';
import { StylePage } from './StylePage';
import { styleUses } from './useStyle';
import './styles.css';

/**
 * State Styles (studio-ux2, pick 7): the style library of the project, the 2.0 home of the 1.0 Styles panel. "Saved" lists the
 * project's own styles with "Used by N tiles" and a More menu; "Built-In" lists the eight styles the app ships, read-only. Each
 * row pushes the style's page.
 */
export function StylesPanel() {
  const { document, onChange, onError } = useRows();
  const push = usePush();
  const [renaming, setRenaming] = useState<string>();
  const library = document.stateStyles;
  const saved = library?.styles ?? [];
  const open = (id: string, name: string) => push?.push({ title: name, body: <StylePage id={id}/> });
  const run = (action: () => void) => { try { action(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  return <div className="w2-styles-panel">
    <section aria-label="Saved"><h3 className="w2-group-title">Saved</h3>
      {saved.length === 0 && <p className="w2-caption">No saved styles yet. Duplicate a built-in style, or make one from an entity.</p>}
      <ul className="w2-style-list">
        {saved.map(item => {
          const blocked = deleteBlock(document, item.id);
          return <li key={item.id} className="w2-style-row">
            {renaming === item.id
              ? <div className="w2-style-rename"><TextInput label={`Name of ${item.name}`} value={item.name} maxLength={80}
                onCommit={name => name.trim() && library && onChange(({ ...document, stateStyles: renameStyle(library, item.id, name.trim()) }), `style-name:${item.id}`)}/>
                <button type="button" onClick={() => setRenaming(undefined)}>Done</button></div>
              : <button type="button" className="w2-link-row" onClick={() => open(item.id, item.name)}>
                <span className="w2-style-text"><span className="w2-page-title">{item.name}</span><span className="w2-page-via">{usedByText(styleUses(document, item.id))}</span></span><ChevronRight size={16} aria-hidden/></button>}
            <Menu.Root>
              <Menu.Trigger className="w2-icon-button" aria-label={`More for ${item.name}`}><MoreHorizontal size={18} aria-hidden/></Menu.Trigger>
              <Menu.Portal><Menu.Positioner sideOffset={6} align="end" className="w2-positioner"><Menu.Popup className="w2-scope w2-menu">
                <Menu.Item className="w2-menu-item" onClick={() => setRenaming(item.id)}>Rename</Menu.Item>
                <Menu.Item className="w2-menu-item" onClick={() => run(() => { const copy = duplicateStyle(library, item); onChange({ ...document, stateStyles: copy.library }); })}>Duplicate</Menu.Item>
                <Menu.Item className="w2-menu-item w2-danger-item" disabled={Boolean(blocked)} onClick={() => run(() => onChange({ ...document, stateStyles: deleteStyle(document, item.id) }))}>
                  <span className="w2-choice-text">Delete{blocked && <small className="w2-choice-note">{blocked}</small>}</span></Menu.Item>
              </Menu.Popup></Menu.Positioner></Menu.Portal>
            </Menu.Root>
          </li>;
        })}
      </ul>
      <button type="button" className="w2-link-row w2-new-style" onClick={() => push?.push({ title: 'New Style From an Entity…', body: <NewFromEntity/> })}>
        <span>New Style From an Entity…</span><ChevronRight size={16} aria-hidden/></button>
    </section>
    <section aria-label="Built-In"><h3 className="w2-group-title">Built-In</h3>
      <ul className="w2-style-list">
        {builtInStyles.map(item => <li key={item.id} className="w2-style-row">
          <button type="button" className="w2-link-row" onClick={() => open(item.id, item.name)}>
            <Lock size={14} aria-hidden className="w2-lock"/><span className="w2-style-text"><span className="w2-page-title">{item.name}</span><span className="w2-page-via">{usedByText(styleUses(document, item.id))}</span></span><ChevronRight size={16} aria-hidden/></button>
        </li>)}
      </ul>
    </section>
  </div>;
}
