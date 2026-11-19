import { createContext } from 'react';
import { tileInkDefault } from '../shared/composition/tile-ink-gate';

export type PreviewInk = 'primary' | 'muted';
export const defaultPreviewInk: PreviewInk = tileInkDefault ? 'primary' : 'muted';
export const PreviewInkContext = createContext<PreviewInk>(defaultPreviewInk);
