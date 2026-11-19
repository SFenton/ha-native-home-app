import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export function baselineDirectory(): string {
  // actions/checkout's shallow PR checkout does not include origin/main.
  if (spawnSync('git', ['rev-parse', '--verify', 'refs/remotes/origin/main'], { stdio: 'ignore' }).status !== 0) {
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', 'main:refs/remotes/origin/main'], { timeout: 30_000, stdio: 'pipe' });
  }
  const directory = mkdtempSync(resolve(tmpdir(), 'studio-simulation-baseline-'));
  const archive = execFileSync('git', ['archive', 'origin/main', 'src/shared', 'tests/chart-corpus.ts', 'tests/dial-corpus.ts'], { maxBuffer: 32 * 1024 * 1024 });
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive });
  symlinkSync(resolve('node_modules'), resolve(directory, 'node_modules'), 'dir');
  return directory;
}
