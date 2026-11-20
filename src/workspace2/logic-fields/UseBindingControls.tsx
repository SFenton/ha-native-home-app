import { useState } from 'react';
import type { EditorPath } from '../../composition-editor';
import type { CompositionDocument } from '../../shared/composition/schema';
import { bindLogicUse, tileSourceFields, unbindLogicUse } from '../../shared/composition/studio-logic/bindings';
import { resolveLogicAnchor } from '../../shared/composition/studio-logic/anchors';
import { logicUseBindingsSchema } from '../../shared/composition/studio-logic/schemas';
import { useDraftDocument, type Draft } from '../editors/draft';
import { fieldAnchor, fieldPointer } from './registry';
import { SelectMenu } from '../SelectMenu';
import { editSubtrees } from '../editors/provenance';

export function UseBindingControls({ draft, path, argument }: { draft: Draft; path: EditorPath; argument: string }) {
  const document = useDraftDocument(draft), [error, setError] = useState('');
  const anchor = fieldAnchor(document, path), resolved = resolveLogicAnchor(document, anchor);
  const node = resolved?.node?.value;
  const fields = Object.entries(tileSourceFields).find(([kind]) => kind === node?.type)?.[1] ?? [];
  if (!fields.length) return null;
  const bindings = logicUseBindingsSchema.parse(document.logicUseBindings ?? []);
  const index = bindings.findIndex(binding => binding.argument === argument && resolveLogicAnchor(document, binding.use)?.pointer === fieldPointer(path));
  return <div className="w2-picker-row" data-stacked>
    <span className="w2-row-label">Fill from</span>
    <SelectMenu label={`Fill ${argument} from`} value={index < 0 ? 'explicit' : bindings[index].from.field}
      options={[{ value: 'explicit', label: 'This use sets it' }, ...fields.map(field => ({ value: field, label: `This tile: ${field.split('/').at(-1)?.replace(/([a-z])([A-Z])/g, '$1 $2')}` }))]}
      onChange={field => {
        try {
          const base = index < 0 ? document : unbindLogicUse(document, index);
          const next = (field === 'explicit' ? base : bindLogicUse(base, { use: anchor, argument, from: { kind: 'use-tile', field } })) as CompositionDocument;
          draft.set(editSubtrees(document, next, { deleted: [path] }));
          setError('');
        } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      }}/>
    {index >= 0 && <p className="w2-caption">This tile supplies the value independently for this use.</p>}
    {error && <p role="alert" className="w2-error-text">{error}</p>}
  </div>;
}
