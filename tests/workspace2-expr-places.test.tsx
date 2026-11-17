// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDocumentIndex } from '../src/preview2/model';
import { resetAdvancedFold } from '../src/workspace2/AdvancedFold';
import PropertiesPanel from '../src/workspace2/PropertiesPanel';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { Project } from './support/workspace2-surfaces';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
beforeEach(resetAdvancedFold);
const home = homeDomains.document as unknown as CompositionDocument;
const entries = (document: CompositionDocument, type: string) => [...buildDocumentIndex(document).entries.values()].filter(entry => entry.node?.type === type);
const panel = (document: CompositionDocument, entry: ReturnType<typeof entries>[number]) => render(
  <PropertiesPanel ws={Project.workspace(document, { kind: 'node', key: entry.key, path: entry.path })} onClose={() => {}} onOpenProject={() => {}} onError={() => {}}/>);

describe('where the condition and value fields are wired', () => {
  it('a row has Only show when and Only enabled when, both Always until set', () => {
    panel(home, entries(home, 'row')[0]);
    expect(screen.getByRole('button', { name: 'Only show when: Always.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Only enabled when: Always.' })).toBeTruthy();
  });

  it('opening Only enabled when offers Enabled, Disabled and Keep Last, not Show and Hide', () => {
    panel(home, entries(home, 'row')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Only enabled when: Always.' }));
    expect(screen.getByRole('radiogroup', { name: 'Condition view' })).toBeTruthy();
  });

  it('a node with no enabledWhen in the contract does not draw the row', () => {
    panel(home, entries(home, 'status-chip')[0]);
    expect(screen.queryByRole('button', { name: /^Only enabled when/ })).toBeNull();
  });
});

describe('a tab container', () => {
  it('has Opens on and If that tab is hidden in its main group', () => {
    panel(home, entries(home, 'local-tabs')[0]);
    expect(screen.getByRole('button', { name: /^Opens on/ })).toBeTruthy();
    expect(screen.getByText('If that tab is hidden')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'If that tab is hidden' })).toBeTruthy();
  });

  it('Opens on starts empty, adds a rule that opens a page and blocks Done until it has a condition', () => {
    panel(home, entries(home, 'local-tabs')[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Opens on/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Rule' }));
    expect(screen.getByRole('heading', { name: 'Rule 1' })).toBeTruthy();
  });
});

describe('badges', () => {
  it('a status chip has a Badge row that says None until one is set', () => {
    panel(home, entries(home, 'status-chip')[0]);
    expect(screen.getByRole('button', { name: /^Badge/ }).textContent).toContain('None');
  });
});

describe('actions chosen by rule', () => {
  it('a row that runs an action offers One Action and By Rule on its page, and By Rule keeps the action as Rule 1', () => {
    panel(home, entries(home, 'row')[0]);
    fireEvent.click(screen.getByRole('button', { name: /^When tapped/ }));
    // An action first; then it can be chosen by rule.
    expect(screen.queryByRole('radiogroup', { name: 'Action by' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('radiogroup', { name: 'Action by' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'By Rule' }));
    expect(screen.getByTestId('action-rules')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Rule 1 of 1: if no condition yet, then Back\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Otherwise: then Do Nothing\./ })).toBeTruthy();
  });
});
