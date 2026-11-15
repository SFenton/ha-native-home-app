import { createId as uid } from '../shared/ids';
import { removeCompositionItem, replaceAt, valueAt, type EditorPath } from '../composition-editor';
import { Disclosure } from './Disclosure';
import { useDeepRows } from './editors/overrides';
import { ObjectRows, useRows } from './rows';

interface Item { id: string; type: 'shell-menu' | 'button' | 'shell-header'; label?: string }
interface Group { id: string; placement: 'leading' | 'trailing'; items: Item[] }

const sides = [['leading', 'Leading'], ['trailing', 'Trailing']] as const;
/** What a header item is called in its row: the menu, the quick links and profile pair, or the button's own label. */
const itemName = (item: Item) => item.type === 'shell-menu' ? 'Menu' : item.type === 'shell-header' ? 'Quick Links and Profile' : item.label || 'Button';

/** One header item's rows, with its Remove row. */
function ItemRows({ path, onRemove }: { path: EditorPath; onRemove: () => void }) {
  const overrides = useDeepRows(path);
  return <>
    <ObjectRows path={path} owner="chrome-item" overrides={overrides}/>
    <div className="w2-row"><button type="button" className="w2-danger" onClick={onRemove}>Remove Button</button></div>
  </>;
}

/**
 * Header buttons as rows (spec 5.2): "Leading" and "Trailing", each item a row that opens into its fields, "Add Button" under
 * each. `path` is the groups array: the project's (`navigation/chrome/groups`) or a page's own.
 */
export function ChromeGroups({ path }: { path: EditorPath }) {
  const { document, onChange, onError } = useRows();
  const groups = (valueAt(document, path) ?? []) as Group[];
  const add = (placement: Group['placement']) => {
    const button = {
      id: uid('chrome'), type: 'button', label: 'Button', menuLabel: 'Button', icon: { type: 'sf-symbol', name: 'circle', rendering: 'canonical', unavailable: 'reject' },
      visibility: 'always', priority: 'normal', rail: 'eligible', badge: { type: 'none' }, action: { type: 'back' },
    };
    const at = groups.findIndex(group => group.placement === placement);
    if (at >= 0) { onChange(replaceAt(document, [...path, at, 'items'], [...groups[at].items, button])); return; }
    onChange(replaceAt(document, path, [...groups, { id: uid('chrome'), placement, horizontal: 'separate-circles@1', vertical: 'shared@1', items: [button] }]));
  };
  const remove = (group: number, item: number) => {
    try {
      const next = removeCompositionItem(document, [...path, group, 'items'], item);
      onChange(groups[group].items.length === 1 ? replaceAt(next, path, groups.filter((_, at) => at !== group)) : next);
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="w2-chrome">
    {sides.map(([placement, title]) => {
      const held = groups.map((group, at) => ({ group, at })).filter(item => item.group.placement === placement);
      const room = groups.length < 3 || held.length > 0;
      return <section key={placement} aria-label={title} className="w2-group"><h3 className="w2-group-title">{title}</h3>
        {held.flatMap(({ group, at }) => group.items.map((item, index) => <Disclosure key={item.id} label={itemName(item)} path={[...path, at, 'items', index].join('/')}>
          <ItemRows path={[...path, at, 'items', index]} onRemove={() => remove(at, index)}/>
        </Disclosure>))}
        {held.length > 0 && <Disclosure label="Advanced" path={`${path.join('/')}/${title.toLowerCase()}`}>
          {held.map(({ group, at }) => <ObjectRows key={group.id} path={[...path, at]} owner="chrome-group" skip={child => child.at(-1) === 'items'}/>)}
        </Disclosure>}
        <div className="w2-row"><button type="button" disabled={!room || held.some(item => item.group.items.length >= 12)} onClick={() => add(placement)}>Add Button</button></div>
      </section>;
    })}
  </div>;
}
