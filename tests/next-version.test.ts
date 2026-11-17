import { describe, expect, it } from 'vitest';
import {
  bumpVersion, commitLevel, compareVersions, insertChangelog, isBumpCommit, latestVersion, levelOf, planRelease,
  releaseNotes, setConfigVersion, type Commit,
} from '../scripts/next-version';

const commit = (subject: string, body = '', author = 'Dev'): Commit => ({ author, subject, body });
const bot = commit('Release 0.2.2 [skip ci]', '', 'github-actions[bot]');

describe('commit levels', () => {
  it('reads conventional commits, breaking markers and forced trailers', () => {
    expect(commitLevel(commit('Fix the tile'))).toBe('patch');
    expect(commitLevel(commit('feat: add rooms'))).toBe('minor');
    expect(commitLevel(commit('feat(tiles): add rooms'))).toBe('minor');
    expect(commitLevel(commit('refactor!: drop v1'))).toBe('major');
    expect(commitLevel(commit('Rework', 'BREAKING CHANGE: ids move'))).toBe('major');
    expect(commitLevel(commit('Rework', 'Release-Note: minor'))).toBe('minor');
    expect(commitLevel(commit('Rework', 'Release-Note: none'))).toBe('patch');
  });

  it('takes the largest level and defaults to patch', () => {
    expect(levelOf([])).toBe('patch');
    expect(levelOf([commit('fix: a'), commit('feat: b')])).toBe('minor');
    expect(levelOf([commit('feat: b'), commit('x!: c')])).toBe('major');
  });
});

describe('versions', () => {
  it('bumps and compares', () => {
    expect(bumpVersion('0.2.1', 'patch')).toBe('0.2.2');
    expect(bumpVersion('0.2.9', 'minor')).toBe('0.3.0');
    expect(bumpVersion('1.4.9', 'major')).toBe('2.0.0');
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(() => bumpVersion('1.2', 'patch')).toThrow(/MAJOR.MINOR.PATCH/);
  });

  it('finds the newest stable tag numerically', () => {
    expect(latestVersion(['v0.9.0', 'v0.10.0', 'v0.2.1', 'nightly', 'v1.0.0-rc1'])).toBe('0.10.0');
    expect(latestVersion([])).toBeNull();
  });

  it('rewrites only the version line of config.yaml', () => {
    expect(setConfigVersion('name: X\nversion: "0.2.1"\nslug: y\n', '0.2.2')).toBe('name: X\nversion: "0.2.2"\nslug: y\n');
  });
});

describe('release plan', () => {
  it('tags a first release as it is when config.yaml is above every tag and stable', () => {
    expect(planRelease({ configVersion: '0.3.0', tags: ['v0.1.0', 'v0.2.0', 'v0.2.1'], stableVersion: '0.2.1', commits: [commit('feat: a')] }))
      .toMatchObject({ action: 'tag-as-is', version: '0.3.0' });
    expect(planRelease({ configVersion: '0.2.1', tags: [], commits: [commit('feat: a')] })).toMatchObject({ action: 'tag-as-is', version: '0.2.1' });
  });

  it('bumps past a config.yaml version that is already tagged or at or below stable', () => {
    const tags = ['v0.1.0', 'v0.2.0', 'v0.2.1'];
    expect(planRelease({ configVersion: '0.2.1', tags, stableVersion: '0.2.1', commits: [commit('feat: a')] })).toMatchObject({ action: 'bump', version: '0.3.0', level: 'minor' });
    expect(planRelease({ configVersion: '0.2.1', tags: [], stableVersion: '0.2.1', commits: [commit('Fix a')] })).toMatchObject({ action: 'bump', version: '0.2.2' });
    expect(planRelease({ configVersion: '0.1.0', tags: ['v0.2.1'], commits: [commit('Fix a')] })).toMatchObject({ action: 'bump', version: '0.2.2' });
  });

  it('bumps the patch by default, the minor for feat and the major for a break', () => {
    const tags = ['v0.2.1'];
    expect(planRelease({ configVersion: '0.2.1', tags, commits: [commit('Fix a')] })).toMatchObject({ action: 'bump', version: '0.2.2', level: 'patch' });
    expect(planRelease({ configVersion: '0.2.1', tags, commits: [commit('Fix a'), commit('feat: b')] })).toMatchObject({ version: '0.3.0', level: 'minor' });
    expect(planRelease({ configVersion: '0.2.1', tags, commits: [commit('feat!: c')] })).toMatchObject({ version: '1.0.0', level: 'major' });
  });

  it('resumes when nothing came after the tag, ignoring the bot commit', () => {
    expect(planRelease({ configVersion: '0.2.2', tags: ['v0.2.1', 'v0.2.2'], commits: [] })).toMatchObject({ action: 'resume', version: '0.2.2' });
    expect(planRelease({ configVersion: '0.2.2', tags: ['v0.2.2'], commits: [bot], stableVersion: '0.2.1' })).toMatchObject({ action: 'resume' });
  });

  it('never resumes below stable', () => {
    expect(planRelease({ configVersion: '0.2.2', tags: ['v0.2.2'], commits: [], stableVersion: '0.3.0' })).toMatchObject({ action: 'bump', version: '0.3.1' });
  });

  it('goes past a newer tag than config.yaml names', () => {
    expect(planRelease({ configVersion: '0.2.1', tags: ['v0.2.1', 'v0.2.2'], commits: [commit('Fix a')] })).toMatchObject({ version: '0.2.3' });
  });

  it('recognizes only the bot version commit', () => {
    expect(isBumpCommit(bot)).toBe(true);
    expect(isBumpCommit(commit('Release 0.2.2 [skip ci]'))).toBe(false);
    expect(isBumpCommit({ author: 'github-actions[bot]', subject: 'Something else' })).toBe(false);
  });
});

describe('changelog', () => {
  it('lists user-visible release notes and feat subjects, once, skipping merges and quiet notes', () => {
    const notes = releaseNotes([
      commit('Tidy', 'Release-Note: none'),
      commit('Tidy more', 'Release-Note: Not user visible.'),
      commit('Fix tile', 'Release-Note: Tiles keep their size.'),
      commit('Fix tile again', 'Release-Note: Tiles keep their size.'),
      commit('feat(rooms): Add a rooms list'),
      commit('Merge branch x', 'Release-Note: Never shown.'),
      bot,
    ]);
    expect(notes).toEqual(['Tiles keep their size.', 'Add a rooms list']);
  });

  it('puts the new section above the newest and is idempotent', () => {
    const before = '# Changelog\n\n## 0.2.1\n\n- Old.\n';
    const after = insertChangelog(before, '0.2.2', ['New.']);
    expect(after).toBe('# Changelog\n\n## 0.2.2\n\n- New.\n\n## 0.2.1\n\n- Old.\n');
    expect(insertChangelog(after, '0.2.2', ['Other.'])).toBe(after);
  });

  it('writes a placeholder line when no commit has a note', () => {
    expect(insertChangelog('# Changelog\n\n## 0.1.0\n\n- A.\n', '0.1.1', [])).toContain('- Maintenance and internal changes.');
  });
});
