import { readoutTones } from '../../shared/composition/schema';

/** The six tones of a readout as the Studio says them, and a swatch for each (never the only signal: the word is beside it). */
export const toneWords: Record<(typeof readoutTones)[number], string> = { neutral: 'Neutral', ok: 'Good', active: 'Active', warning: 'Warning', danger: 'Problem', unavailable: 'Unavailable' };
export const toneSwatch: Record<(typeof readoutTones)[number], string> = { neutral: '#8e8e93', ok: '#34c759', active: '#0a84ff', warning: '#ff9f0a', danger: '#ff453a', unavailable: '#636366' };
export const toneOptions = readoutTones.map(value => ({ value, label: toneWords[value] }));
/** The word for a stored tone; anything else (a value from a newer contract) reads as it is. */
export const toneName = (value: unknown): string => typeof value === 'string' && value in toneWords ? toneWords[value as keyof typeof toneWords] : String(value ?? '');
