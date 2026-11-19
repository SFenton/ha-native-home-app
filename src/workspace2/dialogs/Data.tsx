import { ObjectRows, useRows } from '../rows';
import { usePush } from '../kit';
import { useLibrary } from '../useLibrary';
import DataPanel from '../data/DataPanel';
import type { Workspace2 } from '../useWorkspace2';

/** One source's fields, found by its id so reordering cannot point at another source. */
export function SourceFields({ id }: { id: string }) {
  const { document } = useRows();
  const at = document.dataSources.findIndex(source => source.id === id);
  if (at < 0) return null;
  const source = document.dataSources[at];
  return <ObjectRows path={['dataSources', at]} owner={source.kind === 'model' ? source.model : 'entity-source'}/>;
}

/** The phone's Project > Data sheet shares the read-only catalog and disclosure state with the rail. */
export default function Data({ ws }: { ws: Workspace2 }) {
  const { onError } = useRows(), push = usePush(), library = useLibrary('phone', 0);
  return <DataPanel ws={ws} library={library} onError={onError} onOpenSource={(id, name) => {
    push?.push({ title: name, body: <SourceFields id={id}/> });
  }}/>;
}
