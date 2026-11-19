// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SelectMenu } from '../../../src/workspace2/SelectMenu';

afterEach(cleanup);
const props = { label: 'Choose value', value: 'live', options: [{ value: 'live', label: 'Live' }, { value: 'pinned', label: 'Pinned' }], onChange: vi.fn() };

function normalized(element: Element) {
  const ids = new Map([...document.querySelectorAll('[id]')].map((node, index) => [node.id, `menu-id-${index}`]));
  const copy = element.cloneNode(true) as Element;
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const attribute of node.attributes) {
      node.setAttribute(attribute.name, attribute.value.split(' ').map(value => ids.get(value) ?? value).join(' '));
    }
  }
  return copy.outerHTML;
}

it('preserves the pre-grant field and portalled popup DOM when popupClassName is omitted', async () => {
  const { container } = render(<SelectMenu {...props} />);
  fireEvent.click(screen.getByRole('combobox', { name: props.label }));
  const popup = (await screen.findByRole('listbox')).closest('.w2-select-pop')!;
  expect(popup.className).toBe('w2-scope w2-menu w2-select-pop');
  expect({ field: normalized(container), popup: normalized(popup) }).toMatchSnapshot();
});

it('adds only the requested popup class and leaves the trigger and popup contents unchanged', async () => {
  const { container, rerender } = render(<SelectMenu {...props} />);
  fireEvent.click(screen.getByRole('combobox', { name: props.label }));
  const popup = (await screen.findByRole('listbox')).closest('.w2-select-pop')!;
  const before = { field: normalized(container), popup: normalized(popup) };
  rerender(<SelectMenu {...props} popupClassName="w2-simulation-surface" />);
  expect(popup.className).toBe('w2-scope w2-menu w2-select-pop w2-simulation-surface');
  const withoutClass = popup.cloneNode(true) as Element;
  withoutClass.classList.remove('w2-simulation-surface');
  expect({ field: normalized(container), popup: normalized(withoutClass) }).toEqual(before);
  rerender(<SelectMenu {...props} />);
  expect({ field: normalized(container), popup: normalized(popup) }).toEqual(before);
});
