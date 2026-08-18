/**
 * Shared Chrome-for-Testing lifecycle helpers.
 *
 * Extracted after a real bug bit the suites: `child.kill('SIGTERM')` only
 * signals the launcher, leaving Chrome's own process tree alive and still
 * holding the debug port. A later run would then attach to the *previous*
 * browser — stale extension code, stale storage, confusing failures.
 *
 * So: launch detached (own process group), kill the whole group, and refuse to
 * start until the port is genuinely free.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function findChrome() {
  return (
    process.env.CHROME_BIN ||
    [
      join(
        process.env.HOME || '',
        'chrome/mac_arm-152.0.7977.42/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      ),
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].find((p) => existsSync(p)) ||
    null
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves true when nothing is listening on `port`. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Waits for a port to free up, then returns it. Throws rather than silently
 * attaching to somebody else's browser.
 */
export async function requirePortFree(port, label = 'debug port') {
  for (let i = 0; i < 20; i++) {
    if (await isPortFree(port)) return port;
    await sleep(500);
  }
  throw new Error(
    `${label} ${port} is still in use. A previous Chrome may be stuck — ` +
      `run: pkill -f "Chrome for Testing"`,
  );
}

/** Spawns Chrome in its own process group so the whole tree can be killed. */
export function launchChrome(binary, args) {
  return spawn(binary, args, { stdio: 'ignore', detached: true });
}

/**
 * Kills the entire Chrome process tree and waits for the port to clear.
 *
 * Chrome re-parents its helper processes, so signalling the process group is
 * not always enough — leftovers keep the debug port open and the *next* run
 * silently attaches to a stale browser. `profileDir` gives a precise last
 * resort: the throwaway --user-data-dir is unique per run, so matching on it
 * can only ever hit the Chrome this harness started.
 */
export async function killChrome(child, port, profileDir) {
  if (!child && !profileDir) return;

  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (child) {
      try {
        // Negative pid targets the process group created by `detached: true`.
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    }
    await sleep(signal === 'SIGTERM' ? 700 : 300);
    if (!port || (await isPortFree(port))) return;
  }

  if (profileDir) {
    try {
      execFileSync('pkill', ['-f', profileDir], { stdio: 'ignore' });
    } catch {
      /* pkill exits non-zero when nothing matched — fine */
    }
    await sleep(600);
  }
}
