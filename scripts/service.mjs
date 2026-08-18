#!/usr/bin/env node
/**
 * Keeps LockIn running, always.
 *
 * Installs a macOS **LaunchAgent** — a per-user background job — that starts
 * the static server at login and restarts it if it ever exits. No terminal
 * window to keep open, nothing to remember after a reboot.
 *
 * Why a LaunchAgent rather than a `&` in a shell:
 *   - it survives logout, reboot and the terminal being closed
 *   - `KeepAlive` restarts it if it crashes
 *   - it is a plain file the user owns, removable with one command
 *
 * Deliberately a LaunchAgent (`~/Library/LaunchAgents`), never a LaunchDaemon:
 * an agent runs as the user, needs no password, and touches nothing outside
 * this account. LockIn is a local-only study app; it has no business running
 * as root.
 *
 * Usage:
 *   npm run service:install     build, then start at login and now
 *   npm run service:status      is it running, and on which port
 *   npm run service:restart     pick up a new build
 *   npm run service:uninstall   remove it completely
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'com.lockin.web';
const AGENTS = join(homedir(), 'Library', 'LaunchAgents');
const PLIST = join(AGENTS, `${LABEL}.plist`);
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'LockIn');
const PORT = Number(process.env.LOCKIN_PORT ?? 5173);

/** The node that is running this script — an absolute path launchd can use. */
const NODE = process.execPath;

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${join(ROOT, 'scripts', 'serve.mjs')}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${ROOT}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>LOCKIN_PORT</key>
    <string>${PORT}</string>
  </dict>

  <!-- Start at login, and restart if it ever exits. -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <!-- Don't spin if it fails to bind: back off and try again. -->
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>${join(LOG_DIR, 'server.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(LOG_DIR, 'server.error.log')}</string>
</dict>
</plist>
`;
}

const uid = process.getuid();
const target = `gui/${uid}`;

function launchctl(args, { check = false } = {}) {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  if (check && result.status !== 0) {
    throw new Error(`launchctl ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result;
}

function isLoaded() {
  return launchctl(['print', `${target}/${LABEL}`]).status === 0;
}

function unload() {
  // `bootout` is the modern form; the older `unload` is kept as a fallback for
  // the case where the job was registered by an older macOS.
  if (isLoaded()) launchctl(['bootout', `${target}/${LABEL}`]);
  if (existsSync(PLIST)) launchctl(['unload', PLIST]);
}

function install() {
  console.log('Building the site…');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });

  mkdirSync(AGENTS, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  // Replacing cleanly rather than layering a second copy on top.
  unload();
  writeFileSync(PLIST, plist());
  launchctl(['bootstrap', target, PLIST], { check: true });
  launchctl(['enable', `${target}/${LABEL}`]);
  launchctl(['kickstart', '-k', `${target}/${LABEL}`]);

  console.log(`\nLockIn will now start at login and stay up.`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\nRemove it any time with:  npm run service:uninstall`);
}

function uninstall() {
  unload();
  rmSync(PLIST, { force: true });
  console.log('Removed. LockIn will no longer start at login.');
  console.log(`Your data is untouched — it lives in the browser, not the server.`);
}

async function status() {
  const loaded = isLoaded();
  console.log(`login service: ${loaded ? 'installed' : 'not installed'}`);
  if (existsSync(PLIST)) console.log(`plist:         ${PLIST}`);

  let reachable = false;
  try {
    const response = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(3000) });
    reachable = response.ok;
  } catch {
    reachable = false;
  }
  console.log(`http://localhost:${PORT}: ${reachable ? 'responding' : 'not responding'}`);

  const errorLog = join(LOG_DIR, 'server.error.log');
  if (!reachable && existsSync(errorLog)) {
    const tail = readFileSync(errorLog, 'utf8').trim().split('\n').slice(-5).join('\n');
    if (tail) console.log(`\nlast errors:\n${tail}`);
  }
}

function restart() {
  console.log('Rebuilding…');
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  launchctl(['kickstart', '-k', `${target}/${LABEL}`], { check: true });
  console.log('Restarted with the new build.');
}

const command = process.argv[2];
if (command === 'install') install();
else if (command === 'uninstall') uninstall();
else if (command === 'restart') restart();
else if (command === 'status') await status();
else {
  console.error('Usage: node scripts/service.mjs <install|uninstall|status|restart>');
  process.exit(1);
}
