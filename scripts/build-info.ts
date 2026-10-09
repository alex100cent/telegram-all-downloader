import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildInfo } from '../src/build';

// Changes limited to these paths cannot alter the packaged extension.
const NON_BUILD_PATHS = [
  'docs',
  'tests',
  '.github',
  '*.md',
  '*.test.ts',
  'scripts/qa-samples.ts',
  'LICENSE',
  '.gitignore',
  '.nvmrc',
  '.prettierignore',
  '.prettierrc.json',
  'eslint.config.js',
  'playwright.config.ts',
  'vitest.config.ts',
];
const SCOPE = ['--', '.', ...NON_BUILD_PATHS.map((path) => `:(exclude)${path}`)];

function git(root: string, args: string[]): Buffer {
  return execFileSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function readBuildInfo(root: string, env: NodeJS.ProcessEnv = process.env): BuildInfo {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version: string;
  };
  const ciRun = env.GITHUB_ACTIONS === 'true' ? env.GITHUB_RUN_NUMBER || undefined : undefined;
  let commit: string;
  try {
    commit = git(root, ['rev-parse', '--verify', 'HEAD']).toString().trim();
  } catch {
    return { version, id: 'unversioned', modified: true, ciRun };
  }
  const short = commit.slice(0, 7);
  const status = git(root, ['status', '--porcelain', '--untracked-files=all', ...SCOPE]);
  if (!status.length) return { version, id: short, commit, modified: false, ciRun };
  const fingerprint = createHash('sha256').update(
    git(root, ['diff', '--binary', 'HEAD', ...SCOPE]),
  );
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard', ...SCOPE])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort();
  for (const path of untracked)
    fingerprint.update(`\0${path}\0`).update(readFileSync(join(root, path)));
  return {
    version,
    id: `${short}-modified.${fingerprint.digest('hex').slice(0, 8)}`,
    commit,
    modified: true,
    ciRun,
  };
}

export function versionName(build: BuildInfo): string {
  return `${build.version} (${build.id})`;
}
