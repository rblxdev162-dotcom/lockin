/**
 * Two boundaries, two jobs.
 *
 * `ErrorBoundary` wraps the whole app: if the store or the router itself
 * throws there is nothing left to render, so it offers a reload and a
 * destructive reset.
 *
 * `RouteErrorBoundary` wraps one page inside the shell. A crash on the
 * Planner must not cost a student their navigation, their Focus Mode banner or
 * their emergency exit — so the page is replaced and everything around it
 * keeps working. "Try again" re-mounts the page, which is enough whenever the
 * cause was transient state rather than bad stored data.
 *
 * Neither reports anything anywhere. Technical detail goes to the console in
 * development only; there is no Sentry, no telemetry, and nothing leaves the
 * device.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { clearAll } from '../../lib/storage';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('LockIn crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-950 p-6 text-slate-100">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-400">
            LockIn hit an unexpected error. Your data is still saved on this device.
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-flame-400">
              {this.state.error.message}
            </pre>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
              onClick={() => window.location.reload()}
            >
              Reload LockIn
            </button>
            <button
              className="flex-1 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300"
              onClick={() => {
                if (confirm('Erase all LockIn data on this device? This cannot be undone.')) {
                  clearAll();
                  window.location.href = '/';
                }
              }}
            >
              Reset local data
            </button>
          </div>
        </div>
      </div>
    );
  }
}

interface RouteState extends State {
  /** Bumped by "Try again" to force a fresh mount of the wrapped page. */
  attempt: number;
}

export class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteState> {
  state: RouteState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<RouteState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error('LockIn page crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return <div key={this.state.attempt}>{this.props.children}</div>;
    }
    return (
      <div className="lk-card p-7 text-center">
        <h1 className="text-xl font-extrabold tracking-tight lk-strong">Something went wrong</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed lk-muted">
          This page couldn’t be displayed. Nothing was lost — your assignments, plan and history
          are still saved on this device, and the rest of LockIn still works.
        </p>
        {import.meta.env.DEV && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl lk-sunken p-3 text-left text-xs text-flame-500">
            {this.state.error.message}
          </pre>
        )}
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
            onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
          >
            Try again
          </button>
          <button
            className="rounded-xl border lk-border px-5 py-2.5 text-sm font-semibold lk-strong"
            onClick={() => {
              window.location.href = '/home';
            }}
          >
            Return home
          </button>
        </div>
      </div>
    );
  }
}
