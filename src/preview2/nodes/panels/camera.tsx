import { Glyph, type NodeOf } from '../shared';
import { useRender } from '../../render-context';
import { CameraPicture, cameraFace } from '../camera-picture';

/**
 * The picture area of a camera: the latest still through the Studio's server (a poster frame while there is none), the name capsule and the
 * Snapshot mark. The preview never opens a stream, so the still is all `camera-video` ever shows here.
 */
function Poster({ title, sourceId }: { title: string; sourceId: string }) {
  const { sources } = useRender();
  return <div role="img" aria-label={title}><CameraPicture title={title} face={cameraFace(sources, sourceId)} size={44} className="sh-cam-poster"/></div>;
}
/** The control strip (`UKCameraControlStripView`): a 56 pt circle over its label for each control, in the app's dark cell. */
function Controls({ node }: { node: NodeOf<'camera-controls'> | NodeOf<'camera-viewer'> }) {
  return <div className="sh-cam-controls" role="group" aria-label={node.title}>
    {node.props.controls.map(control => <span key={control.intent} className="sh-cam-control" data-tint={control.tint}>
      <span className="sh-cam-circle"><Glyph symbol={control.icon} size={24}/></span><span className="sh-cam-label">{control.title}</span></span>)}
  </div>;
}

/** `camera-video`: the camera's latest still, or a poster frame while there is none. */
export function CameraVideoNode({ node }: { node: NodeOf<'camera-video'> }) { return <Poster title={node.title} sourceId={node.props.sourceId}/>; }
/** `camera-controls`: Snapshot, Sound and Record under a video. */
export function CameraControlsNode({ node }: { node: NodeOf<'camera-controls'> }) { return <Controls node={node}/>; }
/** `camera-viewer`: the picture and its controls in one node. */
export function CameraViewerNode({ node }: { node: NodeOf<'camera-viewer'> }) {
  return <div className="sh-cam-viewer"><Poster title={node.title} sourceId={node.props.sourceId}/><Controls node={node}/></div>;
}
