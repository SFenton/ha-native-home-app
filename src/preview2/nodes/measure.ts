import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Operand } from '../../shared/composition/expression';
import { evaluateOperand } from '../evaluate';
import { useRender } from '../render-context';

/** The number an operand gives against the house, or `null` when it is unavailable, loading or not a number (a null hides a marker or a needle). */
export function useNumberOperand(operand: Operand | undefined): number | null {
  const { env } = useRender();
  if (!operand) return null;
  const result = evaluateOperand(operand, env);
  if (result.status !== 'value') return null;
  const value = result.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

/**
 * The width of an element in points and whether it reads right to left, both kept as it resizes or its direction changes; `fallback` and left to right until it
 * has been measured (and in a test that has no layout).
 */
export function useMeasuredBox<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number, boolean] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  const [rtl, setRtl] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.offsetWidth || element.getBoundingClientRect().width; // layout points: a scaled preview frame must not change the size
      if (next > 0) setWidth(old => Math.abs(old - next) < 0.01 ? old : next);
      setRtl(typeof getComputedStyle === 'function' && getComputedStyle(element).direction === 'rtl');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width, rtl];
}
