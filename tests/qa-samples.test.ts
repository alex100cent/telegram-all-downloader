// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const script = resolve('scripts/qa-samples.ts');
let root: string;
let samples: string;
let selection: string;
let manifest: string;

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tad-qa-cli-'));
  samples = join(root, 'samples');
  manifest = join(samples, 'manifest.json');
  expect(cli('generate', samples).status).toBe(0);
});

beforeEach(async () => {
  selection = await mkdtemp(join(root, 'downloads-'));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('QA sample verification CLI', () => {
  it('verifies known files and content-identical renamed files', async () => {
    const data = await readFile(join(samples, 'tad-sample-document.pdf'));
    await writeFile(join(selection, 'tad-sample-document.pdf'), data);
    await writeFile(join(selection, 'renamed.pdf'), data);
    const result = cli('verify', manifest, selection);
    expect(result.status).toBe(0);
    expect(result.output).toContain('PASS');
    expect(result.output).toContain('tad-sample-document.pdf');
  });

  it('fails a named document that was truncated even if it still has a valid header', async () => {
    const data = await readFile(join(samples, 'tad-sample-document.pdf'));
    await writeFile(join(selection, 'tad-sample-document.pdf'), data.subarray(0, data.length - 7));
    const result = cli('verify', manifest, selection);
    expect(result.status).toBe(1);
    expect(result.output).toContain('FAIL');
    expect(result.output).toContain('tad-sample-document.pdf');
  });

  it('fails the expected file when its bytes are replaced by a different valid sample', async () => {
    await writeFile(
      join(selection, 'tad-sample-document.pdf'),
      await readFile(join(samples, 'tad-sample-text.txt')),
    );
    const result = cli('verify', manifest, selection);
    expect(result.status).toBe(1);
    expect(result.output).toContain('FAIL');
    expect(result.output).toContain('tad-sample-document.pdf');
  });

  it('uses an explicit expected sample for a renamed damaged file', async () => {
    const data = await readFile(join(samples, 'tad-sample-document.pdf'));
    const path = join(selection, 'my-download.pdf');
    await writeFile(path, data.subarray(0, data.length - 1));
    const result = cli('verify', manifest, path, '--expected=tad-sample-document.pdf');
    expect(result.status).toBe(1);
    expect(result.output).toContain('FAIL');
    expect(result.output).toContain('tad-sample-document.pdf');
  });

  it('does not infer corruption or equality from an unknown file with a matching size', async () => {
    const data = await readFile(join(samples, 'tad-sample.tadqa'));
    data[100] = data[100]! ^ 0xff;
    await writeFile(join(selection, 'unknown.bin'), data);
    const result = cli('verify', manifest, selection);
    expect(result.status).toBe(2);
    expect(result.output).toContain('INCONCLUSIVE');
    expect(result.output).not.toContain('FAIL');
    expect(result.output).not.toContain('PASS');
  });

  it('does not certify identical unknown A/K copies as a complete expected sample', async () => {
    const data = Buffer.from('Unknown transformed Telegram media');
    await writeFile(join(selection, 'web-a.mp4'), data);
    await writeFile(join(selection, 'web-k.mp4'), data);
    const result = cli('verify', manifest, selection);
    expect(result.status).toBe(2);
    expect(result.output).toContain('INCONCLUSIVE');
    expect(result.output).not.toContain('PASS');
  });

  it.each([false, true])(
    'returns inconclusive for an empty selection (nested directory: %s)',
    async (nested) => {
      if (nested) await mkdir(join(selection, 'nested-empty-directory'));
      const result = cli('verify', manifest, selection);
      expect(result.status).toBe(2);
      expect(result.output).toContain('INCONCLUSIVE');
      expect(result.output).not.toContain('PASS');
    },
  );

  it('reports an unavailable decoder as inconclusive rather than corrupt media', async () => {
    const media = join(selection, 'unknown.mp3');
    await writeFile(media, Buffer.from('ID3 unknown media'));
    const result = spawnSync(process.execPath, [script, 'verify', manifest, media, '--decode'], {
      cwd: root,
      env: { ...process.env, PATH: selection },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('INCONCLUSIVE decode unavailable');
    expect(result.stdout).not.toContain('FAIL');
  });

  it('keeps a mixed verified and unknown selection inconclusive', async () => {
    await writeFile(
      join(selection, 'valid.txt'),
      await readFile(join(samples, 'tad-sample-text.txt')),
    );
    await writeFile(join(selection, 'unknown.bin'), Buffer.from('unknown'));
    const result = cli('verify', manifest, selection);
    expect(result.status).toBe(2);
    expect(result.output).toContain('PASS');
    expect(result.output).toContain('INCONCLUSIVE');
  });

  it('rejects an expected sample name missing from the manifest', async () => {
    await writeFile(
      join(selection, 'valid.txt'),
      await readFile(join(samples, 'tad-sample-text.txt')),
    );
    const result = cli('verify', manifest, selection, '--expected=missing.txt');
    expect(result.status).toBe(2);
    expect(result.output).toContain('Unknown expected sample');
    expect(result.output).not.toContain('PASS');
  });
});
