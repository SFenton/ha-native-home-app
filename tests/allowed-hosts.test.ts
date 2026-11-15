import { describe, expect, it } from 'vitest';
import { buildAllowedHosts } from '../server/allowed-hosts';

describe('buildAllowedHosts', () => {
  it('allows Tailscale MagicDNS hosts by default', () => {
    expect(buildAllowedHosts(undefined)).toEqual(['.ts.net']);
    expect(buildAllowedHosts('')).toEqual(['.ts.net']);
  });
  it('adds trimmed, de-duplicated names from the env list', () => {
    expect(buildAllowedHosts(' studio.lan, .ts.net ,,studio.lan')).toEqual(['.ts.net', 'studio.lan']);
  });
  it('never opens the guard wholesale', () => {
    expect(buildAllowedHosts('*,a.example')).toEqual(['.ts.net', 'a.example']);
  });
});
