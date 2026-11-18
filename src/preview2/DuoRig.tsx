import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { turnDelta, samePose, type DuoPose } from './duo-pose';
import { FLATTEN_MS, FOLD_REDUCED, settleDelay, type FoldToken } from './fold-motion';
import { useReflow } from './reflow';
import { footprintOf, halfTilts, halfTransform, OUTER_LIFT, PERSPECTIVE, rigGeometry, type Box, type HalfGeometry } from './rig-geometry';
import { useCopyReach } from './copy-access';
import { useTwinScroll } from './twin-scroll';
import { duoWindow, OPEN_DUO_BODY, radiiCss, type PreviewWindow, type Radii } from './windows';

/** Which copy of the screen a render is for: the live inner display, its twin in the second half, or the outer display on the cover's back. */
export type ScreenCopy = 'primary' | 'twin' | 'outer';

/** Props of {@link DuoRig}. */
export interface DuoRigProps {
  /** The pose to show. */
  pose: DuoPose;
  /** The token of the latest move; the stage uses the same one. */
  token: FoldToken;
  /** Reduce Motion: no tilt, swing or travel; a change of pose cross-fades. */
  reduced: boolean;
  /** Draws one copy of the screen for a window: the selection layer, the screen and the alert, so a copy takes the app's own handlers. */
  renderScreen(window: PreviewWindow, copy: ScreenCopy): ReactNode;
}

const box = (value: Box): CSSProperties => ({ left: value.x, top: value.y, width: value.width, height: value.height });
const clipPathOf = (half: HalfGeometry, vertical: boolean): string => {
  // The body's rim reaches 4 px out on every side except the hinge's: the two halves must meet in a clean line.
  const open = '-4px', shut = '0';
  const [top, right, bottom, left] = vertical ? [open, half.first ? shut : open, open, half.first ? open : shut] : [half.first ? open : shut, open, half.first ? shut : open, open];
  return `inset(${top} ${right} ${bottom} ${left})`;
};

/** A keyframe pair for a slot entering or leaving. */
type Enter = { kind: 'turn'; delta: number } | { kind: 'fade' };

/**
 * The Duo as a 3D rig: the open Duo is two halves that meet on the hinge's centre line, under the stage's perspective; partly folded tilts
 * each half toward the viewer, closed swings the cover over the base and shows its back face (the outer display). One pose, one path: every
 * move between poses is a change of two transforms, so a second click retargets from where the device is. A turn builds the new rig and
 * turns the old one away; Reduce Motion cross-fades poses instead (`useFoldToken`).
 */
export function DuoRig({ pose, token, reduced, renderScreen }: DuoRigProps) {
  // A rig is keyed by its turn (a turn changes the window's shape), or by its whole pose under Reduce Motion, which cross-fades instead of moving.
  const key = reduced ? `${pose.turn}:${pose.fold}` : `${pose.turn}`;
  const [shown, setShown] = useState<{ key: string; pose: DuoPose; enter?: Enter }>({ key, pose });
  // The leaving rig keeps the token and the drawing function it left with, so it is a picture: nothing in it renders again while it turns away.
  const [leaving, setLeaving] = useState<{ key: string; pose: DuoPose; delta: number; fade: boolean; token: FoldToken; renderScreen: DuoRigProps['renderScreen'] } | undefined>();
  if (shown.key !== key) {
    const fade = reduced;
    setLeaving({ key: shown.key, pose: shown.pose, delta: turnDelta(shown.pose.turn, pose.turn), fade, token, renderScreen });
    setShown({ key, pose, enter: fade ? { kind: 'fade' } : { kind: 'turn', delta: turnDelta(shown.pose.turn, pose.turn) } });
  } else if (!samePose(shown.pose, pose)) setShown({ key, pose, enter: shown.enter });
  const live = shown.key === key && samePose(shown.pose, pose) ? shown : { key, pose, enter: shown.enter };
  return <>
    {leaving && <Slot key={`out:${leaving.key}`} leaving={leaving} token={leaving.token} onDone={() => setLeaving(undefined)}>
      <RigUnit pose={leaving.pose} token={leaving.token} reduced={reduced} frozen renderScreen={leaving.renderScreen}/>
    </Slot>}
    <Slot key={`in:${live.key}`} enter={live.enter} token={token}>
      <RigUnit pose={live.pose} token={token} reduced={reduced} renderScreen={renderScreen}/>
    </Slot>
  </>;
}

/**
 * The element a rig sits in: a point at the middle of the model, so the unit turns about its own centre. It runs the enter animation on mount
 * and, when leaving, the leave animation, then reports it is done.
 */
function Slot({ children, enter, leaving, token, onDone }: { children: ReactNode; enter?: Enter; leaving?: { delta: number; fade: boolean }; token: FoldToken; onDone?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof element.animate !== 'function') { onDone?.(); return; }
    let animation: Animation | undefined;
    if (leaving && !leaving.fade) animation = element.animate([{ transform: 'rotate(0deg)', opacity: 1 }, { transform: `rotate(${leaving.delta}deg)`, opacity: 0 }], { duration: token.ms, easing: token.ease, fill: 'forwards' });
    // Under Reduce Motion the old pose stays whole beneath while the new one fades in over it; it is removed when that has run.
    else if (leaving) { const timer = setTimeout(() => onDone?.(), FOLD_REDUCED.ms + 40); return () => clearTimeout(timer); }
    else if (enter?.kind === 'turn') animation = element.animate([{ transform: `rotate(${-enter.delta}deg)`, opacity: 0 }, { transform: 'rotate(0deg)', opacity: 1 }], { duration: token.ms, easing: token.ease });
    else if (enter?.kind === 'fade') animation = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FOLD_REDUCED.ms, easing: FOLD_REDUCED.ease });
    if (leaving && animation) { const done = () => onDone?.(); animation.addEventListener('finish', done); animation.addEventListener('cancel', done); return () => { animation?.removeEventListener('finish', done); animation?.removeEventListener('cancel', done); }; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} className="sh-rig-slot" data-leaving={leaving ? '' : undefined} aria-hidden={leaving ? true : undefined}
    // A leaving rig is a picture of the old pose: nothing in it takes a click or a key.
    {...(leaving ? { inert: true } : {})} style={leaving ? { pointerEvents: 'none' } : undefined}>{children}</div>;
}

/**
 * Which displays of a rig are mounted. The inner display of a closed Duo and the outer display of an open one are not drawn, so a rig
 * at rest holds one copy of the screen (two when partly folded). A move mounts what it needs on its first frame and lets go of what it
 * no longer shows once the token has run.
 */
function useLifecycle(fold: DuoPose['fold'], token: FoldToken, frozen: boolean) {
  const [done, setDone] = useState(true), [seen, setSeen] = useState(fold), [swinging, setSwinging] = useState(false);
  if (seen !== fold) {
    // A move that starts or ends closed shows both displays while it runs; the others show the inner display only. An interrupted swing stays a swing.
    setSwinging(frozen ? false : (swinging && !done) || seen === 'closed' || fold === 'closed');
    setSeen(fold);
    setDone(frozen);
  }
  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => setDone(true), settleDelay(token));
    return () => clearTimeout(timer);
  }, [done, fold, token]);
  return { inner: fold !== 'closed' || !done, outer: fold === 'closed' || (!done && swinging), twin: fold === 'partly' || !done, done };
}

/**
 * The window a screen shows through. A screen that has just mounted is drawn from the next but one frame: its grids and tiles measure
 * themselves after their first layout, and the first frame would show the width they guessed before they knew. So a display that mounts
 * during a move arrives with its final layout, never a frame of the guess.
 */
function Clip({ wide, style, children }: { wide?: boolean; style: CSSProperties; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setReady(true)); });
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="sh-clip" data-wide={wide ? '' : undefined} data-ready={ready ? '' : undefined} style={style}>{children}</div>;
}

/** One rig at one turn: the two halves, the cover's back face and the camera. */
const RigUnit = memo(function RigUnit({ pose, token, reduced, frozen = false, renderScreen }: { pose: DuoPose; token: FoldToken; reduced: boolean; frozen?: boolean } & Pick<DuoRigProps, 'renderScreen'>) {
  const g = rigGeometry(pose.turn), fp = footprintOf(pose);
  const life = useLifecycle(pose.fold, token, frozen || reduced);
  // The inner display keeps the last open pose while a closing swing runs, so it does not change under the cover as it leaves.
  const [lastOpen, setLastOpen] = useState<DuoPose>(pose.fold === 'closed' ? { turn: pose.turn, fold: 'open' } : pose);
  if (pose.fold !== 'closed' && !samePose(lastOpen, pose)) setLastOpen(pose);
  const innerWindow = useMemo(() => duoWindow(pose.fold === 'closed' ? lastOpen : pose), [pose, lastOpen]);
  const outerWindow = useMemo(() => duoWindow({ turn: pose.turn, fold: 'closed' }), [pose.turn]);
  const tilts = halfTilts(pose.turn, pose.fold);
  const first = useRef<HTMLDivElement>(null), second = useRef<HTMLDivElement>(null);
  const roots: RefObject<HTMLElement | null>[] = useMemo(() => [first, second], []);
  useReflow(roots, `${pose.turn}:${pose.fold}`, token, !frozen && !reduced);
  useTwinScroll(first, second, life.inner && life.twin);
  useCopyReach(first, second, life.inner && life.twin && !frozen, `${pose.turn}:${pose.fold}:${life.done}`);
  const settled = life.done;
  const style = { width: g.unit.width, height: g.unit.height, transform: `translate(${-fp.cx}px, ${-fp.cy}px)`, '--sh-fold-ms': `${token.ms}ms`, '--sh-fold-ease': token.ease, '--sh-flatten-ms': `${FLATTEN_MS}ms` } as CSSProperties;
  return <div className="sh-rig" data-fold={pose.fold} data-turn={pose.turn} data-twin={life.twin ? '' : undefined} data-settling={life.done ? undefined : ''} data-frozen={frozen ? '' : undefined} style={style}>
    <div className="sh-ground" aria-hidden="true" style={{ left: fp.cx - fp.width / 2, top: fp.cy - fp.height / 2, width: fp.width, height: fp.height }}/>
    <div className="sh-rig-persp" style={{ perspective: PERSPECTIVE, width: g.unit.width, height: g.unit.height }}>
      {g.halves.map((half, at) => {
        const wide = at === 0 && !life.twin, hosted = at === 0 || life.twin;
        const clip: Box = wide ? { x: g.bezel, y: g.bezel, width: g.unit.width - 2 * g.bezel, height: g.unit.height - 2 * g.bezel } : half.clip;
        const host = wide ? { left: 0, top: 0 } : half.host;
        const lit = pose.fold === 'partly' && !half.first;
        return <div key={half.first ? 'first' : 'second'} className="sh-half" data-half={half.first ? 'first' : 'second'} data-cover={half.cover ? '' : undefined}
          // WebKit paints by DOM order and ignores `backface-visibility` here, so a half drawn later covers one drawn earlier. What cannot be seen is not painted: a closed Duo's base is wholly under the cover, and a flat Duo is one screen drawn in the first half, whose body then spans the whole device.
          data-unseen={settled && (pose.fold === 'closed' ? !half.cover : pose.fold === 'open' && !half.first) ? '' : undefined}
          style={{ ...box(half.box), transformOrigin: half.origin, transform: halfTransform(half, tilts[at]) }}>
          <div className="sh-inner">
            <div className="sh-body" style={{ borderRadius: radiiCss(half.bodyRadii), clipPath: clipPathOf(half, g.vertical) }}/>
            {settled && pose.fold === 'open' && half.first && <div className="sh-body" style={{ inset: 'auto', left: 0, top: 0, width: g.unit.width, height: g.unit.height, borderRadius: radiiCss(OPEN_DUO_BODY.bodyRadii) }}/>}
            {life.inner && hosted && <Clip wide={wide} style={{ ...box(clip), borderRadius: radiiCss(wide ? OPEN_DUO_BODY.screenRadii : half.screenRadii) }}>
              <div ref={at === 0 ? first : second} className="sh-host" data-copy={at} data-twin={at === 1 ? '' : undefined}
                style={{ left: host.left, top: host.top, width: innerWindow.width, height: innerWindow.height }}>
                {renderScreen(innerWindow, at === 0 ? 'primary' : 'twin')}
              </div>
              <div className="sh-light" data-on={lit ? '' : undefined}/>
            </Clip>}
          </div>
          {half.cover && life.outer && <OuterFace halfAxis={half.axis} face={g.outer.face} screen={g.outer.screen} bodyRadii={g.outer.bodyRadii} screenRadii={g.outer.screenRadii} strip={g.outer.strip}
            mounted={life.outer} window={outerWindow} renderScreen={renderScreen}/>}
        </div>;
      })}
    </div>
  </div>;
});

/** The cover's back face: the closed Duo's body, its outer display, the hinge strip and the camera cutout. It turns with the cover. */
function OuterFace({ halfAxis, face, screen, bodyRadii, screenRadii, strip, mounted, window: win, renderScreen }: {
  halfAxis: 'X' | 'Y'; face: Box; screen: Box; bodyRadii: Radii; screenRadii: Radii; strip: Box & { radius: number; edge: 'left' | 'top' | 'right' | 'bottom' };
  mounted: boolean; window: PreviewWindow; renderScreen: DuoRigProps['renderScreen'];
}) {
  const camera = win.camera;
  const corners: Record<string, string> = { left: '7px 0 0 7px', right: '0 7px 7px 0', top: '7px 7px 0 0', bottom: '0 0 7px 7px' };
  return <div className="sh-outer" style={{ ...box(face), transform: `rotate${halfAxis}(180deg) translateZ(${OUTER_LIFT}px)` }}>
    <div className="sh-body" style={{ borderRadius: radiiCss(bodyRadii) }}/>
    <div className="sh-strip" data-edge={strip.edge} style={{ ...box(strip), borderRadius: corners[strip.edge] }}/>
    {mounted && <Clip style={{ ...box(screen), borderRadius: radiiCss(screenRadii) }}>
      <div className="sh-host" data-outer="" style={{ left: 0, top: 0, width: win.width, height: win.height }}>{renderScreen(win, 'outer')}</div>
    </Clip>}
    {camera && <span className="sh-camera" aria-hidden="true" style={{ left: screen.x + camera.x - camera.size / 2, top: screen.y + camera.y - camera.size / 2, width: camera.size, height: camera.size }}/>}
  </div>;
}
