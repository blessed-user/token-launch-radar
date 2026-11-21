// Token Radar, the token-radar-01 entry point (Node 22, standard library only).
//
// Run it from this directory with the sealed snapshot beside the kit:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json
//
// What one run does, in order:
//   1. reads the snapshot (a single snapshot.json, or a directory holding one),
//   2. scores every pre-token protocol with the radar-2 model in lib/model.ts,
//   3. writes the ranked board to board.json and the dashboard's dataset to data.js,
//   4. copies this repository's dashboard/ and screenshots/ alongside them,
//   5. writes dossier.json last, because the dossier is a summary of the finished
//      output directory and the grader rebuilds it from that directory to compare.
//
// The dashboard itself is a static page: index.html, app.css and app.js read the
// data.js this program writes, so the numbers on the page are the numbers the
// board carries. There is no framework and no network anywhere in the entry.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output; --output wins
// over the variable, and /output is the last resort when neither is given.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The repository's own directory, so dashboard/ and screenshots/ are found
// wherever the program is started from.
const repoRoot = fileURLToPath(new URL('./', import.meta.url));

// The gate's caps, as this entry passes them to the dossier builder: the text
// cap shapes how much dashboard source the dossier's text may hold; the rest
// only refuse an output that breaks them.
const MAX_TEXT_BYTES = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// Print a message to stderr and stop with the given status.
function fail(message: string, status: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(status);
}

// The value after `--name`, or after `--name=`, in the process arguments;
// `fallback` when the flag is absent entirely.
function readFlag(name: string, fallback: string): string {
  const wanted = `--${name}`;
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === wanted && i + 1 < argv.length) return argv[i + 1]!;
    if (token.startsWith(`${wanted}=`)) return token.slice(wanted.length + 1);
  }
  return fallback;
}

// Mirror one directory's regular files into another, skipping dotfiles, and
// hand back the names that were copied. A missing source copies nothing.
function mirrorDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const inputGiven = readFlag('input', '/input');
  const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    fail(
      `no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`,
      2,
    );
  }
  const outDir = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const problem = boardIssue(board, snapshot);
  if (problem !== null) {
    fail(`the model wrote a board the gate refuses: ${problem}`, 1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  mirrorDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
  const shots = mirrorDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) {
    fail(
      `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
      1,
    );
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  // Written last on purpose: the dossier summarises the finished output, and
  // the scorer rebuilds it from this directory and compares the bytes.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, {
      text_max_bytes: MAX_TEXT_BYTES,
      screenshots: SHOT_LIMITS,
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
      `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
      `${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) ` +
      `and ${join(outDir, 'dossier.json')}\n`,
  );
}

main();
