import { useCallback, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { TouchSensor, type DndContext, type SensorProps } from '@dnd-kit/core';
import { componentCatalog } from './shared/catalog';

type MobileTouchOptions = { activationConstraint: { delay: number; tolerance: number } };

// Core 6.3.1's TouchSensor cannot publicly abort a pending hold on a second touch.
export class MobileTouchSensor {
  static activators = TouchSensor.activators;
  static setup = TouchSensor.setup;
  autoScrollEnabled = true;
  private readonly props: SensorProps<MobileTouchOptions>;
  private readonly document: Document;
  private readonly initial: { x: number; y: number };
  private readonly identifier: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private finished = false;

  constructor(props: SensorProps<MobileTouchOptions>) {
    this.props = props;
    this.document = props.event.target instanceof Node ? props.event.target.ownerDocument ?? document : document;
    if (!(props.event instanceof TouchEvent) || props.event.touches.length !== 1) throw new Error('Mobile touch dragging requires one initial touch.');
    const touch = props.event.touches[0];
    this.initial = { x: touch.clientX, y: touch.clientY };
    this.identifier = touch.identifier;
    this.document.addEventListener('touchstart', this.additionalTouch, { capture: true, passive: true });
    this.document.addEventListener('touchmove', this.move, { passive: false });
    this.document.addEventListener('touchend', this.end);
    this.document.addEventListener('touchcancel', this.cancel);
    this.document.addEventListener('keydown', this.keydown);
    this.document.addEventListener('visibilitychange', this.cancel);
    this.document.addEventListener('contextmenu', this.preventNativeDrag);
    this.document.addEventListener('dragstart', this.preventNativeDrag);
    this.document.defaultView?.addEventListener('resize', this.cancel);
    this.timer = setTimeout(this.start, props.options.activationConstraint.delay);
    props.onPending(props.active, props.options.activationConstraint, this.initial);
  }

  private additionalTouch = (event: TouchEvent) => { if (event.touches.length !== 1) this.cancel(); };
  private keydown = (event: KeyboardEvent) => { if (event.code === 'Escape') this.cancel(); };
  private preventNativeDrag = (event: Event) => { if (this.started) event.preventDefault(); };
  private suppressClick = (event: MouseEvent) => { event.stopPropagation(); };
  private clearSelection = () => { this.document.getSelection()?.removeAllRanges(); };
  private start = () => {
    if (this.finished) return;
    this.started = true;
    this.document.addEventListener('click', this.suppressClick, true);
    this.document.addEventListener('selectionchange', this.clearSelection);
    this.clearSelection();
    this.props.onStart(this.initial);
  };
  private move = (event: TouchEvent) => {
    if (event.touches.length !== 1 || event.touches[0].identifier !== this.identifier) { this.cancel(); return; }
    const touch = event.touches[0];
    const coordinates = { x: touch.clientX, y: touch.clientY };
    if (!this.started) {
      const offset = { x: coordinates.x - this.initial.x, y: coordinates.y - this.initial.y };
      if (Math.hypot(offset.x, offset.y) > this.props.options.activationConstraint.tolerance) { this.cancel(); return; }
      this.props.onPending(this.props.active, this.props.options.activationConstraint, this.initial, offset);
      return;
    }
    if (event.cancelable) event.preventDefault();
    this.props.onMove(coordinates);
  };
  private end = () => { this.finish(false); };
  private cancel = () => { this.finish(true); };
  private finish(cancelled: boolean) {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    this.document.removeEventListener('touchstart', this.additionalTouch, true);
    this.document.removeEventListener('touchmove', this.move);
    this.document.removeEventListener('touchend', this.end);
    this.document.removeEventListener('touchcancel', this.cancel);
    this.document.removeEventListener('keydown', this.keydown);
    this.document.removeEventListener('visibilitychange', this.cancel);
    this.document.removeEventListener('contextmenu', this.preventNativeDrag);
    this.document.removeEventListener('dragstart', this.preventNativeDrag);
    this.document.removeEventListener('selectionchange', this.clearSelection);
    this.document.defaultView?.removeEventListener('resize', this.cancel);
    if (this.started) setTimeout(() => this.document.removeEventListener('click', this.suppressClick, true), 50);
    else this.props.onAbort(this.props.active);
    if (cancelled) this.props.onCancel();
    else this.props.onEnd();
  }
}

type DragSession = { width: number; height: number; context: string; invalid: boolean };
export type MobileDragGuard = {
  begin: () => void;
  finish: () => void;
  invalidate: () => void;
  cancelDrop: () => boolean;
};

export function useMobileDragGuard(context: string): MobileDragGuard {
  const session = useRef<DragSession | undefined>(undefined);
  const currentContext = useRef(context);
  const invalidate = useCallback(() => { if (session.current) session.current.invalid = true; }, []);
  useLayoutEffect(() => {
    currentContext.current = context;
    invalidate();
  }, [context, invalidate]);
  useLayoutEffect(() => {
    window.addEventListener('resize', invalidate);
    return () => window.removeEventListener('resize', invalidate);
  }, [invalidate]);
  const begin = useCallback(() => {
    session.current = { width: window.innerWidth, height: window.innerHeight, context: currentContext.current, invalid: false };
  }, []);
  const finish = useCallback(() => { session.current = undefined; }, []);
  const cancelDrop = useCallback(() => {
    const drag = session.current;
    return Boolean(drag && (drag.invalid || drag.width !== window.innerWidth || drag.height !== window.innerHeight || drag.context !== currentContext.current));
  }, []);
  return { begin, finish, invalidate, cancelDrop };
}

const itemName = (data: Record<string, unknown> | undefined) => {
  if (typeof data?.title === 'string' && data.title.trim()) return data.title;
  return componentCatalog.find(entry => entry.type === data?.type)?.label ?? 'component';
};
export const mobileDragAccessibility = {
  screenReaderInstructions: {
    draggable: 'To pick up a component, press Space or Enter on its drag handle. Use the arrow keys to choose a position. Press Space or Enter to drop, or Escape to cancel. Use Project layer Actions, then Move to, for placement without dragging.',
  },
  announcements: {
    onDragStart: ({ active }) => `Picked up ${itemName(active.data.current)}.`,
    onDragOver: ({ active, over }) => over ? `Moving ${itemName(active.data.current)} over ${itemName(over.data.current)}.` : 'No drop target. Release to cancel.',
    onDragEnd: ({ active, over }) => over ? `Dropped ${itemName(active.data.current)}.` : `Move of ${itemName(active.data.current)} canceled.`,
    onDragCancel: ({ active }) => `Move of ${itemName(active.data.current)} canceled.`,
  },
} satisfies NonNullable<ComponentProps<typeof DndContext>['accessibility']>;
