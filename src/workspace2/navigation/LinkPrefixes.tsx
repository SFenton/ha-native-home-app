import { useState } from 'react';
import { words } from '../../routes-editor';
import { TextField } from '../../ui';
import { useRows } from '../rows';

/** The first path segments that mark a link as the dashboard's, as words separated by commas. Shown only when the project sets them. */
export function LinkPrefixes() {
  const { document, onChange } = useRows();
  const prefixes = document.extensions?.linkPrefixes;
  const [text, setText] = useState((prefixes ?? []).join(', '));
  if (!prefixes || !document.extensions) return null;
  return <div className="w2-row" data-field-path="extensions/linkPrefixes"><TextField label="Link prefixes" value={text} onChange={next => {
    setText(next);
    const list = words(next);
    if (list.length > 0 && list.length <= 8) onChange({ ...document, extensions: { ...document.extensions!, linkPrefixes: list } });
  }}/></div>;
}
