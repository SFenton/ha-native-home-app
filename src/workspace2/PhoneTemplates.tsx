import { ScanSearch, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRows } from './rows';
import SavedComponents from './SavedComponents';
import { templateWords } from './templateWords';
import type { Workspace2 } from './useWorkspace2';

/**
 * Project > Templates on a phone (studio-tpl-ux): the Templates list as a page pushed inside the Project sheet. A row (and Show Uses) closes Project and
 * opens the template's editor in the properties sheet, as Project > Tabs opens its editor; a row has More only, since the sheet covers the page. Find Repeated
 * Pieces is the page's foot and opens the half-height sheet.
 *
 * A pushed page is kept as an element, so the document is read from the live rows and not from the workspace the page was pushed with.
 */
export default function PhoneTemplates({ ws, onClose }: { ws: Workspace2; onClose: () => void }) {
  const { document } = useRows();
  const live = useMemo<Workspace2>(() => ({ ...ws, document }), [ws, document]);
  const [query, setQuery] = useState('');
  return <div className="w2-phone-templates" data-testid="phone-templates">
    <label className="w2-search"><Search size={16} aria-hidden/><input type="search" placeholder="Find a template" aria-label="Find a template" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <SavedComponents ws={live} query={query} disabled={ws.mode !== 'edit'} onOpen={id => { onClose(); ws.openTemplate(id); }}/>
    <div className="w2-actions"><button type="button" data-testid="find-repeats" onClick={() => { onClose(); ws.repeats.setOpen(true); }}><ScanSearch size={16} aria-hidden/>{templateWords.find}</button></div>
  </div>;
}
