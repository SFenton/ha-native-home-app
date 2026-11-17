import { describe, expect, it } from 'vitest';
import { DUO_PORTRAIT_SHEET_WIDTH, FORM_SHEET, leadingHalfWidth, PAGE_SHEET_WIDTH, scalesBackBehindSheet, sheetFrame } from '../src/preview2/sheet-frame';
import { previewWindows, withPose } from '../src/preview2/windows';

const win = (name: string) => previewWindows.find(item => item.name === name)!;
const form = { width: 'form' } as const, page = { width: 'page' } as const;

describe('sheet frame', () => {
  it('takes the full width from the bottom in a compact window, full height on the folded Duo', () => {
    expect(sheetFrame(win('iPhone'), form)).toEqual({ placement: 'bottom', fillsHeight: false });
    expect(sheetFrame(win('Duo folded'), page)).toEqual({ placement: 'bottom', fillsHeight: true });
  });

  it('takes the leading half on the Duo landscape: 425 pt of 868 lying flat, ending at the hinge in the book pose', () => {
    expect(leadingHalfWidth(win('Duo open, sideways'))).toBe(425);
    expect(sheetFrame(win('Duo open, sideways'), form)).toEqual({ placement: 'leading', width: 425, height: 653, fillsHeight: true });
    expect(sheetFrame(withPose(win('Duo open, sideways'), 'book'), page)).toMatchObject({ placement: 'leading', width: 447, height: 653, fillsHeight: true });
  });

  it('centres the 580 x 660 form sheet or the page sheet on iPad by presentation.width', () => {
    for (const name of ['iPad upright', 'iPad sideways'])
      expect(sheetFrame(win(name), form), name).toEqual({ placement: 'center', width: FORM_SHEET.width, maxHeight: FORM_SHEET.height, fillsHeight: false });
    expect(sheetFrame(win('iPad sideways'), page)).toEqual({ placement: 'center', width: PAGE_SHEET_WIDTH, fillsHeight: false });
  });

  it('rises from the bottom on the Duo opened flat upright, full width until R1 measures it, form or page', () => {
    expect(DUO_PORTRAIT_SHEET_WIDTH).toBeUndefined();
    for (const presentation of [form, page]) expect(sheetFrame(win('Duo open, upright'), presentation)).toEqual({ placement: 'bottom', width: undefined, fillsHeight: false });
  });

  it('keeps the centred frames when the Duo is partly folded upright: no measurement yet (R1)', () => {
    const hinged = withPose(win('Duo open, upright'), 'book');
    expect(sheetFrame(hinged, form)).toEqual({ placement: 'center', width: FORM_SHEET.width, maxHeight: FORM_SHEET.height, fillsHeight: false });
    expect(sheetFrame(hinged, page).width).toBe(669);
  });

  it('covers the window for a full-screen sheet, whatever the window', () => {
    for (const item of previewWindows) expect(sheetFrame(item, { width: 'form', fullScreen: true }).placement).toBe('cover');
  });

  it('scales the presenter back in compact width only', () => {
    expect(previewWindows.filter(scalesBackBehindSheet).map(item => item.name)).toEqual(['iPhone', 'Duo folded']);
  });
});
