import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import { apiUrl, request } from '../api';
import { createId as uid } from '../shared/ids';
import { removeCompositionItem, reorderCompositionItem } from '../composition-editor';
import type { UploadedCompositionAsset } from '../shared/composition/workspace';
import { Icon } from '../ui';
import { fillTabGroups, groupWithRoom, tabGroups, type TabGroup } from './capacity';
import { ObjectRows, useRows } from './rows';
import { Disclosure } from './Disclosure';
import { ChromeGroups } from './ChromeGroups';
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
              <Icon name={tab.icon.name} size={18}/>
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
      <select value={tab.pageId} onChange={event => {
        if (event.target.value === '__new') { void createPage({ hideLink: true, switchTo: false, connect: (made, id) => setTabPage(made, index, id) }); return; }
        onChange(setTabPage(document, index, event.target.value));
      }}>
        {document.pages.map(page => <option key={page.id} value={page.id}>{page.title}</option>)}
        <option value="__new">New Page…</option>
      </select></label>
  </div>;
}

/** One tab's fields, with "Opens first" as a switch on the document's initial tab and a "Remove Tab" row. */
function TabFields({ index }: { index: number }) {
  const { document, onChange, onError } = useRows();
  const push = usePush();
  const tab = document.navigation.tabs[index];
  if (!tab) return null;
  const first = document.navigation.initialTabId === tab.id;
  const setFirst = (on: boolean) => onChange({ ...document, navigation: { ...document.navigation, initialTabId: on ? tab.id : null, initialPageId: on ? tab.pageId : document.navigation.initialPageId } });
  return <>
    <ObjectRows path={['navigation', 'tabs', index]} owner="tab" skip={at => at.at(-1) === 'pageId'} extra={{ what: <TabPage index={index}/>, look: <div className="w2-row" data-field-path={`navigation/tabs/${index}/opensFirst`}>
      <label className="w2-switch-row"><span className="w2-row-label">Opens first</span><input type="checkbox" role="switch" checked={first} onChange={event => setFirst(event.target.checked)}/></label>
    </div> }}/>
    <div className="w2-row"><button type="button" className="w2-danger" onClick={() => {
      try { onChange(removeCompositionItem(document, ['navigation', 'tabs'], index)); push?.pop(); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    }}>Remove Tab</button></div>
  </>;
}

/** The app-wide header buttons (spec 5.2): leading and trailing, each button a row. */
export function HeaderPanel() {
  return <div className="w2-form"><ChromeGroups path={['navigation', 'chrome', 'groups']}/></div>;
}

/** Wallpaper (spec 5.2): the current image, upload, earlier uploads, "No Image". No hash, byte count or "immutable" wording. */
export function WallpaperPanel() {
  const { document, onChange } = useRows();
  const [assets, setAssets] = useState<UploadedCompositionAsset[]>([]);
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    request<UploadedCompositionAsset[]>('/native/api/assets').then(list => { if (alive) setAssets(list); }).catch(() => { /* the list is a convenience */ });
    return () => { alive = false; };
  }, []);
  const current = document.assets[0];
  const choose = (asset: UploadedCompositionAsset) => {
    const id = document.assets.find(item => item.sha256 === asset.sha256)?.id ?? uid('backdrop');
    onChange({
      ...document, assets: [{ ...asset, id, role: 'backdrop' }],
      theme: { ...document.theme, background: {
        type: 'downloaded', assetId: id, recipe: 'house-r3@1', blur: { type: 'preference', key: 'backdrop-blur', initialPercent: 50 },
        scrim: { type: 'canonical@1' }, motion: 'stationary@1', reducedTransparency: 'canonical-base@1',
      } },
    });
  };
  const upload = async (file: File) => {
    if (file.size < 1 || file.size > 8388608 || !['image/png', 'image/jpeg'].includes(file.type)) { setError('Choose a PNG or JPEG up to 8 MB.'); return; }
    setUploading(true); setError('');
    try {
      const asset = await request<UploadedCompositionAsset>('/native/api/assets', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      setAssets(list => [...list.filter(item => item.sha256 !== asset.sha256), asset]);
      choose(asset);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); }
  };
  const thumb = (source: string, label: string) => <img src={apiUrl(`/native${source}`)} alt={label} width={72} height={72} className="w2-thumb"/>;
  return <div className="w2-wallpaper">
    <div className="w2-wallpaper-now">{current ? thumb(current.source.path, 'Current wallpaper') : <div className="w2-thumb w2-thumb-none" role="img" aria-label="No image">No Image</div>}</div>
    <div className="w2-wallpaper-actions">
      <input ref={input} hidden type="file" accept="image/png,image/jpeg" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }}/>
      <button type="button" disabled={uploading} onClick={() => input.current?.click()}>Choose Image…</button>
      <button type="button" disabled={!current} onClick={() => onChange({ ...document, assets: [], theme: { ...document.theme, background: { type: 'solid', token: 'shell-base@1' } } })}>No Image</button>
    </div>
    <p className="w2-caption">PNG or JPEG, up to 8 MB.</p>
    {error && <p role="alert" className="w2-error-text">{error}</p>}
    {document.theme.background.type === 'downloaded' && <Disclosure label="Advanced" path="theme/background">
      <ObjectRows path={['theme', 'background']} owner="background" skip={at => at.at(-1) === 'assetId'}/>
    </Disclosure>}
    {assets.length > 0 && <section aria-label="Earlier images"><h3 className="w2-group-title">Earlier images</h3>
      <div className="w2-thumb-row">{assets.map((asset, at) => <button type="button" key={asset.sha256} className="w2-thumb-button" aria-label={`Use earlier image ${at + 1}`} aria-pressed={current?.sha256 === asset.sha256} onClick={() => choose(asset)}>{thumb(asset.source.path, '')}</button>)}</div>
    </section>}
  </div>;
}
export { PushStack, toastManager };
