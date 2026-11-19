import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveHouse } from '../../../src/preview2/live-house';
import { WorkspaceDataProvider } from '../../../src/workspace2/pickers/WorkspaceData';
import { SimulationHost } from '../../../src/workspace2/logic-simulation/SimulationHost';
import { saveScenarios } from '../../../src/workspace2/logic-simulation/storage';
import { FIXTURE_CLOCK, simulationFixture } from './fixture';

const fixture = simulationFixture(), live = new LiveHouse();
live.applySnapshot(fixture.states, fixture.held.base.viewer);
function Harness() {
  const [session, setSession] = useState<'open' | 'closing' | 'closed'>('open'), [key, setKey] = useState(0);
  const [message, setMessage] = useState('');
  useEffect(() => { if (session === 'closing') setSession('closed'); }, [session]);
  return <main style={{ maxWidth: 1100, margin: 'auto', padding: 12, fontFamily: 'system-ui' }}>
    <h1>Isolated fake-HA simulation harness</h1>
    <p>Fixture entities only. No HA connection or device controls.</p>
    <button onClick={() => {
      const saved = saveScenarios(fixture.document.id, 'acceptance', fixture.scenarios);
      setMessage(saved.ok ? 'Fixture scenarios loaded.' : saved.error); setKey(value => value + 1);
    }}>Load fixture scenarios</button>
    <button onClick={() => setSession(session === 'closed' ? 'open' : 'closing')}>{session === 'closed' ? 'Reopen canvas' : 'Close canvas'}</button>
    <p role="status">{message}</p>
    <WorkspaceDataProvider document={fixture.document} house={live.house} live={live}>
      {session !== 'closed' && <SimulationHost key={key} active={session === 'open'} program={fixture.program} document={fixture.document}
        canvasId="acceptance" blockNames={fixture.blockNames} liveClock={FIXTURE_CLOCK} />}
    </WorkspaceDataProvider>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
