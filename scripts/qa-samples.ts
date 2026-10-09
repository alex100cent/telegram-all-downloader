import { spawnSync } from 'node:child_process';
import { createCipheriv, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { crc32, gunzipSync } from 'node:zlib';

interface Sample {
  file: string;
  bytes: number;
  sha256: string;
  category: string;
}

const MiB = 1024 * 1024;
const TAIL = 12_345;
// Telegram accepts at most 4000 (8000 with Premium) upload parts of 512 KiB.
const LARGE: Record<string, number> = {
  '100m': 100 * MiB + TAIL,
  '1g': 1024 * MiB + TAIL,
  '2g': 1990 * MiB + TAIL,
  '4g': 3990 * MiB + TAIL,
};
const USAGE = `Usage:
  node scripts/qa-samples.ts generate <dir> [--large=100m,1g,2g,4g] [--media] [--long-video]
  node scripts/qa-samples.ts verify <manifest.json> <file-or-dir>... [--decode]
  node scripts/qa-samples.ts memory <pid>[,<pid>...] [--seconds=N]`;

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function pdf(): Buffer {
  const text = 'BT /F1 18 Tf 72 770 Td (Telegram All Downloader QA sample) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function zip(entries: Array<[string, string]>): Buffer {
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content, 'utf8');
    const file = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(10, 4);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(file.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(10, 6);
    directory.writeUInt16LE(date, 14);
    directory.writeUInt32LE(crc32(data), 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(file.length, 28);
    directory.writeUInt32LE(offset, 42);
    local.push(header, file, data);
    central.push(directory, file);
    offset += header.length + file.length + data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function keystream(seed: string) {
  const key = createHash('sha256').update(seed).digest().subarray(0, 16);
  return createCipheriv('aes-128-ctr', key, Buffer.alloc(16));
}

async function writeStream(path: string, size: number, seed: string): Promise<string> {
  const cipher = keystream(seed);
  const hash = createHash('sha256');
  const zeros = Buffer.alloc(8 * MiB);
  const file = await open(path, 'w');
  try {
    for (let written = 0; written < size;) {
      const chunk = cipher.update(zeros.subarray(0, Math.min(zeros.length, size - written)));
      hash.update(chunk);
      await file.write(chunk);
      written += chunk.length;
    }
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

function ffmpeg(output: string, args: string[]): void {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...args,
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      output,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${basename(output)}`);
}

async function generate(dir: string, options: Map<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  const samples: Sample[] = [];
  const add = async (file: string, category: string, data?: Uint8Array) => {
    const path = join(dir, file);
    if (data) await writeFile(path, data);
    const content = data ?? (await readFile(path));
    samples.push({ file, bytes: content.byteLength, sha256: sha256(content), category });
  };
  const binary = (seed: string, size: number) => keystream(seed).update(Buffer.alloc(size));
  await add('tad-sample-document.pdf', 'pdf', pdf());
  await add(
    'tad-sample-archive.zip',
    'zip',
    zip([
      ['readme.txt', 'Telegram All Downloader QA archive.\n'],
      ['data/values.csv', 'index,value\n1,alpha\n2,beta\n'],
    ]),
  );
  await add(
    'tad-sample-text.txt',
    'text',
    Buffer.from('Telegram All Downloader QA text sample.\n'),
  );
  await add('tad-sample-noext', 'no-extension', Buffer.from('No file extension.\n'));
  await add('tad-sample.tadqa', 'unknown-type', binary('unknown-type', 64 * 1024 + 17));
  await add('tad-образец файла ✓.bin', 'unicode-name', binary('unicode-name', 8 * 1024 + 3));
  for (const preset of (options.get('large') ?? '').split(',').filter(Boolean)) {
    const size = LARGE[preset];
    if (!size)
      throw new Error(`Unknown large preset "${preset}". Use ${Object.keys(LARGE).join(', ')}.`);
    const file = `tad-large-${preset}.bin`;
    const hash = await writeStream(join(dir, file), size, `large-${preset}`);
    samples.push({ file, bytes: size, sha256: hash, category: `large-${preset}` });
  }
  if (options.has('media') || options.has('long-video')) {
    const media: Array<[string, string, string]> = [
      ['tad-sample-tone.flac', 'flac', '-f lavfi -i sine=frequency=440:duration=5 -c:a flac'],
      [
        'tad-sample-tone.m4a',
        'm4a',
        '-f lavfi -i sine=frequency=523:duration=5 -c:a aac -b:a 128k',
      ],
      [
        'tad-sample-animation.gif',
        'gif',
        '-f lavfi -i testsrc=size=240x160:rate=10:duration=3 -vf split[a][b];[a]palettegen[p];[b][p]paletteuse',
      ],
      [
        'tad-sample-animation.mp4',
        'mp4-animation',
        '-f lavfi -i testsrc2=size=320x240:rate=25:duration=3 -c:v libx264 -pix_fmt yuv420p -an -movflags +faststart',
      ],
      [
        'tad-sample-video.webm',
        'webm',
        '-f lavfi -i testsrc2=size=320x240:rate=25:duration=3 -c:v libvpx-vp9 -b:v 300k -an',
      ],
    ];
    if (options.has('long-video'))
      media.push([
        'tad-sample-long-video.mp4',
        'long-video',
        '-f lavfi -i testsrc2=size=1280x720:rate=25 -f lavfi -i sine=frequency=330 -t 660 -c:v libx264 -preset ultrafast -b:v 1400k -c:a aac -b:a 96k -pix_fmt yuv420p -movflags +faststart',
      ]);
    for (const [file, category, args] of media) {
      ffmpeg(join(dir, file), args.split(' '));
      await add(file, category);
    }
  }
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify({ samples }, null, 2)}\n`);
  for (const sample of samples)
    console.log(
      `${sample.category.padEnd(14)} ${String(sample.bytes).padStart(13)}  ${sample.sha256}  ${sample.file}`,
    );
  console.log(`\nManifest: ${join(dir, 'manifest.json')}`);
}

async function hashFile(path: string): Promise<{ bytes: number; sha256: string; head: Buffer }> {
  const hash = createHash('sha256');
  let bytes = 0;
  let head = Buffer.alloc(0);
  for await (const chunk of createReadStream(path, {
    highWaterMark: 4 * MiB,
  }) as AsyncIterable<Buffer>) {
    if (head.length < 64) head = Buffer.concat([head, chunk.subarray(0, 64 - head.length)]);
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex'), head };
}

function detect(head: Buffer): string {
  const ascii = head.toString('latin1');
  if (ascii.startsWith('%PDF-')) return 'pdf';
  if (ascii.startsWith('PK\x03\x04')) return 'zip';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('fLaC')) return 'flac';
  if (ascii.startsWith('OggS')) return 'ogg';
  if (ascii.startsWith('ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0))
    return 'mpeg-audio';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (ascii.startsWith('\x89PNG')) return 'png';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm/matroska';
  if (ascii.slice(4, 8) === 'ftyp') return `iso-bmff (${ascii.slice(8, 12).trim()})`;
  if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  return 'unknown';
}

function tgs(path: string, data: Buffer): string {
  try {
    const lottie = JSON.parse(gunzipSync(data).toString('utf8')) as Record<string, unknown>;
    if (lottie.tgs !== 1) return 'FAIL gzip JSON without tgs=1';
    return `tgs Lottie ${lottie.w}x${lottie.h}, ${lottie.fr} fps, frames ${lottie.ip}-${lottie.op}`;
  } catch {
    return `FAIL ${basename(path)} is gzip but not a Lottie sticker`;
  }
}

function decode(path: string): string {
  const result = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-xerror',
      '-err_detect',
      'explode',
      '-i',
      path,
      '-map',
      '0',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  return result.status === 0 && !result.stderr.trim() ? 'decoded' : 'FAIL decode';
}

async function files(paths: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const path of paths) {
    if ((await stat(path)).isDirectory()) {
      for (const entry of (await readdir(path)).sort())
        if (!entry.startsWith('.') && !entry.endsWith('.crswap') && entry !== 'manifest.json')
          result.push(join(path, entry));
    } else result.push(path);
  }
  return result;
}

async function verify(manifestPath: string, paths: string[], options: Map<string, string>) {
  const { samples } = JSON.parse(await readFile(manifestPath, 'utf8')) as { samples: Sample[] };
  const groups = new Map<string, string[]>();
  let failed = false;
  for (const path of await files(paths)) {
    const { bytes, sha256: hash, head } = await hashFile(path);
    let type = detect(head);
    const checks: string[] = [];
    if (type === 'gzip' && bytes < 16 * MiB) checks.push(tgs(path, await readFile(path)));
    if (
      options.has('decode') &&
      /^(mpeg-audio|ogg|flac|gif|webm|iso-bmff|jpeg|png|webp)/.test(type)
    )
      checks.push(decode(path));
    const sample = samples.find((entry) => entry.sha256 === hash);
    const sized = samples.find((entry) => entry.bytes === bytes);
    let result: string;
    if (sample) result = `identical to ${sample.category} sample`;
    else if (sized) result = `FAIL same size as ${sized.category} sample, different SHA-256`;
    else result = 'not in manifest; compare A/K copies by SHA-256';
    if (result.startsWith('FAIL') || checks.some((check) => check.startsWith('FAIL')))
      failed = true;
    if (type === 'unknown' && sample) type = 'opaque';
    groups.set(hash, [...(groups.get(hash) ?? []), basename(path)]);
    console.log(
      [basename(path), String(bytes), hash.slice(0, 16), type, result, ...checks].join(' | '),
    );
  }
  for (const [hash, names] of groups)
    if (names.length > 1)
      console.log(`identical copies (${hash.slice(0, 16)}): ${names.join(', ')}`);
  process.exitCode = failed ? 1 : 0;
}

function memory(pids: string[], options: Map<string, string>): void {
  const started = Date.now();
  let baseline: number | undefined;
  let peak = 0;
  let last = 0;
  const sample = () => {
    const output = spawnSync('ps', ['-o', 'rss=', '-p', pids.join(',')], { encoding: 'utf8' });
    const total = output.stdout
      .split('\n')
      .map((line) => Number(line.trim()) * 1024)
      .filter((value) => value > 0)
      .reduce((sum, value) => sum + value, 0);
    baseline ??= total;
    peak = Math.max(peak, total);
    if (Date.now() - last >= 5_000) {
      last = Date.now();
      console.log(`${Math.round((last - started) / 1000)}s  RSS ${(total / MiB).toFixed(1)} MiB`);
    }
  };
  const timer = setInterval(sample, 500);
  sample();
  const report = () => {
    clearInterval(timer);
    const growth = peak - (baseline ?? peak);
    console.log(
      `Baseline ${((baseline ?? 0) / MiB).toFixed(1)} MiB, peak ${(peak / MiB).toFixed(1)} MiB, growth ${(growth / MiB).toFixed(1)} MiB`,
    );
  };
  process.once('SIGINT', report);
  const seconds = Number(options.get('seconds'));
  if (seconds > 0)
    setTimeout(() => {
      process.removeListener('SIGINT', report);
      report();
    }, seconds * 1000);
}

const [command, ...rest] = process.argv.slice(2);
const options = new Map(
  rest
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [key, value = ''] = arg.slice(2).split('=');
      return [key!, value] as [string, string];
    }),
);
const positional = rest.filter((arg) => !arg.startsWith('--'));
if (command === 'generate' && positional.length === 1)
  await generate(resolve(positional[0]!), options);
else if (command === 'verify' && positional.length >= 2)
  await verify(
    resolve(positional[0]!),
    positional.slice(1).map((path) => resolve(path)),
    options,
  );
else if (command === 'memory' && positional.length === 1 && /^\d+(,\d+)*$/.test(positional[0]!))
  memory(positional[0]!.split(','), options);
else {
  console.error(USAGE);
  process.exitCode = 2;
}
