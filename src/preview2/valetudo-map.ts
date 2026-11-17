/**
 * A Valetudo map as the robot exports it, read from the `zTXt` chunk of the map camera's PNG, and the drawing of it. This ports
 * the app's `ValetudoMapDecoder`, `ValetudoMap.bounds` and `ValetudoMapStyle` (`HassCore/Vacuums/ValetudoMap.swift`,
 * `ValetudoMapStyle.swift`) to the preview. Layer pixels are grid cells; entity points are centimetres (`grid * pixelSize`).
 */

/** One layer: `floor`, `segment` or `wall`, its cells as flat `x, y` pairs. */
export interface MapLayer { type: string; pixels: number[]; hasPixels: boolean; dimensions?: Bounds; name?: string; segmentId?: string; active: boolean }
/** An entity on the map: the robot, the charger, a path or an area. */
export interface MapEntity { type: string; points: number[]; angle?: number }
/** Inclusive grid bounds. */
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
/** A decoded map. */
export interface ValetudoMap { layers: MapLayer[]; entities: MapEntity[]; pixelSize: number; size: { x: number; y: number }; version?: number }

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numbers = (value: unknown): number[] => Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [];

/** Run-length rows `[x, y, count, ...]` to flat cells (`ValetudoMapDecoder.expand`). */
export function expandPixels(compressed: readonly number[]): number[] {
  const pixels: number[] = [];
  for (let at = 0; at + 2 < compressed.length; at += 3) {
    const [startX, y, count] = [compressed[at], compressed[at + 1], compressed[at + 2]];
    for (let offset = 0; offset < count; offset += 1) pixels.push(startX + offset, y);
  }
  return pixels;
}

function readLayer(raw: Record<string, unknown>): MapLayer {
  const meta = isRecord(raw.metaData) ? raw.metaData : {};
  const plain = numbers(raw.pixels);
  const dims = isRecord(raw.dimensions) ? raw.dimensions : undefined;
  const range = (axis: unknown) => isRecord(axis) && typeof axis.min === 'number' && typeof axis.max === 'number' ? [axis.min, axis.max] as const : undefined;
  const x = range(dims?.x), y = range(dims?.y);
  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : undefined;
  return {
    type: typeof raw.type === 'string' ? raw.type : '', hasPixels: raw.pixels !== undefined || raw.compressedPixels !== undefined,
    pixels: plain.length ? plain : expandPixels(numbers(raw.compressedPixels)),
    dimensions: x && y ? { minX: x[0], maxX: x[1], minY: y[0], maxY: y[1] } : undefined,
    name, segmentId: typeof meta.segmentId === 'string' || typeof meta.segmentId === 'number' ? String(meta.segmentId) : undefined, active: meta.active === true,
  };
}

/** Parses the map's JSON (`ValetudoMapDecoder.map(fromJSON:)`); throws when it is not a `ValetudoMap`. */
export function parseValetudoJson(json: unknown): ValetudoMap {
  if (!isRecord(json) || json.__class !== 'ValetudoMap') throw new Error('Not a Valetudo map');
  const size = isRecord(json.size) ? json.size : {}, meta = isRecord(json.metaData) ? json.metaData : {};
  return {
    pixelSize: typeof json.pixelSize === 'number' && json.pixelSize > 0 ? json.pixelSize : 5,
    size: { x: typeof size.x === 'number' ? size.x : 0, y: typeof size.y === 'number' ? size.y : 0 },
    version: typeof meta.version === 'number' ? meta.version : undefined,
    layers: (Array.isArray(json.layers) ? json.layers : []).filter(isRecord).map(readLayer),
    entities: (Array.isArray(json.entities) ? json.entities : []).filter(isRecord).map(item => ({
      type: typeof item.type === 'string' ? item.type : '', points: numbers(item.points),
      angle: isRecord(item.metaData) && typeof item.metaData.angle === 'number' ? item.metaData.angle : undefined })),
  };
}

/** Inflates zlib data. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extracts the map from a Valetudo camera PNG (`extractValetudoMapFromPngBytes`): the `zTXt` chunk keyed `ValetudoMap`. */
export async function decodeValetudoPng(bytes: Uint8Array): Promise<ValetudoMap> {
  if (bytes.length < 8 || PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte)) throw new Error('Not a PNG');
  const text = new TextDecoder();
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
    const type = text.decode(bytes.subarray(offset + 4, offset + 8)), start = offset + 8, end = Math.min(bytes.length, start + length);
    offset = start + length + 4;
    if (type === 'IEND') break;
    if (type !== 'zTXt') continue;
    const separator = bytes.subarray(start, end).indexOf(0);
    if (separator < 0 || text.decode(bytes.subarray(start, start + separator)) !== 'ValetudoMap' || bytes[start + separator + 1] !== 0) continue;
    return parseValetudoJson(JSON.parse(text.decode(await inflate(bytes.subarray(start + separator + 2, end)))));
  }
  throw new Error('The picture carries no map');
}

// MARK: - Bounds

/** Grid bounds of everything drawable (`ValetudoMap.bounds`): the layers' cells, else the legacy dimensions, else the map size. */
export function mapBounds(map: ValetudoMap): Bounds {
  const drawn: Bounds[] = [], legacy: Bounds[] = [];
  for (const layer of map.layers) {
    if (layer.hasPixels) {
      if (layer.pixels.length < 2) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let at = 0; at + 1 < layer.pixels.length; at += 2) {
        const x = layer.pixels[at], y = layer.pixels[at + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      drawn.push({ minX, minY, maxX, maxY });
    } else if (layer.dimensions && layer.dimensions.minX <= layer.dimensions.maxX && layer.dimensions.minY <= layer.dimensions.maxY) legacy.push(layer.dimensions);
  }
  const all = drawn.length ? drawn : legacy;
  if (!all.length) return { minX: 0, minY: 0, maxX: Math.max(1, Math.ceil(map.size.x / map.pixelSize)), maxY: Math.max(1, Math.ceil(map.size.y / map.pixelSize)) };
  return all.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
}

// MARK: - Style (`ValetudoMapStyle`)

const rgba = (r: number, g: number, b: number, a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;
/** Segment fills, cycled in layer order. */
export const segmentFills = [rgba(61, 176, 145, .78), rgba(73, 152, 220, .78), rgba(158, 130, 226, .78), rgba(235, 154, 87, .78), rgba(106, 190, 92, .78), rgba(226, 115, 141, .78), rgba(88, 175, 205, .78)];
const wallFill = rgba(236, 244, 255, .82), robotFill = rgba(248, 250, 252), dockFill = rgba(102, 187, 106), pathStroke = rgba(255, 255, 255, .72);
const areaStyles: Record<string, { stroke: string; fill: string }> = {
  no_go_area: { stroke: rgba(255, 138, 128, .76), fill: rgba(239, 83, 80, .22) }, no_mop_area: { stroke: rgba(144, 202, 249, .76), fill: rgba(33, 150, 243, .2) },
  active_zone: { stroke: rgba(128, 222, 234, .72), fill: rgba(77, 208, 225, .16) },
};

/** What a `CanvasRenderingContext2D` needs here, so the drawing can be tested with a recording stand-in. */
export type MapContext = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'fill' | 'stroke' | 'closePath'
  | 'clearRect'> & { fillStyle: unknown; strokeStyle: unknown; lineWidth: number };

/** How a drawing is placed: the canvas size in points, and the room of the segments to light (by segment id). */
export interface DrawOptions { width: number; height: number; /** Segment ids drawn with their selection ring. */ selected?: ReadonlySet<string>; /** Draws the robot and dock only (a map that is not live). */ reported?: boolean }

/**
 * Draws the map fitted into the canvas: floor and segment cells, walls, areas, the path, the charger and the robot (`renderValetudoMap`).
 * Returns the number of cells drawn, so a caller can tell an empty map.
 */
export function drawValetudoMap(ctx: MapContext, map: ValetudoMap, options: DrawOptions): number {
  const bounds = mapBounds(map), margin = 8;
  const cols = bounds.maxX - bounds.minX + 1, rows = bounds.maxY - bounds.minY + 1;
  const scale = Math.max(.01, Math.min((options.width - 2 * margin) / cols, (options.height - 2 * margin) / rows));
  const left = (options.width - cols * scale) / 2, top = (options.height - rows * scale) / 2;
  const cell = (x: number, y: number) => [left + (x - bounds.minX) * scale, top + (y - bounds.minY) * scale] as const;
  const point = (cx: number, cy: number) => cell(cx / map.pixelSize, cy / map.pixelSize);
  ctx.clearRect(0, 0, options.width, options.height);
  let drawn = 0, segment = 0;
  const fill = (layer: MapLayer, color: string) => {
    ctx.fillStyle = color;
    for (let at = 0; at + 1 < layer.pixels.length; at += 2) { const [x, y] = cell(layer.pixels[at], layer.pixels[at + 1]); ctx.fillRect(x, y, Math.ceil(scale), Math.ceil(scale)); drawn += 1; }
  };
  for (const layer of map.layers) if (layer.type === 'floor') fill(layer, rgba(255, 255, 255, .1));
  for (const layer of map.layers) if (layer.type === 'segment') {
    fill(layer, segmentFills[segment % segmentFills.length]); segment += 1;
    if (layer.segmentId && options.selected?.has(layer.segmentId)) fill(layer, rgba(255, 255, 255, .28));
  }
  for (const layer of map.layers) if (layer.type === 'wall') fill(layer, wallFill);
  const keep = options.reported ? new Set(['no_go_area', 'no_mop_area', 'robot_position', 'virtual_wall']) : undefined;
  for (const entity of map.entities) {
    if (keep && !keep.has(entity.type)) continue;
    const style = areaStyles[entity.type];
    if (style && entity.points.length >= 6) {
      ctx.beginPath();
      entity.points.forEach((value, at) => { if (at % 2) return; const [x, y] = point(value, entity.points[at + 1]); if (at === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath(); ctx.fillStyle = style.fill; ctx.fill(); ctx.strokeStyle = style.stroke; ctx.lineWidth = 1.5; ctx.stroke();
    } else if ((entity.type === 'path' || entity.type === 'predicted_path') && entity.points.length >= 4) {
      ctx.beginPath();
      entity.points.forEach((value, at) => { if (at % 2) return; const [x, y] = point(value, entity.points[at + 1]); if (at === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.strokeStyle = entity.type === 'path' ? pathStroke : rgba(255, 255, 255, .36); ctx.lineWidth = 1.5; ctx.stroke();
    }
  }
  const marker = (entity: MapEntity | undefined, color: string, radius: number) => {
    if (!entity || entity.points.length < 2) return;
    const [x, y] = point(entity.points[0], entity.points[1]);
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = rgba(8, 16, 24, .72); ctx.lineWidth = 2; ctx.stroke();
  };
  if (!options.reported) marker(map.entities.find(entity => entity.type === 'charger_location'), dockFill, 6);
  marker(map.entities.find(entity => entity.type === 'robot_position'), robotFill, 7);
  return drawn;
}
