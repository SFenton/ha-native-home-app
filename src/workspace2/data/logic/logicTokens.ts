import type { Operand } from '../../../shared/composition/expression';
import { isHole, isUse } from './logicModel';
import type { NameContext } from '../../expr/condition';
import { operandName } from '../../expr/condition';

/** How a use or a setting shows as a token: a use reads "Count or All, logic template, 3 settings"; a setting "Setting, Count". Anything else is undefined. */
export function describeToken(operand: Operand, ctx: NameContext): { role: 'use' | 'setting'; label: string } | undefined {
  const raw: unknown = operand;
  if (isUse(raw)) {
    const count = ctx.logic?.library.find(entry => entry.id === raw.logicId)?.params.length ?? 0;
    return { role: 'use', label: `${operandName(operand, ctx)}, logic template, ${count} ${count === 1 ? 'setting' : 'settings'}` };
  }
  const value = raw as { type?: string; value?: unknown; from?: { sourceId?: unknown } };
  if (isHole(raw) || (value.type === 'literal' && isHole(value.value)) || (value.type === 'read' && isHole(value.from?.sourceId))) return { role: 'setting', label: `Setting, ${operandName(operand, ctx)}` };
  return undefined;
}
