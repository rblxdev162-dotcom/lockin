/**
 * The version LockIn shows in Settings → About and stamps on exports.
 *
 * Deliberately a plain constant rather than a build-time `define`: the value
 * has to be identical in three places — this file, `package.json` and
 * `extension/manifest.json` — and a constant can be checked by a test that
 * runs in Node with no bundler. `extension/tests/release.test.mjs` fails the
 * build if the three ever drift.
 *
 * Bump all three together, and add a CHANGELOG.md entry in the same change.
 */
export const APP_VERSION = '1.3.0';
