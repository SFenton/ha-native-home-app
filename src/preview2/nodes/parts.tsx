import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { FontProps, StackProps } from '../../shared/composition/schema';
import { inkColor } from '../../shared/composition/ink-css';
import { layoutStack, spacePoints, type StackLayout, type StackMeasure } from '../../shared/composition/stack-layout';
import { useRender } from '../render-context';
import { Children } from './Children';
import { GlyphByName, Pressable, useOperand, useSymbol, type NodeOf } from './shared';
import './parts.css';

// MARK: Text style (`sh.text-style@1`)

const weights: Record<NonNullable<FontProps['weight']>, number> = { 'ultra-light': 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
/** Whether a text uses any field `sh.text-style@1` adds; a text that does not is drawn exactly as before. */
export const isStyledText = (props: NodeOf<'text'>['props']): boolean => Boolean(props.font || props.ink || props.lines !== undefined || props.align || props.overflow);

/**
 * The CSS of a text's font, ink, lines, alignment and overflow. A scaled size is its points times the simulated text size, up to its cap, which is how a
 * system font scales relative to a style (the preview scales every style by the same factor).
 */
export function textStyleCss(props: NodeOf<'text'>['props']): CSSProperties {
  const style: Record<string, string | number> = {};
  const { font, ink, lines, align } = props;
  if (font?.weight) style.fontWeight = weights[font.weight];
  if (font?.digits === 'monospaced') style.fontVariantNumeric = 'tabular-nums';
  if (font?.scale) {
    const scaled = `calc(${font.scale.points}px * var(--sh-text-scale, 1))`;
    style.fontSize = font.scale.maxPoints ? `min(${font.scale.maxPoints}px, ${scaled})` : scaled;
    style.lineHeight = 1.05;
  }
  const colour = inkColor(ink);
  if (colour) style.color = colour;
  if (align) style.textAlign = align;
  if (lines !== undefined && lines > 0 && props.overflow !== 'ticker') {
    style.display = '-webkit-box'; style.WebkitBoxOrient = 'vertical'; style.WebkitLineClamp = lines; style.overflow = 'hidden';
  }
  return style as CSSProperties;
}

/** A line that slides at a constant speed when it is wider than its place, and stays still when it fits or when Reduce Motion is on. */
function Ticker({ text }: { text: string }) {
  const box = useRef<HTMLSpanElement>(null), inner = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  useLayoutEffect(() => {
    const outer = box.current, line = inner.current;
    if (!outer || !line) return;
    const measure = () => setDistance(Math.max(0, Math.ceil(line.scrollWidth - outer.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [text]);
  return <span ref={box} className="sh-ticker" data-ticking={distance > 0 ? '' : undefined} style={{ '--sh-ticker-distance': `${distance}px`, '--sh-ticker-seconds': `${Math.max(2, distance / 30)}s` } as CSSProperties}>
    <span ref={inner} className="sh-ticker-line">{text}</span>
  </span>;
}

/** `text` with `sh.text-style@1` fields. */
export function StyledText({ node }: { node: NodeOf<'text'> }) {
  const value = useOperand(node.props.value, node.props.unavailableText, `${node.id}/value`);
  const { overflow } = node.props;
  return <p className={`sh-text sh-text-${node.props.style}`} data-state={value.state} data-overflow={overflow} data-lines={node.props.lines}
    style={textStyleCss(node.props)}>{overflow === 'ticker' ? <Ticker text={value.text}/> : value.text}</p>;
}

// MARK: Stack and shape (`sh.stack@1`)

const alignment = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;
const radiusOf = (radius: { type: 'token'; name: string } | { type: 'points'; value: number } | undefined) => radius ? (radius.type === 'token' ? 22 : radius.value) : 0;

/** The natural width of a drawn child: its wrapper laid out at `max-content`, so it does not depend on the arrangement chosen. */
function naturalWidth(element: HTMLElement): number {
  const { width, flex, maxWidth } = element.style;
  element.style.width = 'max-content'; element.style.flex = 'none'; element.style.maxWidth = 'none';
  const measured = element.offsetWidth;
  element.style.width = width; element.style.flex = flex; element.style.maxWidth = maxWidth;
  return measured;
}

/** What VoiceOver reads for a stack with its own accessibility settings: one element for `group`, the children for `children`, nothing for `hidden`. */
function useA11y(a11y: NodeOf<'stack'>['a11y'], action: boolean, key: string) {
  const label = useOperand(a11y?.label, '', `${key}/label`), value = useOperand(a11y?.value, '', `${key}/value`);
  if (!a11y) return {};
  if (a11y.element === 'hidden') return { 'aria-hidden': true as const };
  if (a11y.element !== 'group') return {};
  const name = [label.text, value.text].filter(Boolean).join(', ');
  return { role: action ? undefined : a11y.role === 'header' ? 'heading' : 'group', 'aria-label': name || undefined, title: a11y.hint };
}

/**
 * `stack` (`sh.stack@1`): children in a row or a column, optionally in groups, with spacing, padding, lines between neighbours, a surface and a tap. A
 * horizontal stack with a `collapse` measures its children at their natural widths and chooses its arrangement with the same `layoutStack` the contract's
 * evaluation corpus pins. It is the app's own measuring this stands in for: the numbers agree, the pixels are the preview's.
 */
export function StackNode({ node }: { node: NodeOf<'stack'> }) {
  const { largeText = false } = useRender();
  const { props, children } = node;
  const body = useRef<HTMLDivElement>(null);
  const plain = useMemo(() => layoutStack({ props, children: children.map(child => ({ id: child.id, width: 0 })), width: Infinity, accessibilitySize: largeText }), [props, children, largeText]);
  const [measured, setMeasured] = useState<StackLayout>();
  const collapses = props.collapse !== undefined;
  useLayoutEffect(() => {
    const element = body.current;
    if (!collapses || !element) return;
    const measure = () => {
      const widths: StackMeasure[] = children.map(child => {
        const found = [...element.querySelectorAll<HTMLElement>('[data-sel]')].find(item => item.dataset.sel === `node:${child.id}`);
        return { id: child.id, width: found ? naturalWidth(found) : 0, shrinks: child.type === 'text' && (child.props.overflow === 'truncate' || child.props.overflow === 'ticker') };
      });
      const next = layoutStack({ props, children: widths, width: element.clientWidth, accessibilitySize: largeText });
      setMeasured(old => old && old.collapsed === next.collapsed && old.reason === next.reason ? old : next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });
  const arrangement = collapses ? measured ?? plain : plain;
  const horizontal = arrangement.axis === 'horizontal';
  const byId = new Map(children.map(child => [child.id, child]));
  const grouped = props.groups !== undefined || (arrangement.collapsed && props.collapse?.groups !== undefined);
  const ink = props.dividers ? inkColor(props.dividers.ink) : undefined;
  const parts: ReactNode[] = [];
  const divider = (key: string) => <span key={key} className="sh-stack-divider" aria-hidden="true" style={{ [horizontal ? 'width' : 'height']: props.dividers!.width, background: ink }}/>;
  if (grouped) {
    arrangement.groups.forEach((group, at) => {
      if (at > 0 && props.dividers) parts.push(divider(`divider-${at}`));
      const members = group.children.map(id => byId.get(id)).filter((child): child is NonNullable<typeof child> => child !== undefined);
      parts.push(<div key={`group-${at}`} className="sh-stack-group" data-grow={group.grow ? '' : undefined}
        style={{ flexDirection: horizontal ? 'column' : 'row', gap: group.spacing, alignItems: alignment[group.align], justifyContent: group.distribution === 'spread' ? 'space-between' : undefined }}>
        <Children nodes={members}/>
      </div>);
    });
  } else {
    children.forEach((child, at) => {
      if (at > 0 && props.dividers) parts.push(divider(`divider-${at}`));
      parts.push(<Children key={child.id} nodes={[child]}/>);
    });
  }
  const pad = props.padding;
  const surface = props.surface;
  const style: CSSProperties = {
    ...(pad ? { padding: `${spacePoints(pad.top)}px ${spacePoints(pad.trailing)}px ${spacePoints(pad.bottom)}px ${spacePoints(pad.leading)}px` } : {}),
    ...(surface?.type === 'fill' ? {
      background: inkColor(surface.fill), borderRadius: radiusOf(surface.radius),
      boxShadow: surface.border ? `inset 0 0 0 ${surface.border.width}px ${inkColor(surface.border.ink)}` : undefined,
    } : {}),
  };
  const a11y = useA11y(node.a11y, node.action !== undefined, node.id);
  const { mode } = useRender();
  const inner = <div ref={body} className="sh-stack-body" data-axis={arrangement.axis} data-collapsed={arrangement.collapsed ? arrangement.reason : undefined}
    data-align={props.align ?? 'start'} style={{ gap: arrangement.spacing, alignItems: alignment[props.align ?? 'start'], justifyContent: props.distribution === 'spread' ? 'space-between' : undefined }}>
    {parts}{mode === 'edit' && <Children nodes={[]} owner={`node:${node.id}`}/>}
  </div>;
  const classes = `sh-stack${surface?.type === 'module' ? ` sh-stack-module sh-stack-${surface.density}` : ''}`;
  if (node.action) return <Pressable action={node.action} className={`${classes} sh-pressable`} style={style} label={a11y['aria-label']}>{inner}</Pressable>;
  return <div className={classes} style={style} {...a11y} data-testid={undefined}>{inner}</div>;
}

/** `shape` (`sh.stack@1`): a capsule, a rectangle or a circle of one colour. Decoration: assistive technologies skip it. */
export function ShapeNode({ node }: { node: NodeOf<'shape'> }) {
  const { form, width, height, fill } = node.props;
  return <span className="sh-shape" data-form={form} aria-hidden="true"
    style={{ width, height, background: inkColor(fill), borderRadius: form === 'circle' ? '50%' : form === 'capsule' ? Math.min(width, height) / 2 : 0 }}/>;
}

// MARK: Symbol part (`sh.symbol-part@1`)

/** `symbol` (`sh.symbol-part@1`): a symbol chosen by state, drawn at a Dynamic Type size, turned by an operand. The preview draws the nearest glyph of its own set. */
export function SymbolPartNode({ node }: { node: NodeOf<'symbol'> }) {
  const { name, size, rendering, tint, trim, rotate } = node.props;
  const symbol = useSymbol(name, `${node.id}/name`);
  const turn = useOperand(rotate, '', `${node.id}/rotate`);
  const degrees = rotate && turn.text !== '' && Number.isFinite(Number(turn.text)) ? Number(turn.text) : 0;
  const scaled = `calc(${size.points}px * var(--sh-text-scale, 1))`;
  const length = size.relativeTo ? (size.maxScale ? `min(${size.points * size.maxScale}px, ${scaled})` : scaled) : `${size.points}px`;
  const image = node.a11y.element === 'image';
  const label = useOperand(node.a11y.element === 'image' ? node.a11y.label : undefined, '', `${node.id}/label`);
  const colour = tint ? inkColor(tint) : undefined;
  return <span className="sh-symbol" data-rendering={rendering} data-trim={trim ?? 'none'} data-symbol={symbol.name} role={image ? 'img' : undefined} aria-label={image ? label.text : undefined} aria-hidden={image ? undefined : true}
    style={{ width: length, height: length, color: colour, transform: degrees ? `rotate(${degrees}deg)` : undefined }}>
    <GlyphByName name={symbol.name} size={24}/>
  </span>;
}
