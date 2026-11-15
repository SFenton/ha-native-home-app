import { ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import type { Json } from '../../shared/types';
import { replaceAt, valueAt, type EditorPath } from '../../composition-editor';
import CompositionFields from '../../CompositionFields';
import IdRow from '../IdRow';
import { ChromeGroups } from '../ChromeGroups';
import { usePush } from '../kit';
import { collectLinks } from '../outline';
import { fieldOptions, ObjectRows, useRows, type RowOverride } from '../rows';
import type { Workspace2 } from '../useWorkspace2';
import { useDeepRows } from '../editors/overrides';
import { LinksList } from './Links';

type Page = CompositionDocument['pages'][number];
type Modal = CompositionDocument['modals'][number];
type Key = `${'page' | 'modal' | 'node'}:${string}`;

/** "Opened from": the pages and tiles whose actions open this page or sheet; each row goes there (spec 5.2). */
export function OpenedFrom({ document, kind, id, onGo }: { document: CompositionDocument; kind: 'page' | 'modal'; id: string; onGo: (key: Key) => void }) {
  const links = collectLinks(document).filter(link => link.to.kind === kind && link.to.id === id);
  const surfaces = [...document.pages, ...document.modals];
  const via = document.navigation.tabs.filter(tab => kind === 'page' && tab.pageId === id);
  return <section className="w2-group" aria-label="Opened from"><h3 className="w2-group-title">Opened from</h3>
    {links.length + via.length === 0 ? <p className="w2-caption">{kind === 'page' ? 'Nothing opens this page.' : 'Nothing opens this sheet.'}</p>
      : <ul className="w2-move-list">
        {via.map(tab => <li key={tab.id}><button type="button" className="w2-link-row" onClick={() => onGo(`page:${id}`)}><span>{tab.label}</span><span className="w2-page-via">Tab</span><ChevronRight size={16} aria-hidden/></button></li>)}
        {links.map((link, at) => <li key={at}><button type="button" className="w2-link-row" onClick={() => onGo(link.holder ? `node:${link.holder.id}` : `${link.from.kind}:${link.from.id}`)}>
          <span>{link.holder?.title ?? surfaces.find(item => item.id === link.from.id)?.title}</span><span className="w2-page-via">{surfaces.find(item => item.id === link.from.id)?.title}</span><ChevronRight size={16} aria-hidden/></button></li>)}
      </ul>}
  </section>;
}

/** A switch row with an optional caption under it. */
function SwitchRow({ label, checked, onChange, disabled, caption, path }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; caption?: string; path?: string }) {
  return <>
    <label className="w2-switch-row" data-field-path={path}><span className="w2-row-label w2-wide-label">{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/></label>
    {caption && <p className="w2-caption">{caption}</p>}
  </>;
}

/**
 * Page settings and Sheet settings (spec 5.2): the surface's own fields as rows, the split switch, "Opens from outside the app"
 * (the page's links, pushed as a list), "Opened from", and Advanced. A page opens pages beside it by `navigation-columns`; a
 * sheet opens beside the list with `adaptive`, never together with Full screen.
 */
export default function SurfaceSettings({ ws, kind, path, onGo }: { ws: Workspace2; kind: 'page' | 'modal'; path: EditorPath; onGo: (key: Key) => void }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const surface = valueAt(document, path) as Page & Modal;
  const owner = kind === 'page' ? 'page' : 'sheet';
  const skip = (at: EditorPath) => at.at(-1) === 'components' || (kind === 'page' && at.at(-1) === 'navigation');
  const set = (at: EditorPath, value: Json) => onChange(replaceAt(document, at, value));
  const options = fieldOptions(owner, path);
  const columns = kind === 'page' && surface.navigation.type === 'navigation-columns';
  const presentation = kind === 'modal' ? surface.presentation : undefined;
  const setPresentation = (patch: Record<string, Json>) => set([...path, 'presentation'], { ...presentation, ...patch } as unknown as Json);
  const deep = useDeepRows(path);
  /** "Header buttons": the app's, or this surface's own. Pages and sheets both have them. */
  const toolbar: RowOverride = ({ path: at }) => {
      const custom = surface.toolbar.type === 'replace';
      return <>
        <div className="w2-segment" role="group" aria-label="Header buttons" data-field-path={`${at.join('/')}/type`}>
          <span className="w2-row-label">Header buttons</span>
          {(['inherit', 'replace'] as const).map(type => <button key={type} type="button" aria-pressed={surface.toolbar.type === type}
            onClick={() => type !== surface.toolbar.type && set(at, type === 'inherit' ? { type: 'inherit' } : { type: 'replace', groups: [] })}>{type === 'inherit' ? 'Same as app' : 'Custom'}</button>)}
        </div>
        {custom && <ChromeGroups path={[...at, 'groups']}/>}
      </>;
  };
  const overrides: Record<string, RowOverride> = { ...deep, toolbar, ...(kind === 'page' ? {} : {
    'presentation.height': ({ path: at }) => {
      const full = surface.presentation.height.type === 'full';
      return <div className="w2-segment" role="group" aria-label="Height" data-field-path={`${at.join('/')}/type`}>
        <span className="w2-row-label">Height</span>
        {(['fitted', 'full'] as const).map(type => <button key={type} type="button" aria-pressed={full === (type === 'full')}
          onClick={() => (type === 'full') !== full && setPresentation({ height: type === 'full' ? { type: 'full' } : { type: 'fitted', follows: 'root', firstOpen: 'canonical@1' }, ...(type === 'fitted' ? { fullScreen: false } : {}) })}>{type === 'full' ? 'Full' : 'Fitted'}</button>)}
      </div>;
    },
    'presentation.adaptive': ({ path: at }) => <SwitchRow label="Open beside the list when there is room" path={at.join('/')} checked={Boolean(presentation?.adaptive) && !presentation?.fullScreen}
      disabled={Boolean(presentation?.fullScreen)} caption={presentation?.fullScreen ? 'Not with Full screen.' : undefined} onChange={on => setPresentation({ adaptive: on })}/>,
    'presentation.fullScreen': ({ path: at }) => <SwitchRow label="Full screen" path={at.join('/')} checked={Boolean(presentation?.fullScreen)}
      onChange={on => setPresentation(on ? { fullScreen: true, adaptive: false, height: { type: 'full' } } : { fullScreen: false })}/>,
  }) };
  const navigationRows = kind === 'page' ? <>
    <SwitchRow label="Open pages beside this one" path={[...path, 'navigation', 'type'].join('/')} checked={columns} caption="Used when the window is wide enough for two."
      onChange={on => set([...path, 'navigation'], on ? { type: 'navigation-columns', placeholder: 'Select an item', standalone: false } : { type: 'stack' })}/>
    {columns && <CompositionFields schema={{ type: 'string', maxLength: 240 }} value={(surface.navigation as { placeholder: string }).placeholder} path={[...path, 'navigation', 'placeholder']}
      label="Empty side text" document={document} onChange={onChange} onError={ws.studio.setError} options={options}/>}
  </> : undefined;
  const routes = (document.extensions?.routes ?? []).filter(route => route.pageId === surface.id);
  const advancedExtra = columns ? <>
    {(['onDemand', 'standalone'] as const).map(name => <div className="w2-row" key={name}><CompositionFields schema={{ type: 'boolean' }} value={Boolean((surface.navigation as unknown as Record<string, Json>)[name])}
      path={[...path, 'navigation', name]} label={name === 'onDemand' ? 'Start with one pane' : 'Start a new column set here'} document={document} onChange={onChange} onError={ws.studio.setError} options={options}/></div>)}
  </> : kind === 'modal' && surface.presentation.height.type === 'fitted' ? <div className="w2-row"><CompositionFields schema={{ enum: ['root', 'top-page'] }} value={surface.presentation.height.follows}
    path={[...path, 'presentation', 'height', 'follows']} label="Fit to" document={document} onChange={onChange} onError={ws.studio.setError} options={fieldOptions('sheet', path)}/></div> : undefined;
  return <>
    <ObjectRows path={path} owner={owner} skip={skip} overrides={overrides} groups={['what', 'look', 'behaviour']} extra={{ look: navigationRows }}/>
    {kind === 'page' && <section className="w2-group"><button type="button" className="w2-disclosure-head" onClick={() => push?.push({
      title: 'Links', body: <LinksList pageId={surface.id}/>,
    })}><span className="w2-row-label w2-wide-label">Opens from outside the app</span><span className="w2-summary">{routes.length}</span><ChevronRight size={16} aria-hidden/></button></section>}
    <OpenedFrom document={document} kind={kind} id={surface.id} onGo={onGo}/>
    <section className="w2-group"><button type="button" className="w2-disclosure-head w2-advanced-row" onClick={() => push?.push({
      title: 'Advanced', body: <><IdRow id={surface.id} path={[...path, 'id'].join('/')}/><ObjectRows path={path} owner={owner} skip={child => skip(child) || child.at(-1) === 'id'} overrides={overrides} groups={['advanced']} extra={{ advanced: advancedExtra }}/></>,
    })}><span className="w2-row-label">Advanced</span><span className="w2-summary"/><ChevronRight size={16} aria-hidden/></button></section>
  </>;
}
