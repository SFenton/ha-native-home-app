import { describe, expect, it } from 'vitest';
import { phoneStatus } from '../src/workspace2/phone/PhoneBars';
import type { Workspace2 } from '../src/workspace2/useWorkspace2';

const ws = (problemCount: number, status: Workspace2['status']) => ({ problemCount, status }) as unknown as Workspace2;

describe('phoneStatus', () => {
  it('drops the "Draft · " prefix so the page name keeps its room', () => {
    expect(phoneStatus(ws(0, { text: 'Draft · Saved', tone: 'neutral' }))).toEqual({ text: 'Saved', tone: 'neutral', report: undefined });
  });
  it('counts problems, in the singular and the plural, as an error that More reports', () => {
    expect(phoneStatus(ws(1, { text: 'Draft · Saved', tone: 'neutral' }))).toEqual({ text: '1 Problem', tone: 'error', report: '1 Problem' });
    expect(phoneStatus(ws(2, { text: 'Draft · Saved', tone: 'neutral' }))).toEqual({ text: '2 Problems', tone: 'error', report: '2 Problems' });
  });
  it('lets a failed save outrank the problem count', () => {
    expect(phoneStatus(ws(2, { text: 'Not Saved', tone: 'error' }))).toEqual({ text: 'Not Saved', tone: 'error', report: 'Not Saved' });
  });
  it('keeps a warning or success tone and reports nothing', () => {
    expect(phoneStatus(ws(0, { text: 'Published · 4', tone: 'success' })).report).toBeUndefined();
    expect(phoneStatus(ws(0, { text: 'Not Published', tone: 'warning' })).tone).toBe('warning');
  });
});
