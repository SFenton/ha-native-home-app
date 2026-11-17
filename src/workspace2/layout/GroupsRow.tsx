import { ChevronRight } from 'lucide-react';
import { valueAt, type EditorPath } from '../../composition-editor';
import type { GridGroups } from '../../shared/composition/grid-groups';
import { usePush } from '../kit';
import { useRows } from '../rows';
import GroupsPage from './GroupsPage';
import { groupsSummary } from './groups-model';

/**
 * The Group by State row of a grid's panel: its summary at the trailing edge ("Off", "2 Groups") and a chevron, opening {@link GroupsPage}. One row, one setting:
 * it makes the whole of `props.groups` one field, which a template can set per place (`build/design/sim-fidelity-contract.md`, section 3).
 */
export function GroupsRow({ path }: { path: EditorPath }) {
  const { document } = useRows();
  const push = usePush();
  const node = valueAt(document, path) as { type?: string; props?: { groups?: GridGroups } } | undefined;
  if (!node || node.type !== 'tile-grid') return null;
  const summary = groupsSummary(node.props?.groups);
  return <div className="w2-row" data-field-path={[...path, 'props', 'groups'].join('/')}>
    <button type="button" className="w2-add-row w2-swipe-row" data-testid="groups-row" aria-label={`Group by State, ${summary}`}
      onClick={() => push?.push({ title: 'Group by State', body: <GroupsPage path={path}/> })}>
      <span className="w2-row-label">Group by State</span><span className="w2-summary">{summary}</span><ChevronRight size={16} aria-hidden/>
    </button>
  </div>;
}
