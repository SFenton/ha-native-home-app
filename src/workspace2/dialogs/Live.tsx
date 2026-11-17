import { createId as uid } from '../../shared/ids';
import { removeCompositionItem } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { usePush } from '../kit';
import { ObjectRows, useRows } from '../rows';
import { PushRow } from './parts';

type Activity = CompositionDocument['liveActivities'][number];
type Camera = NonNullable<NonNullable<CompositionDocument['extensions']>['cameras']>[number];

function ActivityFields({ id }: { id: string }) {
  const { document, onChange } = useRows();
  const push = usePush();
  const at = document.liveActivities.findIndex(item => item.id === id);
  if (at < 0) return null;
  return <>
    <ObjectRows path={['liveActivities', at]} owner="activity"/>
    <div className="w2-row"><button type="button" className="w2-danger" onClick={() => { onChange(removeCompositionItem(document, ['liveActivities'], at)); push?.pop(); }}>Remove Activity</button></div>
  </>;
}

/** A camera has no id of its own, and its entity is one of the fields, so it is found by its place in the list. */
function CameraFields({ at }: { at: number }) {
  const { document, onChange } = useRows();
  const push = usePush();
  if (!document.extensions?.cameras[at]) return null;
  return <>
    <ObjectRows path={['extensions', 'cameras', at]} owner="camera-notification"/>
    <div className="w2-row"><button type="button" className="w2-danger" onClick={() => { onChange(removeCompositionItem(document, ['extensions', 'cameras'], at)); push?.pop(); }}>Remove Camera</button></div>
  </>;
}

/** Project > Live Activities (spec 5.7): one row per job, then the cameras that notify. */
export default function Live() {
  const { document, onChange } = useRows();
  const push = usePush();
  const cameras = document.extensions?.cameras ?? [];
  const addActivity = () => {
    const taken = new Set(document.liveActivities.map(item => item.jobId));
    let jobId = 'new-activity', n = 1;
    while (taken.has(jobId)) jobId = `new-activity-${++n}`;
    const made: Activity = { id: uid('activity'), jobId, type: 'activity-presentation@1', title: 'New activity', glyph: 'generic', tint: 'neutral', source: 'activity-engine@1', privacy: 'system-sensitive@1', updates: 'engine@1', intents: 'engine-safe@1' };
    onChange({ ...document, liveActivities: [...document.liveActivities, made] });
    push?.push({ title: made.title, body: <ActivityFields id={made.id}/> });
  };
  const addCamera = () => {
    const made: Camera = { entityId: 'camera.demo_front_door', title: 'Front door', liveLabel: 'Live', unavailableLabel: 'Unavailable' };
    const extensions = document.extensions ?? { type: 'native-extensions@1' as const, watch: 'stub@1' as const, routes: [], cameras: [] };
    onChange({ ...document, extensions: { ...extensions, cameras: [...extensions.cameras, made] } });
    push?.push({ title: made.title, body: <CameraFields at={extensions.cameras.length}/> });
  };
  return <div className="w2-live">
    {document.liveActivities.length === 0 ? <p className="w2-empty">No Live Activities.</p> : <ul className="w2-list">{document.liveActivities.map(item =>
      <PushRow key={item.id} title={item.title} detail={item.jobId} onOpen={() => push?.push({ title: item.title, body: <ActivityFields id={item.id}/> })}/>)}</ul>}
    <div className="w2-actions"><button type="button" disabled={document.liveActivities.length >= 16} onClick={addActivity}>Add Activity</button></div>
    <section aria-label="Camera notifications" className="w2-group"><h3 className="w2-group-title">Camera notifications</h3>
      {cameras.length > 0 && <ul className="w2-list">{cameras.map((item, at) => <PushRow key={at} title={item.title} detail={item.entityId}
        onOpen={() => push?.push({ title: item.title, body: <CameraFields at={at}/> })}/>)}</ul>}
      <div className="w2-actions"><button type="button" disabled={cameras.length >= 32} onClick={addCamera}>Add Camera</button></div>
    </section>
  </div>;
}
