import { ChevronRight, Search, Utensils } from 'lucide-react';
import { Children } from '../Children';
import { Glyph, Pressable, useOperand, type NodeOf } from '../shared';
import { useRender } from '../../render-context';
import { TodoSections, todoSource } from './todo-sections';

/** A skeleton line: the app's static placeholder bar, never an invented value. */
const Bar = ({ width }: { width: string }) => <i className="sh-skel" style={{ width }} aria-hidden="true"/>;

/** One skeleton row of a module list: a glyph disc and two lines. */
function SkeletonRow({ chevron }: { chevron?: boolean }) {
  return <div className="sh-row sh-skel-row" aria-hidden="true"><i className="sh-skel sh-skel-disc"/><span className="sh-row-copy"><Bar width="55%"/><Bar width="30%"/></span>{chevron && <ChevronRight size={16}/>}</div>;
}
/** A skeleton row that a tap opens: the list's `rowAction` (`sh.list-parts@1`), with the app's trailing chevron. */
function TappableRow({ action }: { action: NodeOf<'row-collection'>['props']['rowAction'] }) {
  return <Pressable action={action} className="sh-row sh-skel-row sh-pressable"><i className="sh-skel sh-skel-disc" aria-hidden="true"/><span className="sh-row-copy"><Bar width="55%"/><Bar width="30%"/></span><ChevronRight size={16} aria-hidden="true"/></Pressable>;
}

/**
 * `row-collection`: rows from a record provider in the app's module list; the provider is not read here, so the rows are placeholders. While the Studio's "Show state" asks
 * for one (Edit, this list selected) the list draws that state's words instead (studio-pipes D7): Loading, Empty (the title, then the message), Out of Date, Couldn't Update,
 * Error or Unavailable. Rows stay under "Out of Date" and "Couldn't Update", as the app keeps them.
 */
export function RowCollectionNode({ node }: { node: NodeOf<'row-collection'> }) {
  const { rowAction, refreshable, emptyMessage, loadingText, emptyText, staleText, errorText, unavailableText } = node.props;
  const { mode, statePreview } = useRender();
  const message = useOperand(emptyMessage, '', `${node.id}/emptyMessage`);
  const forced = mode === 'edit' && statePreview?.nodeId === node.id && statePreview.state !== 'rows' ? statePreview.state : undefined;
  const rows = <div className="sh-section-body">{[0, 1, 2].map(i => rowAction ? <TappableRow key={i} action={rowAction}/> : <SkeletonRow key={i}/>)}</div>;
  // The empty state: the title, then the message under it, which VoiceOver reads after the title.
  if (forced === 'empty') return <div className="sh-collection sh-section-module-list" role="group" aria-label={node.title} data-state="empty">
    <div className="sh-list-state" role="status"><strong className="sh-list-state-title">{emptyText}</strong>{message.text && <p className="sh-list-empty-message" data-testid="list-empty-message">{message.text}</p>}</div></div>;
  if (forced === 'loading' || forced === 'error' || forced === 'unavailable') return <div className="sh-collection sh-section-module-list" role="group" aria-label={node.title} data-state={forced}>
    <div className="sh-list-state" role="status"><strong className="sh-list-state-title">{forced === 'loading' ? loadingText : forced === 'error' ? errorText : unavailableText}</strong>{forced === 'error' && <span className="sh-secondary-button">Try Again</span>}</div></div>;
  return <div className="sh-collection sh-section-module-list" role="group" aria-label={node.title} data-refreshable={refreshable ? '' : undefined} data-state={forced}>
    {rows}
    {forced === 'stale' && <p className="sh-list-footnote" data-testid="list-footnote">{staleText}</p>}
    {forced === 'failed' && <p className="sh-list-footnote" data-testid="list-footnote">Couldn’t Update <span className="sh-list-retry">Try Again</span></p>}
    {message.text && <p className="sh-list-empty-message" data-testid="list-empty-message" hidden>{message.text}</p>}
  </div>;
}

/** `collection`: the template's shape (rows, inventory, recipe cards or a carousel) in placeholders, with its bedroom links; a `todo` one draws its provider's lists once the house has arrived. */
export function CollectionNode({ node }: { node: NodeOf<'collection'> }) {
  const { template, bedroomLinks, providerId, emptyText } = node.props;
  const { sources, house } = useRender();
  const todo = template === 'todo' && house.states ? todoSource(sources, providerId) : undefined;
  const body = todo ? <TodoSections nodeId={node.id} source={todo} emptyText={emptyText}/>
    : template === 'recipes'
    ? <div className="sh-recipe-grid">{[0, 1, 2, 3].map(i => <div key={i} className="sh-recipe-card" aria-hidden="true"><span className="sh-recipe-image"><Utensils size={28}/></span><Bar width="70%"/><Bar width="40%"/></div>)}</div>
    : template === 'carousel'
      ? <div className="sh-carousel" aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className="sh-recipe-card"><span className="sh-recipe-image"><Utensils size={28}/></span><Bar width="70%"/></div>)}</div>
      : <div className="sh-section-module-list"><div className="sh-section-body">{[0, 1, 2, 3].map(i => template === 'todo'
        ? <div key={i} className="sh-row sh-skel-row" aria-hidden="true"><i className="sh-skel sh-skel-ring"/><span className="sh-row-copy"><Bar width="60%"/><Bar width="25%"/></span></div>
        : <SkeletonRow key={i} chevron/>)}</div></div>;
  return <div className="sh-collection" role="group" aria-label={node.title}>{body}
    {bedroomLinks && <div className="sh-bedroom-links">{bedroomLinks.map(link => <span key={link.side} className="sh-secondary-button">{link.label}</span>)}</div>}</div>;
}

/** The form control a field draws, by kind. */
function FieldControl({ control, label }: { control: NodeOf<'form'>['props']['fields'][number]['control']; label: string }) {
  switch (control) {
    case 'toggle': return <span className="sh-switch" role="switch" aria-checked={false} aria-label={label}><span/></span>;
    case 'segmented': case 'weekdays': case 'options': return <span className="sh-segments" aria-hidden="true"><span>&nbsp;</span><span>&nbsp;</span><span>&nbsp;</span></span>;
    case 'multiline': return <span className="sh-field-box sh-field-tall" aria-hidden="true"/>;
    case 'attachment': case 'scan-camera': return <span className="sh-field-box sh-field-attach" aria-hidden="true"/>;
    default: return <span className="sh-field-box" aria-hidden="true"/>;
  }
}
/** `form`: its fields as labelled rows in one module, then the save button; a selection-only form has no save. */
export function FormNode({ node }: { node: NodeOf<'form'> }) {
  const { fields, saveLabel, selectionOnly } = node.props;
  return <form className="sh-form" aria-label={node.title} onSubmit={event => event.preventDefault()}>
    <div className="sh-section-module-list"><div className="sh-section-body">{fields.map(field => <div key={field.key} className="sh-row sh-form-row">
      <span className="sh-row-primary">{field.label}</span><FieldControl control={field.control} label={field.label}/></div>)}</div></div>
    {!selectionOnly && <span className="sh-primary-button" aria-hidden="true">{saveLabel}</span>}
  </form>;
}

/** `recipe-part`: one part of a recipe, in placeholders: the hero picture, or the lines of the general, ingredient and instruction tabs. */
export function RecipePartNode({ node }: { node: NodeOf<'recipe-part'> }) {
  if (node.props.part === 'hero') return <div className="sh-recipe-hero" role="img" aria-label={node.title}><Utensils size={44} aria-hidden="true"/></div>;
  return <div className="sh-collection sh-section-module-list" role="group" aria-label={node.title}><div className="sh-section-body">{[0, 1, 2, 3].map(i => <SkeletonRow key={i}/>)}</div></div>;
}

/**
 * `pinned-actions`: the page's floating action bar (`UKFloatingActionBar`): a search capsule when it has a search provider, a
 * labelled capsule for an action with a title, a circle for an icon-only one, the prominent one in the tint colour. The page
 * pins it over its bottom edge, outside the scroller (`PageBody`'s dock). The form style stacks full-width buttons under any children.
 */
export function PinnedActionsNode({ node }: { node: NodeOf<'pinned-actions'> }) {
  const { props } = node;
  const items = props.items.map(item => item.showsTitle || props.style === 'form'
    ? <span key={item.id} className={props.style === 'form' ? `sh-primary-button ${item.prominent ? '' : 'sh-secondary-button'}` : `sh-fab-capsule ${item.prominent ? 'sh-fab-prominent' : ''}`}><Glyph symbol={item.icon} size={18}/>{item.title}</span>
    : <span key={item.id} className="sh-fab-circle" role="img" aria-label={item.title}><Glyph symbol={item.icon} size={20}/></span>);
  if (props.style === 'form') return <div className="sh-pinned sh-pinned-form" role="toolbar" aria-label={node.title}>{node.children && <Children nodes={node.children}/>}{items}</div>;
  return <div className="sh-pinned" role="toolbar" aria-label={node.title}>
    {props.searchProviderId && <span className="sh-fab-search"><Search size={18} aria-hidden="true"/>{props.searchPrompt}</span>}{items}
  </div>;
}
