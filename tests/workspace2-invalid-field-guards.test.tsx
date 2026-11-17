// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../src/preview2/fixtures/home-domains.json';
import CompositionFields from '../src/CompositionFields';
import { NumberField } from '../src/ui';
import type { CompositionDocument } from '../src/shared/composition/schema';
import PreviewGuard from '../src/workspace2/PreviewGuard';
import { RequestPage } from '../src/workspace2/styles/RequestPage';
import { builtInStyle } from '../src/shared/composition/state-styles';
import { Rows } from '../src/workspace2/rowsContext';

afterEach(cleanup);
const document = fixture.document as unknown as CompositionDocument;

describe('a number outside its limits', () => {
  it('goes into the draft with its message, and half a number waits', () => {
    const onChange = vi.fn();
    render(<NumberField label="Per page" value={4} min={1} max={8} step={1} onChange={onChange}/>);
    const input = screen.getByLabelText('Per page');
    fireEvent.change(input, { target: { value: '99' } });
    expect(onChange).toHaveBeenLastCalledWith(99);
    expect(screen.getByText('Use 1 to 8 in steps of 1.')).toBeTruthy();
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(screen.queryByText('Use 1 to 8 in steps of 1.')).toBeNull();
    onChange.mockClear();
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Use 1 to 8 in steps of 1.')).toBeTruthy();
  });
});

describe('a field the Checks name', () => {
  it('says what is wrong under the field and still takes an edit', () => {
    const onChange = vi.fn();
    const path = ['pages', 0, 'components', 0, 'props', 'hint'];
    render(<Rows.Provider value={{ document, onChange, onError: vi.fn(), problems: new Map([[path.join('/'), 'Hint is needed. Add it.']]) }}>
      <CompositionFields schema={{ type: 'string', maxLength: 240 }} value="" path={path} label="Hint" document={document} onChange={onChange} onError={vi.fn()} options={{ rows: true, fieldPath: true }}/>
    </Rows.Provider>);
    expect(screen.getByText('Hint is needed. Add it.').closest('[data-field-path]')?.getAttribute('data-field-path')).toBe(path.join('/'));
    fireEvent.change(screen.getByLabelText('Hint'), { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it('shows no message for a field with no problem', () => {
    const { container } = render(<Rows.Provider value={{ document, onChange: vi.fn(), onError: vi.fn(), problems: new Map() }}>
      <CompositionFields schema={{ type: 'string', maxLength: 240 }} value="a" path={['x']} label="Hint" document={document} onChange={vi.fn()} onError={vi.fn()} options={{ rows: true, fieldPath: true }}/>
    </Rows.Provider>);
    expect(container.querySelector('[data-field-problem]')).toBeNull();
  });
});

describe('PreviewGuard', () => {
  const good = { name: 'good' } as unknown as CompositionDocument, newer = { name: 'newer' } as unknown as CompositionDocument, broken = { name: 'broken' } as unknown as CompositionDocument;
  // The renderer is a component below the guard, so a document it cannot draw throws there, as Preview2 would.
  const Page = ({ shown }: { shown: CompositionDocument }) => { if ((shown as unknown as { name: string }).name === 'broken') throw new Error('cannot draw'); return <p>{(shown as unknown as { name: string }).name}</p>; };
  const draw = (shown: CompositionDocument) => <Page shown={shown}/>;
  it('draws the newest document, and the last good one only for a document the renderer cannot draw', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(<PreviewGuard document={good} lastGood={good}>{draw}</PreviewGuard>);
    expect(screen.getByText('good')).toBeTruthy();
    view.rerender(<PreviewGuard document={broken} lastGood={good}>{draw}</PreviewGuard>);
    expect(screen.getByText('good')).toBeTruthy();
    view.rerender(<PreviewGuard document={newer} lastGood={good}>{draw}</PreviewGuard>);
    expect(screen.getByText('newer')).toBeTruthy();
    quiet.mockRestore();
  });
  it('draws nothing rather than loop when there is no good document to fall back on', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(<PreviewGuard document={broken} lastGood={undefined}>{draw}</PreviewGuard>);
    expect(container.textContent).toBe('');
    quiet.mockRestore();
  });
});

describe('the State Styles request page', () => {
  it('takes a wait outside its range into the draft, says so under it, and still ignores half a number', () => {
    const request = { lockoutSeconds: 2, ackTimeoutSeconds: 10, settleTimeoutSeconds: 45, errorHoldSeconds: 4, onTimeout: 'error' as const };
    const saved = { ...builtInStyle('lock')!, id: 'house-lock', name: 'House lock', base: 'lock' as const, request };
    const stocked = { ...document, stateStyles: { type: 'state-styles@1' as const, styles: [saved] } } as CompositionDocument;
    const onChange = vi.fn();
    render(<Rows.Provider value={{ document: stocked, onChange, onError: vi.fn() }}><RequestPage id="house-lock"/></Rows.Provider>);
    fireEvent.change(screen.getByLabelText('Ignore taps for'), { target: { value: '99' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as CompositionDocument).stateStyles!.styles[0].request!.lockoutSeconds).toBe(99);
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText('Ignore taps for'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
