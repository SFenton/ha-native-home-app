import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Json } from '../../../../src/shared/types';
import type { GraphDestination } from '../../../../src/shared/composition/graph';
import { atPointer, copy, record, replaceAt } from '../../../../src/shared/composition/graph/json';

export const textPointer = '/pages/1/components/0/props/value';
export const shortTextPointer = '/pages/1/components/1/props/subtitle';
export const symbolPointer = '/pages/2/components/0/props/states/0/appearance/icon';
export const actionPointer = '/pages/2/components/0/action';
export const symbol = (name = 'lightbulb'): Json => ({ type: 'sf-symbol', name, rendering: 'canonical', unavailable: 'fallback' });

export function corpusDocument(file: string): Json {
  const envelope: { document: Json } = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../contract/corpus', file), 'utf8'));
  return envelope.document;
}

export function nativeContext(kind: 'text' | 'short-text' | 'symbol' | 'action' | 'navigation-action' = 'text'): NonNullable<GraphDestination['context']> {
  let document = corpusDocument(kind === 'action' ? 'accept/grammar-call-service-button.json' : 'accept/fixture-composition-first-slice.json');
  if (!record(document) || !Array.isArray(document.dataSources)) throw new Error('Expected native fixture sources.');
  document.dataSources.push({ id: 'light', kind: 'ha-entity', entityId: { type: 'literal', value: 'light.demo_graph' } });
  if (kind === 'symbol') {
    const rules = corpusDocument('accept/rules-conditional-look.json'), chip = atPointer(rules, '/pages/2/components/0');
    if (!chip) throw new Error('Expected native symbol destination.');
    if (!record(rules) || !Array.isArray(rules.dataSources)) throw new Error('Expected native rule sources.');
    const lights = rules.dataSources.find(source => record(source) && source.id === 'lights');
    if (!lights) throw new Error('Expected status-chip provider.');
    document.dataSources.push(lights);
    let literalChip = replaceAt(copy(chip), '/props/states/0/appearance/icon', symbol());
    for (const field of ['fill', 'glyph']) {
      const rule = atPointer(literalChip, `/props/states/0/appearance/${field}`);
      if (!record(rule) || rule.otherwise === undefined) throw new Error('Expected native look rule.');
      literalChip = replaceAt(literalChip, `/props/states/0/appearance/${field}`, rule.otherwise);
    }
    document = replaceAt(document, '/pages/2/components/0', literalChip);
  }
  return { document, pointer: kind === 'symbol' ? symbolPointer : kind === 'action' ? actionPointer : kind === 'navigation-action' ? '/pages/1/components/1/action' : kind === 'short-text' ? shortTextPointer : textPointer };
}

export function workedDocument(example: Json): Json {
  const context = nativeContext(), document = copy(context.document);
  if (!record(example) || !record(document) || !Array.isArray(document.dataSources)) throw new Error('Expected worked example and native document.');
  document.logicLibrary = example.logicLibrary;
  for (const id of ['living-temperature', 'bedroom-temperature', 'thermostat', 'window', 'light-a', 'light-b', 'light-c', 'light-d', 'light-e']) {
    document.dataSources.push({ id, kind: 'ha-entity', entityId: { type: 'literal', value: `sensor.demo_${id.replace(/-/g, '_')}` } });
  }
  if (Array.isArray(example.dataSources)) document.dataSources.push(...example.dataSources);
  return replaceAt(document, context.pointer, example.subtitle);
}
