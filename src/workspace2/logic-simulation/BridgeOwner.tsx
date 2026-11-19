import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorkspaceDataProvider, useWorkspaceData } from '../pickers/WorkspaceData';
import { flowFingerprint } from './program';
import { SimulationFlowBridge, type FlowState, type sharedFlowRequests } from './live';

type Request = ReturnType<typeof sharedFlowRequests>[number];
interface BridgeProps {
  readonly requests: readonly Request[];
  readonly enabled: boolean;
  readonly onRun: (ids: readonly string[], state: FlowState) => void;
}
type Owner = BridgeProps & Pick<ReturnType<typeof useWorkspaceData>, 'house' | 'live'>;
type Lease = Request & Omit<Owner, 'requests'> & { readonly owner: number };
const requestKey = (request: Lease) => JSON.stringify([request.owner, request.id, flowFingerprint(request.inputs)]);

function RetireList({ requests, closing, onDrained }: { requests: readonly Lease[]; closing: boolean; onDrained: () => void }) {
  const [retained, setRetained] = useState(requests);
  const desired = new Map(requests.map(request => [requestKey(request), request]));
  const claimed = new Set(retained.map(request => request.id));
  const additions = requests.filter(request => {
    if (claimed.has(request.id)) return false;
    claimed.add(request.id); return true;
  });
  const entries = [...retained, ...additions];
  if (additions.length) setRetained(entries);
  useEffect(() => { if (closing && !entries.length) onDrained(); }, [closing, entries.length, onDrained]);
  return entries.map(previous => {
    const key = requestKey(previous), current = desired.get(key);
    const request = current ?? previous;
    return <WorkspaceDataProvider key={key} document={undefined} house={request.house ?? {}} live={request.live}>
      <SimulationFlowBridge {...request} enabled={Boolean(current) && request.enabled}
        onDisabled={current ? undefined : () => setRetained(list => list.filter(request => requestKey(request) !== key))} />
    </WorkspaceDataProvider>;
  });
}

const owners = new Map<number, Owner>();
let nextOwner = 0, root: Root | undefined;
function renderOwners() {
  // One headless retire list serializes same-store handoffs, including a direct host replacement.
  root ??= createRoot(document.createElement('div'));
  const currentRoot = root;
  const requests = [...owners].flatMap(([owner, { requests, ...props }]) => requests.map(request => ({ ...request, ...props, owner })));
  root.render(<RetireList requests={requests} closing={!owners.size} onDrained={() => {
    queueMicrotask(() => {
      if (!owners.size && root === currentRoot) { root = undefined; currentRoot.unmount(); }
    });
  }} />);
}

/** Retire changed/removed request identities through a disabled commit before releasing their shared store owner. */
export function SimulationFlowBridges(props: BridgeProps) {
  const { house, live } = useWorkspaceData();
  const owner = useRef<number>(undefined);
  useLayoutEffect(() => {
    const id = owner.current ??= ++nextOwner;
    owners.set(id, { ...props, house, live }); renderOwners();
    return () => { owners.delete(id); renderOwners(); };
  }, [props.requests, props.enabled, props.onRun, house, live]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
