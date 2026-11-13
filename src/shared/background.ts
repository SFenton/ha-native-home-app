import { isSafeUrl } from './urls';

export const MAX_BACKGROUND_LENGTH = 500_000;

export function isBackgroundImage(value: string): boolean {
  if (value.length > MAX_BACKGROUND_LENGTH) return false;
  return value.startsWith('data:')
    ? /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(value)
    : value.length <= 2048 && isSafeUrl(value);
}
