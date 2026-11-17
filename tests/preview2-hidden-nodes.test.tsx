// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import type { CompositionDocument } from '../src/shared/composition/schema';
import { demoHouse } from '../src/preview2/demo-house';
import { buildDocumentIndex } from '../src/preview2/model';
import { emptyOverlay } from '../src/preview2/projections';
import Preview2, { previewWindows } from '../src/preview2/Preview2';
import homeDomains from '../src/preview2/fixtures/home-domains.json';

afterEach(cleanup);
const base = homeDomains.document as unknown as CompositionDocument;
/** An older draft: the home page leads with the permission banner the Studio used to offer. */
const withBanner = {
  ...base,
  pages: base.pages.map((page, at) => at !== 0 ? page : { ...page, components: [
    { id: 'demo_alerts_banner', title: 'Get door and camera alerts', layout: { span: 1 }, type: 'notification-permission-banner',
      props: { message: 'Demo message.', enableLabel: 'Turn On', dismissLabel: 'Not Now' } }, ...page.components] }),
} as CompositionDocument;

describe('the alerts banner is the app’s, not the Studio’s', () => {
  it('still validates, compiles and keeps the node in an existing draft', () => {
    const { document, capabilities } = compileCompositionDocument(withBanner);
    expect(document.pages[0].components[0].type).toBe('notification-permission-banner');
    expect(capabilities).toContain('sh.bootstrap-notifications@1');
  });
  it('leaves it out of the selection index, so it has no row, handle or properties', () => {
    const index = buildDocumentIndex(withBanner);
    expect(index.get('node:demo_alerts_banner')).toBeUndefined();
    expect(index.keys.some(key => key.startsWith('node:'))).toBe(true);
  });
  it.each([['edit'], ['use']] as const)('draws nothing for it in %s', mode => {
    const { container } = render(<Preview2 document={withBanner} mode={mode} surface={{ kind: 'page', id: withBanner.pages[0].id }} onSurfaceChange={vi.fn()} onSelect={vi.fn()}
      window={previewWindows[0]} bezel={false} house={demoHouse(withBanner)} overlay={emptyOverlay} onOverlayChange={vi.fn()}/>);
    expect(container.textContent).not.toContain('Get door and camera alerts');
    expect(container.querySelector('[data-sel="node:demo_alerts_banner"]')).toBeNull();
    expect(container.querySelector('.sh-placeholder')?.textContent ?? '').not.toContain('notification-permission-banner');
  });
});
