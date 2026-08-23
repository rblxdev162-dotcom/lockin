/**
 * Publish the built site to GitHub Pages.
 *
 * The source repository stays private and unchanged; only `web/dist` is
 * copied into the public Pages repository. That split is deliberate — the
 * thing the world can read is the thing a student actually runs, and nothing
 * else.
 *
 * The site is served from the root of a GitHub *user* site, so no base path
 * and no router basename are involved: `/home` on the live site is the same
 * path as `/home` in development, which keeps the extension's origin
 * allowlist and `appPath` honest.
 *
 * Run: npm run deploy:site   (after `npm run build`)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'web/dist');
const REPO = process.env.LOCKIN_PAGES_REPO ?? 'rblxdev162-dotcom/rblxdev162-dotcom.github.io';

if (!existsSync(DIST) || readdirSync(DIST).length === 0) {
  console.error('web/dist is empty — run `npm run build` first.');
  process.exit(1);
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const work = mkdtempSync(join(tmpdir(), 'lockin-pages-'));
try {
  git(['clone', '--depth', '1', `https://github.com/${REPO}.git`, work], ROOT);

  // Replace the published tree wholesale: a file deleted from the build must
  // disappear from the site, not linger because nothing overwrote it.
  for (const entry of readdirSync(work)) {
    if (entry === '.git') continue;
    rmSync(join(work, entry), { recursive: true, force: true });
  }
  cpSync(DIST, work, { recursive: true });

  // GitHub Pages runs Jekyll unless told not to, which silently drops any
  // file or directory beginning with an underscore.
  writeFileSync(join(work, '.nojekyll'), '');

  /**
   * Single-page-app fallback.
   *
   * The router owns `/home`, `/assignments`, `/parent` and the rest, but Pages
   * is a static file server: a reload on any of them is a 404 unless the same
   * document is served for unknown paths. Copying index.html to 404.html is
   * the standard way to say that.
   */
  cpSync(join(work, 'index.html'), join(work, '404.html'));

  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

  /**
   * The Companion ships beside the site that offers it.
   *
   * Onboarding links to `/lockin-extension.zip`, so the download and the web
   * app are always the same build: a student cannot install last month's
   * extension against this month's app. A missing zip is a hard stop rather
   * than a quietly broken link — run `npm run package:extension` first.
   */
  const zip = join(ROOT, `dist/lockin-extension-v${version}.zip`);
  if (!existsSync(zip)) {
    console.error(
      `Missing ${zip}.\nRun: LOCKIN_ENV=production npm run package:extension`,
    );
    process.exit(1);
  }
  cpSync(zip, join(work, 'lockin-extension.zip'));

  git(['add', '-A'], work);
  const status = git(['status', '--porcelain'], work);
  if (!status) {
    console.log('Site is already up to date; nothing to publish.');
    process.exit(0);
  }
  git(['commit', '-m', `Publish LockIn v${version}`], work);
  git(['push', 'origin', 'HEAD'], work);
  console.log(`Published v${version} to https://${REPO.split('/')[1]}/`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
