// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CompositionFields from '../src/CompositionFields';
import { compositionEditorSchema } from '../src/composition-editor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { CompositionValidationError } from '../src/shared/composition/json';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import type { CompositionDocument } from '../src/shared/composition/schema';

const policy: NonNullable<CompositionDocument['bootstrap']> = {
  type: 'native-bootstrap@1', arrivalAnnouncement: 'Your sample home is ready.',
  recovery: { loadingTitle: 'Getting the sample layout', unavailableTitle: 'Sample layout unavailable',
    unavailableMessage: 'Try again when the sample publisher is available.', retryLabel: 'Retry Layout' },
  setup: [
    { permission: 'notifications', explanation: 'Choose sample home alerts.' },
    { permission: 'time-sensitive', explanation: 'Review urgent sample alerts.' },
    { permission: 'location', explanation: 'Choose sample location sharing.' },
  ],
};
afterEach(cleanup);
describe('trusted native bootstrap contract', () => {
  it('keeps the first slice unchanged and negotiates only capabilities actually used', () => {
    const document = createCompositionDocument('sample');
    const baseline = compileCompositionDocument(document).capabilities;
    document.bootstrap = policy;
    expect(compileCompositionDocument(document).capabilities).toEqual([...baseline, 'sh.bootstrap-policy@1'].sort());
    document.pages[0].components.push(
      { id: 'sample-empty', title: 'No Sample Account', type: 'bootstrap-message', layout: { span: 1 },
        icon: document.pages[0].icon, props: { message: 'Sign in to see sample content.' } },
      { id: 'sample-permission', title: 'Sample Alerts', type: 'notification-permission-banner', layout: { span: 1 },
        props: { message: 'Choose alerts on this device.', enableLabel: 'Turn On', dismissLabel: 'Not Now' } },
    );
    expect(compileCompositionDocument(document).capabilities).toEqual([
      ...baseline, 'sh.bootstrap-message@1', 'sh.bootstrap-notifications@1', 'sh.bootstrap-policy@1',
    ].sort());
  });

  it('rejects duplicate/missing permissions, dependency violations and authored auth or consent bypasses', () => {
    const document = { ...createCompositionDocument('sample'), bootstrap: structuredClone(policy) };
    document.bootstrap.setup.reverse();
    expect(() => compileCompositionDocument(document)).toThrow(CompositionValidationError);
    document.bootstrap = structuredClone(policy);
    document.bootstrap.setup[2].permission = 'notifications';
    try { compileCompositionDocument(document); throw new Error('Expected invalid permission order'); }
    catch (error) {
      expect(error).toBeInstanceOf(CompositionValidationError);
      expect((error as CompositionValidationError).issues).toContainEqual({
        code: 'invalid_combination', pointer: '/document/bootstrap/setup',
      });
    }
    for (const field of ['endpoint', 'credential', 'oauthClient', 'skipConfirmation'])
      expect(() => compileCompositionDocument({ ...document, bootstrap: { ...policy, [field]: 'synthetic' } })).toThrow();
  });

  it('authors copy and permission order through generated fields, not raw JSON', () => {
    const document = { ...createCompositionDocument('sample'), bootstrap: structuredClone(policy) };
    let updated: CompositionDocument | undefined;
    render(<CompositionFields schema={compositionEditorSchema.properties!.bootstrap} value={document.bootstrap}
      path={['bootstrap']} label="Bootstrap policy" document={document} onChange={value => { updated = value; }}
      onError={message => { throw new Error(message); }}/>);
    fireEvent.change(screen.getByLabelText('Arrival Announcement'), { target: { value: 'Sample welcome' } });
    expect(updated?.bootstrap?.arrivalAnnouncement).toBe('Sample welcome');
    const setup = screen.getByRole('group', { name: 'Setup (3)' });
    const selectors = within(setup).getAllByLabelText('Permission');
    expect(selectors).toHaveLength(3);
    expect(selectors.every(item => item.tagName === 'SELECT')).toBe(true);
    expect(within(setup).getAllByRole('button', { name: /Move .* down/ })).toHaveLength(3);
    expect(screen.queryByLabelText('Credential')).toBeNull();
  });
});
