// @vitest-environment node
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeValetudoPng, drawValetudoMap, expandPixels, mapBounds, parseValetudoJson, type MapContext } from '../src/preview2/valetudo-map';

/** A Valetudo map with invented rooms: two segments and a wall, a charger and a robot. */
const mapJson = {
  __class: 'ValetudoMap', size: { x: 6554, y: 6554 }, pixelSize: 5, metaData: { version: 2 },
  layers: [
    { __class: 'MapLayer', type: 'segment', metaData: { segmentId: '3', name: 'Studio', active: false }, compressedPixels: [10, 10, 4, 10, 11, 4] },
    { __class: 'MapLayer', type: 'segment', metaData: { segmentId: '4', name: ' Hall  Way ' }, pixels: [20, 10, 21, 10] },
    { __class: 'MapLayer', type: 'wall', compressedPixels: [9, 9, 3] },
  ],
  entities: [{ type: 'charger_location', points: [60, 60] }, { type: 'robot_position', points: [75, 80], metaData: { angle: 90 } }, { type: 'path', points: [60, 60, 75, 80] }],
};
const chunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(12 + body.length), view = new DataView(out.buffer);
  view.setUint32(0, body.length); out.set(new TextEncoder().encode(type), 4); out.set(body, 8);
  return out;
};
/** A PNG whose `zTXt` chunk carries `json` under `keyword`, the way the vacuum's map camera exports it. */
const png = (json: unknown, keyword = 'ValetudoMap') => {
  const text = new Uint8Array([...new TextEncoder().encode(keyword), 0, 0, ...deflateSync(Buffer.from(JSON.stringify(json)))]);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('zTXt', text), chunk('IEND', new Uint8Array(0))];
  return Uint8Array.from(parts.flatMap(part => [...part]));
};

describe('the Valetudo map decoder', () => {
  it('expands run-length rows to cells', () => { expect(expandPixels([10, 10, 3, 2, 5, 1])).toEqual([10, 10, 11, 10, 12, 10, 2, 5]); });

  it('reads the map out of the zTXt chunk of the camera picture', async () => {
    const map = await decodeValetudoPng(png(mapJson));
    expect(map.pixelSize).toBe(5);
    expect(map.layers.map(layer => [layer.type, layer.segmentId, layer.name, layer.pixels.length / 2])).toEqual([['segment', '3', 'Studio', 8], ['segment', '4', 'Hall  Way', 2], ['wall', undefined, undefined, 3]]);
    expect(map.entities.find(entity => entity.type === 'robot_position')).toMatchObject({ points: [75, 80], angle: 90 });
  });

  it('rejects what is not a map: a plain file, a PNG with no map chunk, another JSON class', async () => {
    await expect(decodeValetudoPng(new Uint8Array([1, 2, 3]))).rejects.toThrow('Not a PNG');
    await expect(decodeValetudoPng(png(mapJson, 'Other'))).rejects.toThrow('no map');
    expect(() => parseValetudoJson({ __class: 'Other' })).toThrow('Not a Valetudo map');
  });

  it('bounds the drawable cells, falling back to legacy dimensions and then the map size', () => {
    expect(mapBounds(parseValetudoJson(mapJson))).toEqual({ minX: 9, minY: 9, maxX: 21, maxY: 11 });
    const legacy = parseValetudoJson({ ...mapJson, layers: [{ type: 'floor', dimensions: { x: { min: 2, max: 8 }, y: { min: 1, max: 4 } } }] });
    expect(mapBounds(legacy)).toEqual({ minX: 2, minY: 1, maxX: 8, maxY: 4 });
    expect(mapBounds(parseValetudoJson({ __class: 'ValetudoMap', size: { x: 100, y: 50 }, pixelSize: 5 }))).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 10 });
  });
});

describe('drawing a Valetudo map', () => {
  /** A context that counts what is drawn. */
  const recorder = () => {
    const calls = { rects: 0, arcs: 0, fills: [] as unknown[] };
    const ctx = {
      fillStyle: '', strokeStyle: '', lineWidth: 0, save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
      fillRect(this: { fillStyle: unknown }) { calls.rects += 1; calls.fills.push(this.fillStyle); }, arc() { calls.arcs += 1; },
    } as unknown as MapContext;
    return { ctx, calls };
  };

  it('draws every cell of every layer, then the charger and the robot', () => {
    const { ctx, calls } = recorder();
    expect(drawValetudoMap(ctx, parseValetudoJson(mapJson), { width: 300, height: 200 })).toBe(8 + 2 + 3);
    expect(calls.rects).toBe(13);
    expect(calls.arcs).toBe(2);
  });

  it('lights the selected rooms and draws the robot only on a map that is not live', () => {
    const live = recorder(), reported = recorder(), map = parseValetudoJson(mapJson);
    drawValetudoMap(live.ctx, map, { width: 300, height: 200, selected: new Set(['3']) });
    expect(live.calls.rects).toBe(13 + 8);
    drawValetudoMap(reported.ctx, map, { width: 300, height: 200, reported: true });
    expect(reported.calls.arcs).toBe(1);
  });
});
