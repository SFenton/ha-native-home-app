import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tidy, hasBraces, stripBraces, type Part, type Token } from './tokens';

/** What the line needs to draw and to ask: the words of a token, and what to do when one is pressed or a value is asked for. */
export interface TokenLineProps {
  label: string;
  parts: readonly Part[];
  nameOf: (token: Token) => string;
  /** A use of a logic template or a setting of one: how it is marked and what a screen reader says. */
  describe?: (token: Token) => { role: 'use' | 'setting'; label: string } | undefined;
  onChange: (parts: Part[], typing: boolean) => void;
  /** A token was pressed (or Enter on a selected one). `anchor` is its element, for a popover. */
  onOpenToken: (index: number, anchor: HTMLElement) => void;
  /** `{` was typed: the caller opens the value picker, and later calls `insert`. */
  onAsk: () => void;
  /** Said under the field: "Text can't contain { or }." */
  onNote: (note: string) => void;
  /** Gives the caller the function that inserts a token at the caret (or the end). */
  register: (insert: (token: Token) => void) => void;
  invalid?: boolean;
  describedBy?: string;
}

const same = (a: readonly Part[], b: readonly Part[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The token line (spec "The token line"): text with value tokens, in a `contenteditable` that holds each token as one non-editable
 * character. Typing is plain text; `{` asks for a value; Backspace before a token selects it and a second one removes it. The DOM is
 * the author while typing and is rebuilt only when the parts change from outside (a token edited, a mode switch, an undo).
 */
export default function TokenLine({ label, parts, nameOf, describe, onChange, onOpenToken, onAsk, onNote, register, invalid, describedBy }: TokenLineProps) {
  const root = useRef<HTMLDivElement>(null);
  const tokens = useRef<Token[]>([]);
  const caretAfter = useRef<number | undefined>(undefined);
  const [announce, setAnnounce] = useState('');
  const saved = useRef<Range | null>(null);

  const read = (): Part[] => {
    const out: Part[] = [];
    root.current?.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) out.push({ text: node.nodeValue ?? '' });
      else if (node instanceof HTMLElement && node.dataset.k !== undefined) { const token = tokens.current[Number(node.dataset.k)]; if (token) out.push({ token }); }
      else if (node instanceof HTMLElement && node.tagName !== 'BR') out.push({ text: node.textContent ?? '' });
    });
    return tidy(out);
  };
  const build = (next: readonly Part[]) => {
    const element = root.current;
    if (!element) return;
    element.replaceChildren();
    tokens.current = [];
    for (const part of next) {
      if ('text' in part) { element.append(document.createTextNode(part.text)); continue; }
      const span = document.createElement('span');
      span.className = 'w2-token'; span.contentEditable = 'false'; span.dataset.k = String(tokens.current.length); span.setAttribute('role', 'button'); span.tabIndex = -1;
      const name = nameOf(part.token);
      const kind = describe?.(part.token);
      span.textContent = name; span.setAttribute('aria-label', kind ? kind.label : `value: ${name}`);
      if (kind) { span.dataset.logic = kind.role; span.classList.add(kind.role === 'use' ? 'w2-token-logic' : 'w2-token-setting'); }
      tokens.current.push(part.token);
      element.append(span);
    }
    if (caretAfter.current !== undefined) {
      const span = element.querySelector(`[data-k="${caretAfter.current}"]`);
      if (span) { const range = document.createRange(); range.setStartAfter(span); range.collapse(true); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
      caretAfter.current = undefined;
    }
  };
  // Rebuild when the parts differ from what the DOM holds, never while the DOM is what produced them.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const spans = [...element.querySelectorAll('.w2-token')];
    const named = spans.length === tokens.current.length && spans.every((span, index) => span.textContent === nameOf(tokens.current[index]));
    if (named && same(read(), tidy(parts))) return;
    build(parts);
  });

  const remember = () => { const selection = getSelection(); if (selection?.rangeCount && root.current?.contains(selection.anchorNode)) saved.current = selection.getRangeAt(0).cloneRange(); };
  const emit = (typing: boolean) => {
    let next = read();
    if (next.some(part => 'text' in part && hasBraces(part.text))) {
      next = next.map(part => 'text' in part ? { text: stripBraces(part.text) } : part);
      onNote("Text can't contain { or }."); build(next);
    } else onNote('');
    onChange(next, typing);
  };
  register(token => {
    const element = root.current;
    if (!element) return;
    // Split the line at the saved caret (or the end) and put the token between the halves.
    const range = saved.current && element.contains(saved.current.startContainer) ? saved.current : undefined;
    const before: Part[] = [], after: Part[] = [];
    let placed = false;
    element.childNodes.forEach((node, at) => {
      if (range && range.startContainer === element && at === range.startOffset) placed = true;
      if (range && node === range.startContainer && node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue ?? '';
        before.push({ text: text.slice(0, range.startOffset) }); after.push({ text: text.slice(range.startOffset) }); placed = true; return;
      }
      const part: Part = node.nodeType === Node.TEXT_NODE ? { text: node.nodeValue ?? '' }
        : node instanceof HTMLElement && node.dataset.k !== undefined && tokens.current[Number(node.dataset.k)] ? { token: tokens.current[Number(node.dataset.k)] } : { text: '' };
      (placed ? after : before).push(part);
    });
    caretAfter.current = before.filter(part => 'token' in part).length;
    onNote('');
    onChange(tidy([...before, { token }, ...after]), false);
    saved.current = null;
  });

  const previousToken = (): HTMLElement | undefined => {
    const selection = getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode || !root.current?.contains(selection.anchorNode)) return undefined;
    let node: Node | null = selection.anchorNode, offset = selection.anchorOffset;
    if (node === root.current) node = root.current.childNodes[offset - 1] ?? null;
    else if (node.nodeType === Node.TEXT_NODE && offset === 0) node = node.previousSibling;
    else return undefined;
    return node instanceof HTMLElement && node.dataset.k !== undefined ? node : undefined;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === '{') { event.preventDefault(); remember(); onAsk(); return; }
    if (event.key === '}') { event.preventDefault(); onNote("Text can't contain { or }."); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = root.current?.querySelector<HTMLElement>('.w2-token[data-selected]');
      if (selected) onOpenToken(Number(selected.dataset.k), selected);
      return;
    }
    if (event.key === 'Backspace') {
      const token = previousToken();
      if (!token) return;
      event.preventDefault();
      if (token.dataset.selected !== undefined) { token.remove(); setAnnounce(''); emit(false); return; }
      root.current?.querySelectorAll('.w2-token[data-selected]').forEach(item => item.removeAttribute('data-selected'));
      token.dataset.selected = ''; setAnnounce(`${token.textContent}, value, selected. Press Delete to remove, Enter to edit.`);
      return;
    }
    if (event.key !== 'Shift') root.current?.querySelectorAll('.w2-token[data-selected]').forEach(item => item.removeAttribute('data-selected'));
  };
  return <>
    <div ref={root} className="w2-token-line" role="textbox" aria-multiline="false" aria-label={label} aria-invalid={invalid || undefined} aria-describedby={describedBy} contentEditable suppressContentEditableWarning spellCheck={false} data-testid="token-line"
      onInput={() => emit(true)} onKeyDown={onKeyDown} onKeyUp={remember} onMouseUp={remember} onBlur={remember}
      onPaste={event => { event.preventDefault(); document.execCommand('insertText', false, stripBraces(event.clipboardData.getData('text/plain')).replace(/\s+/g, ' ')); }}
      onClick={event => { const token = (event.target as HTMLElement).closest<HTMLElement>('.w2-token'); if (token) onOpenToken(Number(token.dataset.k), token); }}/>
    <span className="w2-sr" role="status" aria-live="polite">{announce}</span>
  </>;
}
