import { useContext, useState } from 'react';
import { previewTile, previewWidths } from '../../shared/composition/state-style-preview';
import type { StateOverride, StateStyleDefinition } from '../../shared/composition/state-styles';
import { GlyphByName } from '../../preview2/nodes/shared';
import { PreviewInkContext } from '../../preview2/ink';
import { SegmentRow } from '../SegmentRow';
import { StateMenu } from './StateMenu';
import { hasTap, styleStates } from './words';

/** The width of the picture the inspector has to spare, in px. */
const ROOM = 280;

/**
 * A style drawn as the app draws a tile: its glyph, words, arc or disc, face and dimming come from `previewTile`, with its own
 * "Show state" menu and a width of iPhone, iPhone Duo or iPad. The VoiceOver line says what a screen reader reads.
 */
export function StylePreview({ style, title, overrides = [], icon = 'circle' }: { style: StateStyleDefinition; title: string; overrides?: StateOverride[]; icon?: string }) {
  const ink = useContext(PreviewInkContext);
  const entries = styleStates(style);
  const [shown, setShown] = useState<{ state: string; phase?: 'sending' | 'failed' }>({ state: entries[0]?.state ?? 'unavailable' });
  const [device, setDevice] = useState<typeof previewWidths[number]['id']>('iphone');
  const width = previewWidths.find(item => item.id === device)!.width;
  // A tile is half the screen less the page's margins: the same proportion at every width, drawn at the inspector's width.
  const tile = Math.round((width - 48) / 2), scale = Math.min(1, ROOM / tile);
  const look = previewTile(style, shown.state, overrides, { inFlight: shown.phase === 'sending', failed: shown.phase === 'failed' }, icon);
  return <section className="w2-style-preview" aria-label="Preview">
    <div className="w2-row"><div className="field"><span>Show state</span><StateMenu entries={entries} value={shown} afterTap={hasTap(style)} onPick={setShown}/></div></div>
    <SegmentRow label="Device" value={device} choices={previewWidths.map(item => ({ value: item.id, label: item.label }))} onPick={setDevice}/>
    <div className="w2-style-stage" style={{ height: 112 * scale }}>
      <div className="sh-preview2 w2-style-frame" style={{ width: tile, transform: `scale(${scale})` }} data-device={device} data-ink={ink}>
        <div className={`sh-tile ${look.colour.active ? 'sh-lit' : ''} sh-state-tile sh-class-${look.colour.class} sh-effect-${look.indicator}`} data-testid="style-tile">
          <span className="sh-tile-glyph"><GlyphByName name={look.icon} size={24}/></span>
          <span className="sh-tile-title">{title}</span><span className="sh-tile-line">{look.text}</span>
          {look.showsArc && <span className="sh-state-arc" aria-hidden="true"/>}
        </div>
      </div>
    </div>
    <p className="w2-caption" data-testid="style-voiceover">VoiceOver: “{title}, {look.voiceOver}”</p>
  </section>;
}
