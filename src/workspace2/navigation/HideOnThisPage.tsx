import { useRows } from '../rows';
import { HIDE_FOOTER, hideRows, newerAppCaption, PAGE_CHROME_HIDE_CAPABILITY, setHideItem, setHideTabs } from './chromeRules';
import { SwitchRow } from './SwitchRow';

/**
 * "Hide on this page" (proposal section 2): a switch for Tabs, Quick Links and Profile and each header button, under "Header buttons" while a page is "Same as app".
 * With Custom only the Tabs switch remains. A row the app already shows on "First page only" is off, disabled and captioned. Writes `hides`, and removes it when nothing is
 * hidden. Sheets and modals have no such group: they never show global chrome.
 */
export function HideOnThisPage({ index }: { index: number }) {
  const { document, onChange } = useRows();
  const page = document.pages[index];
  if (!page) return null;
  const waiting = newerAppCaption(PAGE_CHROME_HIDE_CAPABILITY);
  return <section className="w2-group" aria-label="Hide on this page"><h3 className="w2-group-title">Hide on this page</h3>
    {hideRows(document, page).map(row => <SwitchRow key={row.id} label={row.label} checked={row.on} disabled={row.disabled} caption={row.caption} path={`pages/${index}/hides/${row.id === 'tabs' ? 'tabs' : `items/${row.id}`}`}
      onChange={on => onChange(row.id === 'tabs' ? setHideTabs(document, index, on) : setHideItem(document, index, row.id, on))}/>)}
    <p className="w2-caption">{HIDE_FOOTER}</p>
    {waiting && <p className="w2-caption" data-needs-newer-app>{waiting}</p>}
  </section>;
}
