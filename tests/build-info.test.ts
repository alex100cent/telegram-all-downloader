import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBuildInfo, versionName } from '../scripts/build-info';

let root: string;
const git = (...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] },
  )
    .toString()
    .trim();
const write = (path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tad-build-info-'));
  write('package.json', JSON.stringify({ version: '1.2.3' }));
  write('src/index.ts', 'export const value = 1;\n');
  write('docs/notes.md', '# Notes\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('build identification', () => {
  it('labels an unchanged checkout with its commit', () => {
    const commit = git('rev-parse', 'HEAD');
    expect(readBuildInfo(root, {})).toEqual({
      version: '1.2.3',
      id: commit.slice(0, 7),
      commit,
      modified: false,
      ciRun: undefined,
    });
  });

  it('ignores documentation and test changes that cannot reach the package', () => {
    const clean = readBuildInfo(root, {});
    write('docs/notes.md', '# Changed\n');
    write('docs/nested/design.md', '# Design\n');
    write('README.md', 'untracked\n');
    write('tests/new.test.ts', 'test\n');
    write('src/view.test.ts', 'test\n');
    write('src/nested/view.test.ts', 'test\n');
    expect(readBuildInfo(root, {})).toEqual(clean);
  });

  const publicAssets = [
    'public/help.md',
    'public/runtime.test.ts',
    'public/docs/help.md',
    'public/tests/fixture.test.ts',
    'public/nested/LICENSE',
  ];

  it.each(publicAssets)('fingerprints the contents of untracked asset %s', (path) => {
    const clean = readBuildInfo(root, {});
    write(path, 'first asset contents\n');
    const first = readBuildInfo(root, {});
    expect(first.modified).toBe(true);
    expect(first.id).not.toBe(clean.id);

    write(path, 'second asset contents\n');
    expect(readBuildInfo(root, {}).id).not.toBe(first.id);
  });

  it.each(publicAssets)('fingerprints tracked modifications to asset %s', (path) => {
    write(path, 'original asset contents\n');
    git('add', path);
    git('commit', '-q', '-m', 'add public asset');
    const clean = readBuildInfo(root, {});
    expect(clean.modified).toBe(false);

    write(path, 'modified asset contents\n');
    const modified = readBuildInfo(root, {});
    expect(modified.modified).toBe(true);
    expect(modified.id).not.toBe(clean.id);
    git('add', path);
    expect(readBuildInfo(root, {})).toEqual(modified);
  });

  it('never labels modified build inputs as the clean commit', () => {
    const commit = git('rev-parse', 'HEAD');
    write('src/index.ts', 'export const value = 2;\n');
    const first = readBuildInfo(root, {});
    expect(first.modified).toBe(true);
    expect(first.commit).toBe(commit);
    expect(first.id).toMatch(new RegExp(`^${commit.slice(0, 7)}-modified\\.[0-9a-f]{8}$`));
    expect(readBuildInfo(root, {}).id).toBe(first.id);

    write('src/index.ts', 'export const value = 3;\n');
    expect(readBuildInfo(root, {}).id).not.toBe(first.id);
    git('add', 'src/index.ts');
    expect(readBuildInfo(root, {}).modified).toBe(true);
  });

  it('distinguishes untracked build inputs by their content', () => {
    write('src/extra.ts', 'export const extra = 1;\n');
    const first = readBuildInfo(root, {});
    expect(first.modified).toBe(true);
    write('src/extra.ts', 'export const extra = 2;\n');
    expect(readBuildInfo(root, {}).id).not.toBe(first.id);
  });

  it('records the CI run and reports builds without Git as unversioned', () => {
    expect(readBuildInfo(root, { GITHUB_ACTIONS: 'true', GITHUB_RUN_NUMBER: '42' }).ciRun).toBe(
      '42',
    );
    vi.stubEnv('GIT_CEILING_DIRECTORIES', tmpdir());
    rmSync(join(root, '.git'), { recursive: true, force: true });
    const build = readBuildInfo(root, {});
    expect(build).toMatchObject({ id: 'unversioned', modified: true });
    expect(versionName(build)).toBe('1.2.3 (unversioned)');
  });
});
