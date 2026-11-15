// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RoutesEditor from '../src/RoutesEditor';
import { compileCompositionDocument } from '../src/shared/composition/compiler';
import { createCompositionDocument } from '../src/shared/composition/workspace';
import type { CompositionDocument } from '../src/shared/composition/schema';

afterEach(cleanup);

function mount() {
  const base = createCompositionDocument('routes-ui');
  let current: CompositionDocument = {
    ...base, extensions: {
      type: 'native-extensions@1', watch: 'stub@1', cameras: [],
      routes: [
        { id: 'home', path: 'home', pageId: base.pages[0].id, title: 'Home', summary: 'Your house', icon: 'house.fill' },
        { id: 'settings', path: 'settings', pageId: base.pages[0].id, title: 'Settings', summary: 'Setup', icon: 'gear' },
      ],
    },
  };
  const view = () => <RoutesEditor document={current} onChange={next => { current = next; rendered.rerender(view()); }}/>;
  const rendered = render(view());
  return () => current;
}

describe('Routes editor', () => {
  it('seeds the legacy aliases and link prefixes, and the result compiles with route-links', () => {
    const current = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Import legacy aliases' }));
    expect(current().extensions!.routes[0].aliases).toEqual(['overview']);
    expect(current().extensions!.routes[1].aliases).toContain('vacation-mode');
    expect(current().extensions!.linkPrefixes).toContain('at-a-glance');
    expect(screen.getByRole('status').textContent).toMatch(/^Added /);
    expect(compileCompositionDocument(current()).capabilities).toContain('sh.route-links@1');
  });
  it('edits aliases, keywords and the Siri flag per route', () => {
    const current = mount();
    const [aliases] = screen.getAllByLabelText('Aliases');
    fireEvent.change(aliases, { target: { value: 'start, house' } });
    fireEvent.change(screen.getAllByLabelText('Keywords')[0], { target: { value: 'lights' } });
    fireEvent.click(screen.getAllByLabelText('Suggest in Siri and Shortcuts')[0]);
    expect(current().extensions!.routes[0]).toMatchObject({ aliases: ['start', 'house'], keywords: ['lights'], siri: true });
    expect(current().extensions!.routes[1]).not.toHaveProperty('aliases');
  });
});
