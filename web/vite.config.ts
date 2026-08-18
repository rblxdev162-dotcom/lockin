import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `public/fixtures/` holds the Edgenuity test images the dev-only fixture
 * capture source loads. Vite copies `public/` verbatim, so without this they
 * would be served from the production site — harmless in themselves (they
 * cannot produce a verified result) but they are test data on a student's
 * device, and shipping test data by accident is how test bypasses ship next.
 */
function dropDevOnlyAssets() {
  return {
    name: 'lockin-drop-dev-only-assets',
    apply: 'build' as const,
    closeBundle() {
      rmSync(resolve(import.meta.dirname, 'dist/fixtures'), { recursive: true, force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), dropDevOnlyAssets()],
  server: {
    // Fixed port in development: the extension's committed content-script match
    // list and origin allowlist are generated for http://localhost:5173 (see
    // lockin.config.json). A production origin is supplied at package time.
    port: 5173,
    strictPort: true,
  },
  preview: {
    // `npm run preview` serves the real production build. It gets its own port
    // so a production-build test can never be satisfied by a dev server that
    // happens to be running.
    port: 4173,
    strictPort: true,
  },
})
