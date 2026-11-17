import { Pressable, type NodeOf } from './shared';
import { useRender } from '../render-context';
import { CameraPicture, cameraFace } from './camera-picture';

/**
 * `camera-tile` (`UKCameraTileView`): the camera's latest still, read through the Studio's server, with the name capsule bottom-left and a Snapshot mark.
 * The sim cannot stream, so it never says Live. Nothing else is drawn over the picture; "Opens the camera" is the accessibility hint only.
 */
export function CameraTileNode({ node }: { node: NodeOf<'camera-tile'> }) {
  const { sources } = useRender();
  const hintId = `${node.id}-hint`;
  return <Pressable action={node.action} className="sh-cam-tile sh-pressable" label={`${node.title} camera`} describedBy={hintId}>
    <CameraPicture title={node.title} face={cameraFace(sources, node.props.sourceId)} size={44} className="sh-cam-picture"/>
    <span id={hintId} hidden>{node.props.openHint}</span>
  </Pressable>;
}
