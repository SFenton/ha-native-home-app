import type { CanvasObservations as SimulationObservations } from '../logic-simulation/observations';
import type { CanvasObservations, BlockObservation, PortObservation } from '../canvas/observations';

export function canvasPortObservations(observations: SimulationObservations): CanvasObservations {
  const blocks: Record<string, BlockObservation> = {};
  for (const [id, block] of Object.entries(observations.blocks)) {
    const inputs: Record<string, PortObservation> = {}, outputs: Record<string, PortObservation> = {};
    for (const port of block.ports) {
      // The canvas DTO cannot represent Mixed or unobserved values. Never mislabel these as Live.
      if (!port.observed || port.source === 'mixed' || port.state === 'not-observed') continue;
      const source = port.source;
      const state = port.state === 'loading' ? 'cant-tell' : port.state;
      const kept = port.direction === 'output' && port.kept === true;
      const value: PortObservation = state === 'known' && port.value !== undefined ? { source, state, value: port.result?.kind === 'condition' ? port.value === 'yes' : port.value, ...(kept ? { kept } : {}) }
        : kept && port.value !== undefined ? { source, state: state === 'unavailable' ? state : 'cant-tell', value: port.value, kept: true }
          : { source, state: state === 'unavailable' ? state : 'cant-tell' };
      (port.direction === 'input' ? inputs : outputs)[port.portId] = value;
    }
    blocks[id] = { inputs, outputs, ...(block.pinned && block.source === 'scenario' ? { scenarioPinned: true } : {}) };
  }
  return blocks;
}
