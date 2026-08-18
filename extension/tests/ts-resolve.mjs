/**
 * Lets `node --test` import the website's TypeScript modules directly.
 *
 * Node 24 strips types on its own, but it still requires explicit file
 * extensions in ESM specifiers, while the web app (bundled by Vite) writes
 * `./similarity` and `../../types/edgenuity`. This resolver hook fills that
 * gap so the Phase 4 tests exercise the *shipping* parser and verification
 * policy rather than a copy that could drift.
 *
 * Register with: node --import ./extension/tests/ts-resolve.mjs --test ...
 */
import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Only extensionless relative specifiers get a second chance.
    if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error;
    const parent = context.parentURL ?? pathToFileURL(`${process.cwd()}/`).href;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      const url = new URL(candidate, parent);
      if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
    }
    throw error;
  }
}

// Registering from inside the module keeps callers to a single --import flag.
if (!process.env.LOCKIN_TS_RESOLVE_REGISTERED) {
  process.env.LOCKIN_TS_RESOLVE_REGISTERED = '1';
  register(import.meta.url);
}
