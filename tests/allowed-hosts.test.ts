import { describe, expect, it } from 'vitest';
import { buildAllowedHosts, isAllowedHostHeader } from '../server/allowed-hosts';

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

describe('isAllowedHostHeader', () => {
  const allowed = buildAllowedHosts('studio.lan');
  it('accepts loopback names, IP literals, Tailscale and configured hosts, with or without a port', () => {
    for (const host of ['localhost', 'LOCALHOST:4800', 'app.localhost', '127.0.0.1', '10.0.0.5:4800', '[::1]:4800', 'mac.tail1.ts.net:80', 'ts.net', 'studio.lan:4800']) expect([host, isAllowedHostHeader(host, allowed)]).toEqual([host, true]);
  });
  it('refuses rebound names, lookalikes and a missing or malformed header', () => {
    for (const host of ['evil.example', 'localhost.evil.example', 'evil.ts.net.evil.example', 'notts.net', 'studio.lan.evil.example', '', 'a b', 'evil.example@127.0.0.1']) expect([host, isAllowedHostHeader(host, allowed)]).toEqual([host, false]);
    expect(isAllowedHostHeader(undefined, allowed)).toBe(false);
  });
});
