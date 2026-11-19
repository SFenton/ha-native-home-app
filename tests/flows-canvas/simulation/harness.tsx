import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveHouse } from '../../../src/preview2/live-house';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { SimulationHost } from '../../../src/workspace2/logic-simulation/SimulationHost';
import { saveScenarios } from '../../../src/workspace2/logic-simulation/storage';
import { FIXTURE_CLOCK, simulationFixture } from './fixture';
import { useStudioTheme } from '../../../src/workspace2/useStudioTheme';
import { Tag } from '../../../src/workspace2/kit';
import '../../../src/styles.css';
import '../../../src/workspace2/workspace2.css';

const fixture = simulationFixture(true), live = new LiveHouse();
live.applySnapshot(fixture.states, fixture.held.base.viewer);
function Harness() {
  useStudioTheme(true);
  const [session, setSession] = useState<'open' | 'closed'>('open'), [key, setKey] = useState(0);
  const [message, setMessage] = useState('');
  const [selectedBlockId, setSelectedBlockId] = useState(fixture.bedroomPin.blockId);
  return <div className="w2-scope" style={{ background: 'var(--w2-bg)', minHeight: '100dvh' }}>
    <header className="w2-topbar" style={{ height: 'auto', minHeight: 56, flexWrap: 'wrap', paddingBlock: 10 }}><strong className="w2-wordmark">S+H Studio</strong><Tag>Simulation harness · fake HA</Tag>
    <div className="w2-trailing" style={{ flexWrap: 'wrap' }}>
    <button onClick={() => {
      const saved = saveScenarios(fixture.document.id, 'acceptance', [...fixture.scenarios, fixture.offline]);
      setMessage(saved.ok ? 'Fixture scenarios loaded.' : saved.error); setKey(value => value + 1);
    }}>Load fixture scenarios</button>
    <button onClick={() => setSession(session === 'closed' ? 'open' : 'closed')}>{session === 'closed' ? 'Reopen canvas' : 'Close canvas'}</button>
    </div></header>
    <p role="status" style={{ margin: 0 }}>{message}</p>
    <WorkspaceDataProvider document={fixture.document} house={live.house} live={live}>
      {session !== 'closed' && <SimulationHost key={key} program={fixture.program} document={fixture.document}
        canvasId="acceptance" blockNames={fixture.blockNames} presentation={fixture.presentation} liveClock={FIXTURE_CLOCK} clockTimeZone="UTC"
        selectedBlockId={selectedBlockId} onSelectBlock={setSelectedBlockId} previousText={fixture.held.base.previousText} />}
    </WorkspaceDataProvider>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
