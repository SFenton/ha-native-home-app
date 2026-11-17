import { useState } from 'react';
import { Plus, Bot } from 'lucide-react';
import type { CompositionDocument } from '../../shared/composition/schema';
import RobotForm from '../data/RobotForm';
import { newRobotSource } from '../data/robot';
import { makeMap, robotsOf, type Made } from './catalog';

/**
 * "Map of": the robots the document has, then Set Up a Robot…, which asks for one and adds it to the document's data with the map in the same undo step.
 * (The Data panel's own robot form is this same form; it is reached from there too.)
 */
export default function RobotAsk({ document, title, onClose, onBack, onChoose }: { document: CompositionDocument; title: string; onClose: () => void; onBack: () => void; onChoose: (made: Made, sources: Made['sources']) => void }) {
  const [setting, setSetting] = useState(false);
  const robots = robotsOf(document);
  return <div className="w2-add" data-testid="add-picker">
    <header className="w2-add-head"><h2>Add to {title}</h2><button type="button" onClick={onClose}>Cancel</button></header>
    <h3 className="w2-add-question">Map of</h3>
    {!setting && <>
      <div className="w2-add-choices" role="list" aria-label="Robots">
        {robots.map(robot => <button key={robot.sourceId} type="button" role="listitem" className="w2-add-tile w2-add-choice" data-robot={robot.sourceId}
          onClick={() => onChoose(makeMap(robot.sourceId, robot.title), [])}><span className="w2-add-choice-name"><Bot size={16} aria-hidden/> {robot.title}</span><span className="w2-add-choice-detail">{robot.entityId}</span></button>)}
        {robots.length === 0 && <p className="w2-caption">This project has no robot yet.</p>}
      </div>
      <button type="button" className="w2-add-tile" onClick={() => setSetting(true)}><Plus size={16} aria-hidden/> Set Up a Robot…</button>
      <button type="button" className="w2-add-back" onClick={onBack}>Back</button>
    </>}
    {setting && <RobotForm onCancel={() => setSetting(false)} onCreate={parts => { const source = newRobotSource(document, parts); onChoose(makeMap(source.id, parts.title), [source]); }}/>}
  </div>;
}
