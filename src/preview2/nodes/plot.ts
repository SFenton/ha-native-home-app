import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Operand } from '../../shared/composition/expression';
import { evaluateOperand } from '../evaluate';
import { useRender } from '../render-context';

/** The number an operand gives against the house, or `null` when it is unavailable, loading or not a number (a null hides a marker and breaks a line). */
export function useNumber(operand: Operand | undefined): number | null {
  const { env } = useRender();
  if (!operand) return null;
  const result = evaluateOperand(operand, env);
  if (result.status !== 'value') return null;
  const value = result.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

/** The width of an element in points, kept as it resizes; `fallback` until it has been measured (and in a test that has no layout). */
export function useWidth<T extends HTMLElement>(fallback: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { const next = element.getBoundingClientRect().width; if (next > 0) setWidth(old => Math.abs(old - next) < 0.01 ? old : next); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
