import { describe, expect, it } from 'vitest';
import homeDomains from '../src/preview2/fixtures/home-domains.json';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { setFoldSide } from '../src/workspace2/layout/fold-sides-edit';
import { deleteComponent, saveAsComponent, unlinkPlace } from '../src/workspace2/linked';

const home = homeDomains.document as unknown as CompositionDocument;
const homeIndex = home.pages.findIndex(page => page.id === 'page-home');
const path = ['pages', homeIndex, 'components', 1];
const pinned = setFoldSide(home, path, 'trailing');
const at = (document: CompositionDocument) => document.pages[homeIndex].components[1] as { id: string; type: string; layout: { span?: number; foldSide?: string } };

describe('a fold side and a saved template (sh.fold-sides@1)', () => {
  it('keeps the side on the place on the page, none on the template root, and the document still compiles', () => {
    const saved = saveAsComponent(pinned, path, 'Side Template');
    expect(at(saved.document).type).toBe('component-ref');
    expect(at(saved.document).layout.foldSide).toBe('trailing');
    expect((saved.document.componentLibrary![0].node.layout as { foldSide?: string }).foldSide).toBeUndefined();
    expect(() => compileCompositionDocument(saved.document)).not.toThrow();
  });
  it('writes no side on the place when the section had none', () => {
    const saved = saveAsComponent(home, path, 'Plain Template');
    expect('foldSide' in at(saved.document).layout).toBe(false);
  });
  it('puts the side back on the page node when the place is unlinked', () => {
    const saved = saveAsComponent(pinned, path, 'Side Template');
    const unlinked = unlinkPlace(saved.document, path);
    expect(at(unlinked).type).not.toBe('component-ref');
    expect(at(unlinked).layout.foldSide).toBe('trailing');
    expect(() => compileCompositionDocument(unlinked)).not.toThrow();
  });
  it('puts the side back on the page node when the template is deleted', () => {
    const saved = saveAsComponent(pinned, path, 'Side Template');
    const deleted = deleteComponent(saved.document, saved.entryId);
    expect(at(deleted).layout.foldSide).toBe('trailing');
    expect(() => compileCompositionDocument(deleted)).not.toThrow();
  });
});
