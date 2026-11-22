import { useEffect } from 'react';
import { PlainSelect } from '../ui';
import { ArrowDown, ArrowUp, ChevronRight, ImageOff } from 'lucide-react';
import { apiUrl } from '../api';
import { removeCompositionItem, reorderCompositionItem } from '../composition-editor';
import { GlyphByName } from '../preview2/nodes/shared';
import { fillTabGroups, groupWithRoom, tabGroups, type TabGroup } from './capacity';
import { ObjectRows, useRows } from './rows';
import { useDeepRows } from './editors/overrides';
import { Disclosure } from './Disclosure';
import { PushStack, Tag, usePush } from './kit';
import { toastManager } from './toasts';
import { createPage, createTab } from './navigation/controller';
import { setTabPage } from './navigation/edit';

/** The Tabs panel (spec 5.2): a reorderable list in groups from the capacity table, each row pushing its fields. */
export function TabsPanel({ selectedTab, groups = tabGroups }: { selectedTab?: string; groups?: readonly TabGroup[] }) {
  const { document, onChange, onError } = useRows();
  const push = usePush();
  const tabs = document.navigation.tabs;
  const filled = fillTabGroups(tabs, groups), room = groupWithRoom(tabs, groups);
  const full = !room;
  const move = (index: number, offset: number) => { try { onChange(reorderCompositionItem(document, ['navigation', 'tabs'], index, offset)); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const add = () => { void createTab(); };
  const open = (index: number) => push?.push({ title: tabs[index].label, body: <TabFields index={index}/> });
  useEffect(() => { const at = tabs.findIndex(tab => tab.id === selectedTab); if (at >= 0) open(at); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  let at = 0;
  return <div className="w2-tabs-panel">
    {filled.map(({ group, tabs: held }) => <section key={group.id} aria-label={group.title}>
      <h3 className="w2-group-title">{group.title}{group.capacity !== undefined && ` · ${held.length} of ${group.capacity}`}</h3>
      <ul className="w2-tab-list">
        {held.map(tab => {
          const index = at++;
          return <li key={tab.id} className="w2-tab-row">
            <button type="button" className="w2-tab-open" onClick={() => open(index)} aria-label={`${tab.label}, ${document.pages.find(page => page.id === tab.pageId)?.title ?? ''}`}>
              <GlyphByName name={tab.icon.name} size={18}/>
              <span className="w2-page-text"><span className="w2-page-title">{tab.label}</span><span className="w2-page-via">{document.pages.find(page => page.id === tab.pageId)?.title ?? tab.pageId}</span></span>
              {document.navigation.initialTabId === tab.id && <Tag>Opens First</Tag>}{'visibleWhen' in tab && tab.visibleWhen && <Tag>Rule</Tag>}<ChevronRight size={16} aria-hidden/>
            </button>
            <button type="button" className="w2-icon-button" aria-label={`Move ${tab.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden/></button>
            <button type="button" className="w2-icon-button" aria-label={`Move ${tab.label} down`} disabled={index === tabs.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden/></button>
          </li>;
        })}
      </ul>
    </section>)}
    <div className="w2-tabs-add">
      <button type="button" disabled={full} aria-describedby={full ? 'w2-tabs-full' : undefined} onClick={add}>Add Tab</button>
      {full && <p id="w2-tabs-full" className="w2-caption">{groups.at(-1)?.full ?? 'The tab bar holds 5.'}</p>}
    </div>
    <p className="w2-caption">iPad shows these in its sidebar.</p>
  </div>;
}

/** The tab's Page row: every page, then "New Page…", which makes a page and points the tab at it in one undo step. */
function TabPage({ index }: { index: number }) {
  const { document, onChange } = useRows();
  const tab = document.navigation.tabs[index];
  return <div className="w2-row" data-field-path={`navigation/tabs/${index}/pageId`}>
    <label className="field"><span>Page</span>
      <PlainSelect label="Page" value={tab.pageId} options={[...document.pages.map(page => ({ value: page.id, label: page.title })), { value: '__new', label: 'New Page…' }]} onChange={choice => {
        if (choice === '__new') { void createPage({ hideLink: true, switchTo: false, connect: (made, id) => setTabPage(made, index, id) }); return; }
        onChange(setTabPage(document, index, choice));
      }}/></label>
  </div>;
}

/** One tab's fields, with "Opens first" as a switch on the document's initial tab and a "Remove Tab" row. */
function TabFields({ index }: { index: number }) {
  const { document, onChange, onError } = useRows();
  const push = usePush();
  const tab = document.navigation.tabs[index];
  const overrides = useDeepRows(['navigation', 'tabs', index]);
  if (!tab) return null;
  const first = document.navigation.initialTabId === tab.id;
  const setFirst = (on: boolean) => onChange({ ...document, navigation: { ...document.navigation, initialTabId: on ? tab.id : null, initialPageId: on ? tab.pageId : document.navigation.initialPageId } });
  return <>
    <ObjectRows path={['navigation', 'tabs', index]} owner="tab" skip={at => at.at(-1) === 'pageId'} overrides={overrides} extra={{ what: <TabPage index={index}/>, look: <div className="w2-row" data-field-path={`navigation/tabs/${index}/opensFirst`}>
      <label className="w2-switch-row"><span className="w2-row-label">Opens first</span><input type="checkbox" role="switch" checked={first} onChange={event => setFirst(event.target.checked)}/></label>
    </div> }}/>
    <div className="w2-row"><button type="button" className="w2-danger" onClick={() => {
      try { onChange(removeCompositionItem(document, ['navigation', 'tabs'], index)); push?.pop(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    }}>Remove Tab</button></div>
  </>;
}

export { HeaderPanel } from './navigation/HeaderPanel';

/** Wallpaper (spec 5.2): a read-only thumbnail of the current image, "No Image", and the blur and scrim rows. No hash, byte count or "immutable" wording. */
export function WallpaperPanel() {
  const { document, onChange } = useRows();
  const current = document.assets[0];
  return <div className="w2-wallpaper">
    <div className="w2-wallpaper-now">{current
      ? <img src={apiUrl(`/native${current.source.path}`)} alt="Current wallpaper" width={72} height={72} className="w2-thumb"/>
      : <div className="w2-thumb w2-thumb-none" role="img" aria-label="No image"><ImageOff size={24} aria-hidden/></div>}</div>
    <div className="w2-wallpaper-actions">
      <button type="button" disabled={!current} onClick={() => onChange({ ...document, assets: [], theme: { ...document.theme, background: { type: 'solid', token: 'shell-base@1' } } })}>No Image</button>
    </div>
    {document.theme.background.type === 'downloaded' && <Disclosure label="Advanced" path="theme/background">
      <ObjectRows path={['theme', 'background']} owner="background" skip={at => at.at(-1) === 'assetId'}/>
    </Disclosure>}
  </div>;
}
export { PushStack, toastManager };
