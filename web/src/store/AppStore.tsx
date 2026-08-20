/**
 * Wires the pure reducer to the outside world:
 *   - localStorage persistence (versioned, see lib/storage.ts)
 *   - cross-tab sync via BroadcastChannel, with a `storage` event fallback
 *   - the Chrome extension bridge
 *   - a 1s clock so countdowns and expiry are driven by real time
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { reducer } from './reducer';
import type { Action } from './reducer';
import { AppContext } from './context';
import type { AppContextValue } from './context';
import { isSignificantRecovery, load, loadWithRecovery, save } from '../lib/storage';
import type { StorageRecovery } from '../lib/storage';
import type { AppState } from '../types';
import { bridge } from '../lib/extensionBridge';
import type { ConnectionStatus } from '../lib/extensionBridge';
import { MSG, checkCompatibility } from '../lib/protocol';
import { toBridgeState } from '../lib/selectors';
import { canvasProvider, sanitizeView } from '../lib/canvas/pageProvider';
import { applyCanvasView } from '../lib/canvas/reconcile';
import { setServiceCheckWindow } from '../lib/canvas/serviceFeed';
import { buildReminderSchedule, scheduleKey } from '../lib/reminderSchedule';

const CHANNEL_NAME = 'lockin-sync';
const PING_INTERVAL_MS = 15_000;

/** Identifies this tab so it ignores its own broadcasts. */
const TAB_ID = Math.random().toString(36).slice(2);

/**
 * Reads storage exactly once, keeping the repair report alongside the state.
 *
 * `useReducer`'s initialiser can run twice under StrictMode, so the report is
 * captured here rather than in a ref that the second run would clobber.
 */
const initial = (() => {
  const { state, recovery } = loadWithRecovery();
  return { state, recovery };
})();

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initial.state);
  const [recovery, setRecovery] = useState<StorageRecovery | null>(() =>
    isSignificantRecovery(initial.recovery) ? initial.recovery : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const [extStatus, setExtStatus] = useState<ConnectionStatus>('checking');
  const [extVersion, setExtVersion] = useState<string | undefined>();
  const [extProtocol, setExtProtocol] = useState<number | undefined>();
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const channelRef = useRef<BroadcastChannel | null>(null);
  /** Set while applying a remote state so we don't echo it back. */
  const applyingRemote = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  /* ---------------- cross-tab sync ---------------- */

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const data = event.data as { tabId?: string; state?: AppState } | null;
      if (!data || data.tabId === TAB_ID || !data.state) return;
      applyingRemote.current = true;
      rawDispatch({ type: 'REPLACE', state: data.state });
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // Fallback for browsers without BroadcastChannel, and for tabs that were
  // backgrounded while the channel message was posted.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'lockin.state.v1' || !event.newValue) return;
      applyingRemote.current = true;
      rawDispatch({ type: 'REPLACE', state: load() });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    if (applyingRemote.current) {
      // Came from another tab; it already persisted and broadcast.
      applyingRemote.current = false;
      return;
    }
    save(state);
    channelRef.current?.postMessage({ tabId: TAB_ID, state });
  }, [state]);

  /* ---------------- clock ---------------- */

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      rawDispatch({ type: 'TICK', now: t });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  /* ---------------- extension bridge ---------------- */

  useEffect(() => {
    bridge.start();
    return () => bridge.stop();
  }, []);

  const syncExtension = useCallback(async () => {
    const ok = await bridge.syncState(toBridgeState(stateRef.current));
    setExtStatus(ok ? 'connected' : 'disconnected');
    if (ok) setLastSyncedAt(Date.now());
    return ok;
  }, []);

  /**
   * The Canvas check window has to exist on the extension's side too.
   *
   * The gate must be able to refuse a reading when no LockIn tab is open — a
   * setting only the page knows about is not a guarantee, it is a hope. The
   * app is the source of truth and pushes a copy whenever it changes.
   */
  const checkWindow = state.settings.canvasCheckWindow;
  useEffect(() => {
    if (extStatus === 'connected') void canvasProvider.setCheckWindow(checkWindow);
    // The local service gets its own copy: it keeps fetching with Chrome
    // closed, so the window has to exist on that side too. Returns false and
    // costs nothing when the service is not installed.
    void setServiceCheckWindow(checkWindow);
  }, [checkWindow, extStatus]);

  /**
   * Records a successful handshake.
   *
   * `extensionSeen` is written once and never cleared: it is the memory that
   * lets a later silence be reported as "stopped responding" rather than
   * "never installed". Writing it only on the transition keeps this out of the
   * 15-second ping loop's way — dispatching every ping would persist state
   * four times a minute for no change.
   */
  const noteHandshake = useCallback((info: { version?: string; protocolVersion?: number }) => {
    setExtVersion(info.version);
    setExtProtocol(info.protocolVersion);
    setExtStatus('connected');
    if (!stateRef.current.settings.extensionSeen) {
      rawDispatch({ type: 'UPDATE_SETTINGS', patch: { extensionSeen: true } });
    }
  }, []);

  const testConnection = useCallback(async () => {
    setExtStatus('checking');
    const info = await bridge.ping();
    if (info) {
      noteHandshake(info);
      await syncExtension();
      return true;
    }
    setExtStatus('disconnected');
    return false;
  }, [noteHandshake, syncExtension]);

  // Initial handshake, then a heartbeat so unplugging the extension shows up.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const info = await bridge.ping();
      if (cancelled) return;
      if (info) {
        noteHandshake(info);
        await syncExtension();
      } else {
        setExtStatus('disconnected');
      }
    };
    void run();
    const id = window.setInterval(run, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [noteHandshake, syncExtension]);

  // Push whenever anything the extension cares about changes.
  const bridgeSignature = JSON.stringify(toBridgeState(state));
  useEffect(() => {
    void syncExtension();
  }, [bridgeSignature, syncExtension]);

  /**
   * Hand the extension the reminder schedule.
   *
   * This is what makes reminders survive the LockIn tab being closed: a page
   * can only run timers while it is alive, so the *deciding* stays here and the
   * *waking up* moves to the service worker's alarm.
   *
   * Rebuilt from state, but only sent when it actually differs — otherwise
   * every keystroke in an assignment title would wake the worker. `now` is
   * excluded from the signature deliberately: the schedule is a list of
   * absolute due times, so the passage of time alone never changes it.
   */
  const schedule = useMemo(() => buildReminderSchedule(state, now), [state, now]);
  const scheduleSignature = scheduleKey(schedule);
  useEffect(() => {
    bridge.post(MSG.REMINDER_SCHEDULE, { items: schedule });
    // `schedule` is intentionally absent: the signature is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSignature]);

  // The extension pushes block counts (aggregate only) back to us.
  useEffect(() => {
    const off = bridge.onPush((env) => {
      if (env.type === MSG.STATS || env.type === MSG.PUSH_STATE) {
        const payload = env.payload as
          | { stats?: { domain: string; count: number; lastBlockedAt: string }[] }
          | undefined;
        if (payload?.stats) rawDispatch({ type: 'SET_BLOCK_STATS', stats: payload.stats });
      }
      /**
       * A Canvas detection changed something. Applying it here — rather than
       * in a page component — means verification lands even if the student is
       * sitting on Settings, and it flows through the same reducer path that
       * ends Focus Mode.
       */
      if (env.type === MSG.CANVAS_PUSH) {
        const view = sanitizeView(env.payload);
        applyCanvasView(rawDispatch, view);
      }
      if (env.type === MSG.ALLOWLIST_REQUEST) {
        const payload = env.payload as { domain?: string } | undefined;
        if (payload?.domain) {
          rawDispatch({
            type: 'LOG',
            eventType: 'allowlist_changed',
            message: `Block page requested school access for ${payload.domain}`,
            meta: { domain: payload.domain },
          });
        }
      }
    });
    return off;
  }, []);

  /**
   * Reconcile Canvas whenever the extension (re)connects.
   *
   * The extension caches detections while the LockIn tab is closed, so this is
   * how a submission made with LockIn shut is not lost — on reopening, the
   * cache is replayed and any verified work completes immediately.
   */
  const canvasConfigured = !!state.canvas.connection;
  useEffect(() => {
    if (extStatus !== 'connected' || !canvasConfigured) return;
    let cancelled = false;
    void (async () => {
      const view = await canvasProvider.getView();
      if (!cancelled) applyCanvasView(rawDispatch, view);
    })();
    return () => {
      cancelled = true;
    };
  }, [extStatus, canvasConfigured]);

  // Poll aggregate block counts while blocking could be happening.
  useEffect(() => {
    if (!state.focusMode.active) return;
    let cancelled = false;
    const pull = async () => {
      const stats = await bridge.getStats();
      if (!cancelled && stats) rawDispatch({ type: 'SET_BLOCK_STATS', stats });
    };
    void pull();
    const id = window.setInterval(pull, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state.focusMode.active]);

  const dispatch = useCallback((action: Action) => rawDispatch(action), []);

  const dismissRecovery = useCallback(() => setRecovery(null), []);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      dispatch,
      now,
      recovery,
      dismissRecovery,
      extension: {
        status: extStatus,
        version: extVersion,
        protocolVersion: extProtocol,
        compatibility: extStatus === 'connected' ? checkCompatibility(extProtocol) : 'ok',
        everConnected: state.settings.extensionSeen || extStatus === 'connected',
        test: testConnection,
        sync: syncExtension,
        lastSyncedAt,
      },
    }),
    [
      state,
      dispatch,
      now,
      recovery,
      dismissRecovery,
      extStatus,
      extVersion,
      extProtocol,
      testConnection,
      syncExtension,
      lastSyncedAt,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
