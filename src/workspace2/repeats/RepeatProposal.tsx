import { useId, useMemo, useState } from 'react';
import type { RepeatAnalysis } from '../../shared/composition/repeats';
import { REPEAT_LIMITS } from '../../shared/composition/repeats';
import { labelValid, PARAM_LABEL_MAX } from '../params';
import { nameTaken, nameValid } from '../linked';
import type { Workspace2 } from '../useWorkspace2';
import { WORKING_TEXT } from './RepeatsList';
import { footText, groupLabels, groupText, limitText, placeKindText, placesTitle, suggestTemplateName } from './repeatWords';
import { saveRepeat } from './saveRepeat';
import './repeats.css';

/** The place rows shown before "Show N More". */
const FIRST_PLACES = 3;

/**
 * The proposal for one repeated piece (templates spec 5): the name, "Each place sets" (one checked row for each group of fields that differ, with an
 * editable label, its kind, how many values differ and how many fields it fills), the places, and the foot with Save as Template. It is the
 * inspector's body on a wide window and a page pushed in the phone sheet. Unchecking a row never changes what a place draws: the places that differ
 * there are left out, and the foot says so. In Use the proposal shows and Save as Template waits for Edit.
 */
export default function RepeatProposal({ ws, onError, onSaved }: { ws: Workspace2; onError: (message: string) => void; /** After a save, for the phone sheet to pop the page. */ onSaved?: () => void }) {
  const repeats = ws.repeats;
  const { analysis, plan, selected } = repeats;
  if (!selected || !ws.document) return null;
  if (!analysis || !plan) return <p className="w2-empty" role="status">{WORKING_TEXT}</p>;
  return <Body key={selected.id} ws={ws} analysis={analysis} onError={onError} onSaved={onSaved}/>;
}

function Body({ ws, analysis, onError, onSaved }: { ws: Workspace2; analysis: RepeatAnalysis; onError: (message: string) => void; onSaved?: () => void }) {
  const repeats = ws.repeats, plan = repeats.plan!, document = ws.document!;
  const defaults = useMemo(() => groupLabels(analysis), [analysis]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [name, setName] = useState(() => suggestTemplateName(document, analysis.cls));
  const [more, setMore] = useState(false);
  const nameId = useId(), nameError = useId(), footId = useId(), reasonId = useId();
  const labelOf = (id: string) => labels[id] ?? defaults.get(id) ?? '';
  const labelMap = useMemo(() => new Map(analysis.groups.map(group => [group.id, (labels[group.id] ?? defaults.get(group.id) ?? '').trim()])), [analysis, labels, defaults]);
  const shownLabels = useMemo(() => new Map(analysis.groups.map(group => [group.id, labelOf(group.id) || defaults.get(group.id) || ''])), [analysis, labels, defaults]); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = ws.mode === 'edit';
  const taken = nameValid(name) && nameTaken(document, name);
  const checkedCount = plan.checked.length, fields = plan.checked.reduce((total, group) => total + group.fields.length, 0);
  const badLabel = plan.checked.find(group => !labelValid(labelOf(group.id)));
  const reason = !edit ? 'Switch to Edit to save a template.'
    : plan.kept.length < 2 ? 'Fewer than 2 places are left. Check a row to bring places back.'
    : !nameValid(name) ? 'Name the template in 1 to 80 characters.' : taken ? `A template named ${name.trim()} already exists.`
    : badLabel ? `Name each setting in 1 to ${PARAM_LABEL_MAX} characters.` : undefined;
  const places = plan.kept.map(at => ({ at, place: analysis.cls.places[at] }));
  const shownPlaces = more ? places : places.slice(0, FIRST_PLACES + (places.length === FIRST_PLACES + 1 ? 1 : 0));
  const save = () => {
    if (reason) return;
    try {
      const saved = saveRepeat(document, analysis, plan, name, labelMap);
      ws.studio.apply(saved.document);
      repeats.setNote(saved.message);
      ws.linked.say(saved.message);
      repeats.pick(undefined);
      onSaved?.();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="w2-repeat-proposal" data-testid="repeat-proposal">
    <div className="w2-repeat-name">
      <label htmlFor={nameId}>Name</label>
      <input id={nameId} value={name} maxLength={80} aria-invalid={taken || !nameValid(name) || undefined} aria-describedby={taken ? nameError : undefined} onChange={event => setName(event.target.value)}/>
      {taken && <p id={nameError} role="alert" className="w2-field-error">{`A template named ${name.trim()} already exists.`}</p>}
    </div>
    <section aria-labelledby={`${nameId}-sets`}>
      <h3 className="w2-group-title" id={`${nameId}-sets`}>Each place sets</h3>
      {analysis.groups.length === 0
        ? <p className="w2-caption">These places are the same, so the template has no settings.</p>
        : <ul className="w2-repeat-rows">
          {analysis.groups.map(group => {
            const on = !repeats.unchecked.has(group.id);
            const blocked = !on && (checkedCount >= REPEAT_LIMITS.params || fields + group.fields.length > REPEAT_LIMITS.bindings);
            const second = `${nameId}-${group.id}`;
            return <li key={group.id} className="w2-repeat-row-item" data-group={group.id}>
              <input type="checkbox" checked={on} aria-label={labelOf(group.id) || defaults.get(group.id)} aria-describedby={second} aria-disabled={blocked || undefined}
                onChange={event => { if (!blocked) repeats.setChecked(group.id, event.target.checked); }}/>
              <div className="w2-repeat-row-text">
                <input className="w2-repeat-label" value={labelOf(group.id)} maxLength={PARAM_LABEL_MAX} aria-label={`Label for ${defaults.get(group.id)}`} aria-invalid={!labelValid(labelOf(group.id)) || undefined} disabled={!on}
                  onChange={event => setLabels(held => ({ ...held, [group.id]: event.target.value }))}/>
                <span id={second} className="w2-caption">{groupText(group)}</span>
              </div>
            </li>;
          })}
        </ul>}
      {analysis.groups.length > REPEAT_LIMITS.params && <p className="w2-caption">{limitText}</p>}
    </section>
    <section aria-labelledby={`${nameId}-places`}>
      <h3 className="w2-group-title" id={`${nameId}-places`}>{placesTitle(plan.kept.length, analysis.cls.places.length)}</h3>
      <ul className="w2-repeat-places" aria-label="Places">
        {shownPlaces.map(({ place }) => {
          const here = place.nodeId === repeats.place?.nodeId;
          return <li key={place.nodeId}><button type="button" className="w2-link-row w2-repeat-place" aria-current={here ? 'true' : undefined} onClick={() => repeats.setPlace(place.nodeId)}>
            <span className="w2-style-text"><span className="w2-page-title">{place.surface.title}</span><span className="w2-page-via">{placeKindText(place)}</span></span>
            {here && <span className="w2-repeat-shown">Shown</span>}
          </button></li>;
        })}
      </ul>
      {shownPlaces.length < places.length && <button type="button" className="w2-repeat-more" onClick={() => setMore(true)}>{`Show ${places.length - shownPlaces.length} More`}</button>}
    </section>
    <footer className="w2-repeat-foot">
      <p id={footId} aria-live="polite" data-testid="repeat-foot">{footText(plan, analysis.cls.places.length, shownLabels)}</p>
      <button type="button" className="w2-primary" aria-disabled={reason ? true : undefined} aria-describedby={reason ? reasonId : undefined} onClick={save}>Save as Template</button>
      {reason && <p id={reasonId} className="w2-caption">{reason}</p>}
    </footer>
  </div>;
}
