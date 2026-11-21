import { ChevronRight } from 'lucide-react';
import { replaceAt } from '../../composition-editor';
import type { Json } from '../../shared/types';
import { ChromeGroups } from '../ChromeGroups';
import { ChoiceRow } from '../SegmentRow';
import { Tag, usePush } from '../kit';
import { useRows } from '../rows';
import {
  chromeItems, chromeSummary, hiddenWords, itemRowName, newerAppCaption, resultParts, SHOW_FOOTER, tabsShow, TABS_VISIBILITY_CAPABILITY, type ChromeSummary,
} from './chromeRules';

const choices = [{ value: 'every', label: 'Every page' }, { value: 'first', label: 'First page only' }];

/** The pages that hide something, each with how much; choosing one goes to it. */
function HiddenPages({ summary, onGo }: { summary: ChromeSummary; onGo: (key: `page:${string}`) => void }) {
  return <ul className="w2-move-list" aria-label={hiddenWords(summary.hidden.length)}>
    {summary.hidden.map(page => <li key={page.id}><button type="button" className="w2-link-row" onClick={() => onGo(`page:${page.id}`)}>
      <span>{page.title}</span><Tag tone="neutral">{`Hides ${page.count}`}</Tag><ChevronRight size={16} aria-hidden/></button></li>)}
  </ul>;
}

/**
 * The app panel "Tabs and header buttons" (proposal section 2): "Show on pages" with a row for Tabs, Quick Links and Profile and each header button, each "Every page" or
 * "First page only", the changed footer, and the result line ("2 shown on every page · 1 on the first page only · Hidden on 3 pages"; the count opens the list of pages). Under it
 * the header's own groups, as before: Leading and Trailing, each button a row.
 */
export function HeaderPanel({ onGo }: { onGo: (key: `page:${string}`) => void }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const summary = chromeSummary(document);
  const parts = resultParts(summary);
  const waiting = newerAppCaption(TABS_VISIBILITY_CAPABILITY);
  const where: Record<string, (string | number)[]> = {};
  document.navigation.chrome.groups.forEach((group, at) => group.items.forEach((item, index) => { where[item.id] = ['navigation', 'chrome', 'groups', at, 'items', index, 'visibility']; }));
  const setItem = (id: string, value: string) => onChange(replaceAt(document, where[id], (value === 'first' ? 'root-only' : 'always') as Json));
  const setTabs = (value: string) => {
    const { tabsVisibility: _old, ...navigation } = document.navigation;
    // Every page is what an absent field means, so choosing it removes the field and the project needs no newer app for it.
    onChange({ ...document, navigation: value === 'first' ? { ...navigation, tabsVisibility: 'root-only' } : navigation });
  };
  const last = summary.hidden.length > 0 ? hiddenWords(summary.hidden.length) : undefined;
  return <div className="w2-form">
    <section className="w2-group" aria-label="Show on pages"><h3 className="w2-group-title">Show on pages</h3>
      <div data-field-path="navigation/tabsVisibility"><ChoiceRow label="Tabs" value={tabsShow(document)} options={choices} onChange={setTabs}/></div>
      {waiting && <p className="w2-caption" data-needs-newer-app>{waiting}</p>}
      {chromeItems(document).map(item => <div key={item.id} data-field-path={where[item.id].join('/')}><ChoiceRow label={itemRowName(item)} value={item.shows} options={choices} onChange={value => setItem(item.id, value)}/></div>)}
      <p className="w2-caption">{SHOW_FOOTER}</p>
      <p className="w2-caption" data-result-line>{parts.map((part, at) => <span key={part}>{at > 0 && ' · '}
        {part === last ? <button type="button" className="w2-link-button w2-inline-link" onClick={() => push?.push({ title: hiddenWords(summary.hidden.length), body: <HiddenPages summary={summary} onGo={onGo}/> })}>{part}</button> : part}</span>)}</p>
    </section>
    <ChromeGroups path={['navigation', 'chrome', 'groups']} showElsewhere/>
  </div>;
}
