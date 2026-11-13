// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { DndContext, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileTouchSensor, useMobileDragGuard } from '../src/mobile-drag';

afterEach(cleanup);
describe('mobile drag geometry guard', () => {
  it('rejects a drop after a resize even if the host returns to its starting size', () => {
    const { result } = renderHook(() => useMobileDragGuard('design:page:home'));
    act(() => result.current.begin());
    fireEvent(window, new Event('resize'));
    expect(result.current.cancelDrop()).toBe(true);
    act(() => { result.current.finish(); result.current.begin(); });
    expect(result.current.cancelDrop()).toBe(false);
  });

  describe('mobile touch sensor', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      fireEvent.touchCancel(document);
      act(() => vi.runOnlyPendingTimers());
      vi.useRealTimers();
    });
    function Handle() {
      const { setNodeRef, listeners, attributes } = useDraggable({ id: 'component' });
      return <button ref={setNodeRef} {...listeners} {...attributes}>Drag component</button>;
    }
    function Harness({ start, cancel }: { start: () => void; cancel: () => void }) {
      const sensors = useSensors(useSensor(MobileTouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }));
      return <DndContext sensors={sensors} onDragStart={start} onDragCancel={cancel}><Handle/><div data-testid="outside">Other pane</div></DndContext>;
    }
    function touch(target: EventTarget, identifier = 1, x = 10, y = 10): Touch {
      return { target, identifier, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y, radiusX: 1, radiusY: 1, rotationAngle: 0, force: 1 };
    }
    function move(target: HTMLElement, touches: Touch[]) {
      const event = new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches });
      fireEvent(target, event);
      return event;
    }

    it('abandons a pending hold when another finger touches elsewhere without consuming pinch moves', () => {
      const start = vi.fn();
      render(<Harness start={start} cancel={vi.fn()}/>);
      const handle = screen.getByRole('button', { name: 'Drag component' });
      const other = screen.getByTestId('outside');
      const first = touch(handle);
      const second = touch(other, 2);
      fireEvent.touchStart(handle, { touches: [first] });
      act(() => vi.advanceTimersByTime(100));
      fireEvent.touchStart(other, { touches: [first, second] });
      act(() => vi.advanceTimersByTime(300));
      expect(start).not.toHaveBeenCalled();
      expect(move(handle, [first, second]).defaultPrevented).toBe(false);
      fireEvent.touchEnd(handle, { touches: [] });
      fireEvent.touchStart(handle, { touches: [first] });
      act(() => vi.advanceTimersByTime(220));
      expect(start).toHaveBeenCalledOnce();
      fireEvent.touchEnd(handle, { touches: [] });
    });

    it('cancels an active drag when a second finger joins and releases native gestures', () => {
      const start = vi.fn();
      const cancel = vi.fn();
      render(<Harness start={start} cancel={cancel}/>);
      const handle = screen.getByRole('button', { name: 'Drag component' });
      const first = touch(handle);
      fireEvent.touchStart(handle, { touches: [first] });
      act(() => vi.advanceTimersByTime(220));
      expect(start).toHaveBeenCalledOnce();
      expect(move(handle, [touch(handle, 1, 15, 15)]).defaultPrevented).toBe(true);
      const second = touch(document.body, 2);
      fireEvent.touchStart(document.body, { touches: [first, second] });
      expect(cancel).toHaveBeenCalledOnce();
      expect(move(handle, [first, second]).defaultPrevented).toBe(false);
    });

    it('leaves scrolling unprevented when movement exceeds the pending hold tolerance', () => {
      const start = vi.fn();
      render(<Harness start={start} cancel={vi.fn()}/>);
      const handle = screen.getByRole('button', { name: 'Drag component' });
      fireEvent.touchStart(handle, { touches: [touch(handle)] });
      expect(move(handle, [touch(handle, 1, 10, 30)]).defaultPrevented).toBe(false);
      act(() => vi.advanceTimersByTime(300));
      expect(start).not.toHaveBeenCalled();
      expect(move(handle, [touch(handle, 1, 10, 60)]).defaultPrevented).toBe(false);
    });
  });

  it('rejects a stale drop when context changes away and back during the drag', () => {
    const { result, rerender } = renderHook(({ context }) => useMobileDragGuard(context), { initialProps: { context: 'design:page:home' } });
    act(() => result.current.begin());
    rerender({ context: 'variables:page:home' });
    rerender({ context: 'design:page:home' });
    expect(result.current.cancelDrop()).toBe(true);
    act(() => { result.current.finish(); result.current.begin(); });
    expect(result.current.cancelDrop()).toBe(false);
  });

  it.each(['innerWidth', 'innerHeight'] as const)('detects changed %s before a resize event has been delivered', dimension => {
    const original = window[dimension];
    const { result } = renderHook(() => useMobileDragGuard('design:page:home'));
    act(() => result.current.begin());
    Object.defineProperty(window, dimension, { configurable: true, value: original - 100 });
    try { expect(result.current.cancelDrop()).toBe(true); }
    finally { Object.defineProperty(window, dimension, { configurable: true, value: original }); }
  });

  it('rejects an explicit pane invalidation and cleans up resize listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useMobileDragGuard('design:page:home'));
    act(() => result.current.begin());
    act(() => result.current.invalidate());
    expect(result.current.cancelDrop()).toBe(true);
    act(() => { result.current.finish(); result.current.begin(); });
    const guard = result.current;
    unmount();
    fireEvent(window, new Event('resize'));
    expect(guard.cancelDrop()).toBe(false);
  });
});
