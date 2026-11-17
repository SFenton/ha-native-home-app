import { useEffect, useState } from 'react';
import { Camera } from 'lucide-react';
import { useRender } from '../render-context';
import type { CompositionDocument } from '../../shared/composition/schema';

/** How often a drawn camera still is read again in Use: a snapshot, not a stream (the app's own still refresh is of the same order). */
export const CAMERA_POLL_MS = 5000;

/** The words and picture of one camera source (`camera-stream@1`): the entity whose still is read and the labels the app draws for it. */
export interface CameraFace { entityId?: string; snapshot: string; unavailable: string }

/** The camera source a node names, as authored, so its labels show while the data is loading. `undefined` for any other source. */
export function cameraFace(sources: CompositionDocument['dataSources'] | undefined, sourceId: string): CameraFace | undefined {
  const found = sources?.find(item => item.id === sourceId);
  if (found?.kind !== 'model' || found.model !== 'camera-stream@1') return undefined;
  return { entityId: found.inputs.snapshotEntityId.value, snapshot: found.labels.snapshot, unavailable: found.labels.unavailable };
}

/** The image type of a picture's first bytes (PNG, JPEG, GIF, WebP; anything that starts with `<` is read as SVG, which a demo picture is). */
export function pictureType(bytes: Uint8Array): string {
  const at = (index: number) => bytes[index];
  if (at(0) === 0x89 && at(1) === 0x50) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57) return 'image/webp';
  return 'image/svg+xml';
}

/**
 * Reads a camera's latest still through the Studio's own server, which holds the Home Assistant token (`RenderContext.mapPicture`), and keeps
 * the last good one on screen. In Use it reads again every {@link CAMERA_POLL_MS} while the tab is visible; in Edit it reads once. An object URL
 * for the picture, or `undefined` while there is none (no connection, no entity, nothing read yet, or a camera that gave no picture).
 */
export function useCameraPicture(entityId: string | undefined): string | undefined {
  const { mapPicture, mode } = useRender();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!mapPicture || !entityId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, current: string | undefined;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden && current) { schedule(); return; }
      try {
        const bytes = await mapPicture(entityId, abort.signal);
        if (abort.signal.aborted) return;
        if (bytes) {
          const next = URL.createObjectURL(new Blob([bytes], { type: pictureType(new Uint8Array(bytes)) }));
          if (current) URL.revokeObjectURL(current);
          current = next; setUrl(next);
        }
      } catch { /* the last picture stays */ }
      schedule();
    };
    const schedule = () => { if (mode === 'use' && !abort.signal.aborted) timer = setTimeout(() => { void load(); }, CAMERA_POLL_MS); };
    void load();
    return () => { abort.abort(); if (timer) clearTimeout(timer); if (current) URL.revokeObjectURL(current); setUrl(undefined); };
  }, [mapPicture, entityId, mode]);
  return mapPicture && entityId ? url : undefined;
}

/**
 * The picture area of a camera: the latest still over the app's dark ground, the name capsule bottom-left (`UKCameraNameView`) and a
 * "Snapshot" mark top-right. The sim cannot stream, so it never says Live; the mark shows only while a still is drawn. Without a still it
 * draws the camera mark, as before. The picture is decoration: the control or role around it carries the name.
 */
export function CameraPicture({ title, face, size, className }: { title: string; face: CameraFace | undefined; size: number; className: string }) {
  const url = useCameraPicture(face?.entityId);
  return <div className={className} data-picture={url ? '' : undefined}>
    {url ? <img className="sh-cam-still" src={url} alt="" draggable={false}/> : <Camera className="sh-cam-mark" size={size} aria-hidden="true"/>}
    <span className="sh-cam-name" data-testid="camera-name"><i className="sh-cam-dot" aria-hidden="true"/>{title}</span>
    {url && face && <span className="sh-cam-state" data-testid="camera-state">{face.snapshot}</span>}
  </div>;
}
