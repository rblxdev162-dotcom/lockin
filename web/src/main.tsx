import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AppProvider } from './store/AppStore.tsx'
import { ErrorBoundary } from './components/layout/ErrorBoundary.tsx'

/**
 * Developer conveniences, and nothing else, live behind this guard.
 *
 * `import.meta.env.DEV` is replaced with `false` when Vite builds for
 * production, so the whole branch — and the module it imports — is eliminated
 * rather than shipped and merely hidden. There is no production UI, and no
 * production code path, that can reach a seeded profile.
 */
if (import.meta.env.DEV) {
  void import('./lib/devSeed.ts').then((m) => m.installDevSeed())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
