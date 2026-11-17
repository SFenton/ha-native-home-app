import { ChevronsUpDown } from 'lucide-react';
import { Switch, UseButton, lightColor, unavailableText, useDevice, useEntity, usePreviewValue, useSimulate } from './device-shared';
import { BrightnessTile } from './light-tile';
import { PullDownMenu } from './PullDownMenu';
import { Glyph, type NodeOf } from './shared';

const warm = 'rgb(255 214 170)';

/** `custom-light-control`: the Custom Lights page and light sheet, one control per node. */
export function CustomLightControlNode({ node }: { node: NodeOf<'custom-light-control'> }) {
  const { props } = node;
  const device = useDevice(props.sourceId);
  const light = useEntity('entityId' in props ? props.entityId : undefined);
  const source = useEntity(props.kind === 'copy-color' ? props.copySourceId : undefined);
  const send = useSimulate();
  const [picked, setPicked] = usePreviewValue<string | undefined>(undefined);
  const off = !light || light.state !== 'on', dead = !light || light.state === 'unavailable';

  switch (props.kind) {
    case 'manual': return <div className="sh-row sh-dv-row"><span className="sh-row-glyph"><Glyph symbol={{ name: 'lightbulb.led' }} size={20}/></span>
      <span className="sh-row-primary">{node.title}</span><Switch on={device.flag('manualOn')} label={node.title} disabled={device.phase !== 'ready'} onChange={next => send(device.text('manualEntityId'), next ? 'turn_on' : 'turn_off')}/></div>;
    case 'mode': {
      const modes = device.get<string[]>('modes') ?? [], swatch = device.get<string[]>('swatch');
      const current = picked ?? device.text('mode') ?? device.text('customMode');
      return <div className="sh-row sh-dv-row"><span className="sh-row-glyph"><Glyph symbol={{ name: 'paintpalette' }} size={20}/></span>
        <span className="sh-row-primary">{node.title}</span>
        <span className="sh-dv-swatch" style={{ background: swatch?.length ? `linear-gradient(90deg, ${swatch.join(', ')})` : 'linear-gradient(90deg, #f33, #fc3, #3c6, #39f, #c3f)' }} aria-hidden="true"/>
        <PullDownMenu title={node.title} className="sh-dv-pulldown" disabled={modes.length === 0} selected={current} options={modes.map(mode => ({ value: mode, label: mode }))} onSelect={setPicked}>
          <span className="sh-row-value sh-dv-accent-text" data-state={current ? undefined : 'unavailable'}>{current ?? unavailableText}</span><ChevronsUpDown size={14} aria-hidden="true"/></PullDownMenu></div>;
    }
    case 'brightness': return <BrightnessTile title={node.title} entity={light} open={props.action} words={props.words}/>;
    case 'color': return <div className="sh-row sh-dv-row"><span className="sh-row-glyph"><Glyph symbol={{ name: 'paintpalette' }} size={20}/></span><span className="sh-row-primary">{node.title}</span>
      <span className="sh-dv-well" style={{ background: lightColor(light) ?? 'conic-gradient(#f33, #fc3, #3c6, #39f, #c3f, #f33)' }} aria-label="Colour"/></div>;
    case 'reset': case 'reset-all': case 'apply-all': {
      const symbol = props.kind === 'apply-all' ? 'lightbulb.2' : 'arrow.counterclockwise';
      return <UseButton className="sh-row sh-dv-row sh-pressable" onPress={() => undefined}><span className="sh-row-glyph"><Glyph symbol={{ name: symbol }} size={20}/></span>
        <span className="sh-row-primary sh-dv-accent-text">{node.title}</span></UseButton>;
    }
    case 'copy-color': {
      const color = lightColor(source), sourceOff = !source || source.state !== 'on';
      return <UseButton className="sh-dv-copy" onPress={() => undefined} label={`Copy colour from ${node.title}`}><span className="sh-dv-dot" data-off={sourceOff ? '' : undefined} style={sourceOff ? undefined : { background: color ?? warm }}/>
        <span>{node.title}</span>{sourceOff && <small>{source ? 'Off' : unavailableText}</small>}</UseButton>;
    }
  }
}
