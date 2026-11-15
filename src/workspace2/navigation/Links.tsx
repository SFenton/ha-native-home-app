import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import { replaceAt } from '../../composition-editor';
import { uid } from '../../editor';
import { updateRoute, usedPaths, words, type AuthoredRoute } from '../../routes-editor';
import { Field, TextField } from '../../ui';
import { Disclosure, useRows } from '../rows';

/** A path the route list does not use yet, from a page's name: lowercase words joined by dashes, starting with a letter. */
export function suggestPath(title: string, taken: ReadonlySet<string>): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const base = /^[a-z]/.test(slug) ? slug : `page-${slug}`.replace(/-$/, '') || 'page';
  if (!taken.has(base)) return base;
  let at = 2;
  while (taken.has(`${base}-${at}`)) at++;
  return `${base}-${at}`;
}

/** A new link to `pageId`: the path from its name, named for it, with nothing else set. */
export function newRoute(document: CompositionDocument, pageId: string): AuthoredRoute {
  const page = document.pages.find(item => item.id === pageId);
  const title = page?.title ?? 'Page';
  const icon = page && /^[a-z0-9][a-z0-9.-]{0,79}$/.test(page.icon.name) ? page.icon.name : 'house';
  return { id: uid('route'), path: suggestPath(title, usedPaths(document.extensions?.routes ?? [])), pageId, title, summary: title, icon };
}

/** The document with `route` added (and the extensions block created when there was none). */
export function withRoute(document: CompositionDocument, route: AuthoredRoute): CompositionDocument {
  const extensions: NonNullable<CompositionDocument['extensions']> = document.extensions ?? { type: 'native-extensions@1', watch: 'stub@1', routes: [], cameras: [] };
  return { ...document, extensions: { ...extensions, routes: [...extensions.routes, route] } };
}

/** A comma-separated list the person types; the document gets the words as they come, the field keeps what was typed. */
function WordsField({ label, value, onWords }: { label: string; value: readonly string[]; onWords: (words: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return <TextField label={label} value={text} onChange={next => { setText(next); onWords(words(next)); }}/>;
}

type Who = 'everyone' | 'admin' | 'custom';
const whoOf = (route: AuthoredRoute): Who => !route.visibleWhen ? 'everyone' : route.visibleWhen.type === 'viewer' && route.visibleWhen.isAdmin === true && !route.visibleWhen.userIds ? 'admin' : 'custom';

/** One link's editor: Path, Tab, Sheets opened first, Aliases, Keywords, Siri phrase, Who can see it, Remove Link. */
export function LinkEditor({ index, onBack, onRemoved }: { index: number; onBack: () => void; onRemoved: () => void }) {
  const { document, onChange } = useRows();
  const extensions = document.extensions!;
  const route = extensions.routes[index];
  if (!route) return null;
  const change = (patch: Partial<AuthoredRoute>) => onChange({ ...document, extensions: updateRoute(extensions, index, patch) });
  const clashes = extensions.routes.some((other, at) => at !== index && (other.path === route.path || other.aliases?.includes(route.path))) || route.aliases?.some(alias => alias === route.path);
  const validPath = /^[a-z][a-z0-9-]{0,79}$/.test(route.path);
  const opened = new Set(route.anchors?.map(anchor => anchor.modalId));
  const who = whoOf(route);
  const setSheets = (modalId: string, on: boolean) => {
    const rest = (route.anchors ?? []).filter(anchor => anchor.modalId !== modalId);
    const anchors = on ? [...rest, { fragment: modalId, modalId }] : rest;
    const next: Record<string, unknown> = { ...route, anchors };
    if (!anchors.length) delete next.anchors;
    onChange({ ...document, extensions: { ...extensions, routes: extensions.routes.map((item, at) => at === index ? next as AuthoredRoute : item) } });
  };
  return <div className="w2-link-editor">
    <button type="button" className="w2-back" onClick={onBack}><ChevronLeft size={16} aria-hidden/>Links</button>
    <div className="w2-row"><Field label="Path" hint={!validPath ? 'Lowercase letters, numbers and dashes.' : clashes ? `Two links use the path ${route.path}.` : undefined}>
      <input value={route.path} aria-invalid={!validPath || clashes || undefined} onChange={event => change({ path: event.target.value })}/></Field></div>
    <div className="w2-row"><Field label="Tab"><select value={route.tabId ?? ''} onChange={event => {
      const next: Record<string, unknown> = { ...route }; if (event.target.value) next.tabId = event.target.value; else delete next.tabId;
      onChange({ ...document, extensions: { ...extensions, routes: extensions.routes.map((item, at) => at === index ? next as AuthoredRoute : item) } });
    }}>
      <option value="">None</option>
      {document.navigation.tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
    </select></Field></div>
    {document.modals.length > 0 && <Disclosure label="Sheets opened first" summary={opened.size ? String(opened.size) : ''} path="sheets-opened-first">
      {document.modals.map(modal => <label key={modal.id} className="w2-switch-row"><span className="w2-row-label">{modal.title}</span>
        <input type="checkbox" role="switch" checked={opened.has(modal.id)} onChange={event => setSheets(modal.id, event.target.checked)}/></label>)}
    </Disclosure>}
    <div className="w2-row"><WordsField label="Aliases" value={route.aliases ?? []} onWords={list => change({ aliases: list })}/></div>
    <div className="w2-row"><WordsField label="Keywords" value={route.keywords ?? []} onWords={list => change({ keywords: list })}/></div>
    <div className="w2-row"><label className="w2-switch-row"><span className="w2-row-label">Siri phrase</span>
      <input type="checkbox" role="switch" checked={route.siri ?? false} onChange={event => change({ siri: event.target.checked })}/></label></div>
    <div className="w2-row"><Field label="Who can see it"><select value={who} onChange={event => {
      const next: Record<string, unknown> = { ...route };
      if (event.target.value === 'admin') next.visibleWhen = { type: 'viewer', isAdmin: true }; else delete next.visibleWhen;
      onChange({ ...document, extensions: { ...extensions, routes: extensions.routes.map((item, at) => at === index ? next as AuthoredRoute : item) } });
    }}>
      <option value="everyone">Everyone</option><option value="admin">An admin</option>
      {who === 'custom' && <option value="custom" disabled>A rule set in the JSON</option>}
    </select></Field></div>
    <div className="w2-row"><button type="button" className="w2-danger" onClick={() => {
      onChange(replaceAt(document, ['extensions', 'routes'], extensions.routes.filter((_, at) => at !== index)));
      onRemoved();
    }}>Remove Link</button></div>
  </div>;
}

/**
 * The links list (spec 5.2 and 5.7): the routes of one page (with "Add Link"), or every route in the project. A row opens the
 * link's editor in place, with a Back to the list.
 */
export function LinksList({ pageId, onEdit }: { pageId?: string; onEdit?: (editing: boolean) => void }) {
  const { document, onChange } = useRows();
  const [editing, setEditing] = useState<string>();
  const routes = document.extensions?.routes ?? [];
  const shown = routes.map((route, index) => ({ route, index })).filter(item => !pageId || item.route.pageId === pageId);
  const open = (id: string | undefined) => { setEditing(id); onEdit?.(Boolean(id)); };
  const at = routes.findIndex(route => route.id === editing);
  if (editing && at >= 0) return <LinkEditor index={at} onBack={() => open(undefined)} onRemoved={() => open(undefined)}/>;
  const pageTitle = (id: string) => document.pages.find(page => page.id === id)?.title ?? id;
  return <div className="w2-links">
    {shown.length === 0 && <p className="w2-empty">No links. Add one from a page’s settings.</p>}
    {shown.length > 0 && <ul>{shown.map(({ route }) => <li key={route.id}><button type="button" className="w2-link-row" onClick={() => open(route.id)}>
      <span>/{route.path}</span>{!pageId && <span className="w2-page-via">{pageTitle(route.pageId)}</span>}<ChevronRight size={16} aria-hidden/></button></li>)}</ul>}
    {pageId && <div className="w2-row"><button type="button" onClick={() => {
      const route = newRoute(document, pageId);
      onChange(withRoute(document, route));
      open(route.id);
    }}>Add Link</button></div>}
  </div>;
}
