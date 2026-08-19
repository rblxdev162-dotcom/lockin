#!/usr/bin/env node
/**
 * Builds a shipping copy of the Chrome extension into `release/extension/`,
 * and optionally zips it into `dist/lockin-extension-v<version>.zip`.
 *
 *   node scripts/build-extension.mjs            # release/extension only
 *   node scripts/build-extension.mjs --zip      # + dist/…zip
 *
 * Environment (see scripts/gen-extension-config.mjs):
 *   LOCKIN_ENV=production LOCKIN_APP_ORIGIN=https://lockin.example.com
 *
 * The copy is built from an **allowlist** of shipping directories rather than
 * by deleting known-bad ones. A denylist silently ships whatever it has not
 * heard of yet; this way a new test directory has to be added on purpose
 * before it can reach a student.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'extension');
const OUT_DIR = join(ROOT, 'release', 'extension');
const DIST_DIR = join(ROOT, 'dist');

/** Exactly what ships. Anything not named here is left behind. */
export const SHIPPING_ENTRIES = [
  'manifest.json',
  'assets',
  'background',
  'blocked',
  'canvas',
  'content',
  'popup',
  'options',
  'shared',
];

/** Never ship these, even if they appear inside a shipping directory. */
export const FORBIDDEN_PATTERNS = [
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)fixtures?(\/|$)/i,
  /\.test\.[cm]?js$/i,
  /\.spec\.[cm]?js$/i,
  /(^|\/)\.DS_Store$/,
  /\.map$/,
  /\.log$/,
  /\.pem$/,
  /\.key$/,
  /\.crx$/,
  /\.zip$/,
  /(^|\/)node_modules(\/|$)/,
];

export function isForbidden(relPath) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(relPath));
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(base, full);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out;
}

function main() {
  const zip = process.argv.includes('--zip');

  // 1. Clean output.
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // 2. Copy the allowlist, filtering forbidden paths on the way in.
  for (const entry of SHIPPING_ENTRIES) {
    const from = join(SOURCE, entry);
    if (!existsSync(from)) throw new Error(`extension/${entry} is missing`);
    cpSync(from, join(OUT_DIR, entry), {
      recursive: true,
      filter: (src) => !isForbidden(relative(SOURCE, src)),
    });
  }

  // 3. Write the origin configuration for the target environment.
  execFileSync(
    process.execPath,
    [join(ROOT, 'scripts', 'gen-extension-config.mjs'), '--out', OUT_DIR],
    { stdio: 'inherit', env: process.env },
  );

  // 4. Verify. A packaging bug that ships a fixture is exactly the kind of
  //    thing nobody notices until it is in the store.
  const shipped = walk(OUT_DIR);
  const leaked = shipped.filter(isForbidden);
  if (leaked.length > 0) {
    throw new Error(`release build contains files that must not ship:\n  ${leaked.join('\n  ')}`);
  }

  const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8'));
  for (const file of [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => c.js),
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
  ]) {
    if (!existsSync(join(OUT_DIR, file))) {
      throw new Error(`manifest.json references ${file}, which is not in the package`);
    }
  }

  console.log(`[LockIn] extension → release/extension (${shipped.length} files)`);

  if (!zip) return;

  // 5. Zip. Chrome Web Store wants the manifest at the archive root, so the
  //    zip is created from inside the output directory.
  mkdirSync(DIST_DIR, { recursive: true });
  const zipPath = join(DIST_DIR, `lockin-extension-v${manifest.version}.zip`);
  rmSync(zipPath, { force: true });
  execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', '.*'], { cwd: OUT_DIR });
  const bytes = statSync(zipPath).size;
  console.log(`[LockIn] package → ${relative(ROOT, zipPath)} (${(bytes / 1024).toFixed(1)} KB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
