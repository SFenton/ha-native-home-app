import { createHash } from 'node:crypto';
import type { UploadedCompositionAsset } from '../src/shared/composition/workspace';
import { HttpError } from './store';

export const MAX_COMPOSITION_ASSET_BYTES = 8 * 1024 * 1024;
export const compositionAssetName = /^[a-f0-9]{64}\.(?:png|jpg)$/;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Bounded container/header inspection, not a substitute for native image decoding/frame verification. */
export function inspectCompositionImage(bytes: Buffer, mimeType: string): UploadedCompositionAsset {
  if (!bytes.length || bytes.length > MAX_COMPOSITION_ASSET_BYTES) throw new HttpError(413, 'Image must contain 1 to 8388608 bytes');
  let pixelWidth = 0, pixelHeight = 0;
  const invalid = () => { throw new HttpError(422, 'Invalid or unsupported PNG/JPEG image container'); };
  if (mimeType === 'image/png') {
    if (!bytes.subarray(0, 8).equals(pngSignature)) invalid();
    let offset = 8, header = false, data = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (length > bytes.length - offset - 12 || !/^[A-Za-z]{4}$/.test(type)) invalid();
      if (!header && type !== 'IHDR') invalid();
      // CRCs detect damaged chunks without decoding or allocating the pixel buffer.
      let crc = 0xffffffff;
      for (let i = offset + 4; i < offset + 8 + length; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + length)) invalid();
      if (type === 'IHDR') {
        if (header || length !== 13) invalid();
        header = true; pixelWidth = bytes.readUInt32BE(offset + 8); pixelHeight = bytes.readUInt32BE(offset + 12);
        const depth = bytes[offset + 16], color = bytes[offset + 17];
        const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) invalid();
      } else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') invalid();
      else if (type === 'IDAT') data = true;
      else if (type === 'IEND') {
        if (length || !data || offset + 12 !== bytes.length) invalid();
        ended = true; break;
      } else if (type[0] === type[0].toUpperCase() && type !== 'PLTE') invalid();
      offset += 12 + length;
    }
    if (!ended) invalid();
  } else if (mimeType === 'image/jpeg') {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) invalid();
    let offset = 2, scan = false, ended = false;
    while (offset < bytes.length - 2) {
      if (bytes[offset++] !== 0xff) invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || [0, 0xd8, 0xd9].includes(marker) || (marker >= 0xd0 && marker <= 0xd7)) invalid();
      if (marker === 0x01) continue;
      if (offset + 2 > bytes.length) invalid();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length - 2) invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (pixelWidth || length < 8 || bytes[offset + 2] !== 8) invalid();
        pixelHeight = bytes.readUInt16BE(offset + 3); pixelWidth = bytes.readUInt16BE(offset + 5);
        if (length !== 8 + 3 * bytes[offset + 7]) invalid();
      } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) invalid();
      offset += length;
      if (marker === 0xda) {
        const components = bytes[offset - length + 2];
        if (!pixelWidth || !components || length !== 6 + 2 * components) invalid();
        scan = true;
        const start = offset;
        while (offset < bytes.length) {
          if (bytes[offset++] !== 0xff) continue;
          while (bytes[offset] === 0xff) offset++;
          const next = bytes[offset];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset++; continue; }
          if (next === 0xd9) {
            if (offset <= start + 1 || offset + 1 !== bytes.length) invalid();
            ended = true; offset++; break;
          }
          offset--;
          break;
        }
        if (ended) break;
      }
    }
    if (!scan || !pixelWidth || !ended) invalid();
  } else throw new HttpError(415, 'Only image/png and image/jpeg are supported');
  if (!pixelWidth || !pixelHeight || pixelWidth > 8192 || pixelHeight > 8192 || pixelWidth * pixelHeight > 16000000)
    throw new HttpError(422, 'Image dimensions must be at most 8192 per side and 16000000 pixels');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    source: { type: 'publisher', path: `/api/assets/${sha256}.${mimeType === 'image/png' ? 'png' : 'jpg'}` },
    sha256, mimeType, byteLength: bytes.length, pixelWidth, pixelHeight,
  };
}
