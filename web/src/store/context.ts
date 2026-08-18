import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { AppState } from '../types';
import type { Action } from './reducer';
import type { ConnectionStatus } from '../lib/extensionBridge';
import type { ExtensionCompatibility } from '../lib/protocol';
import type { StorageRecovery } from '../lib/storage';

export interface ExtensionView {
  status: ConnectionStatus;
  version?: string;
  /** Message-schema version the installed extension reported. */
  protocolVersion?: number;
  /** Whether that version can talk to this build of the site. */
  compatibility: ExtensionCompatibility;
  /**
   * True when the extension has answered on this device at some point.
   *
   * It is what separates "Browser Protection isn't installed" from "Browser
   * Protection has stopped responding" — two states that need different words,
   * especially while Focus Mode is running and the student believes sites are
   * being blocked.
   */
  everConnected: boolean;
  /** Re-pings the extension and returns whether it answered. */
  test: () => Promise<boolean>;
  /** Pushes current state immediately (used after critical changes). */
  sync: () => Promise<boolean>;
  lastSyncedAt: number | null;
}

export interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  extension: ExtensionView;
  /** Wall clock that ticks once a second, for countdowns. */
  now: number;
  /**
   * Set when this session's load had to repair or discard stored records
   * (Phase 8). Null the rest of the time, which is almost always.
   */
  recovery: StorageRecovery | null;
  dismissRecovery: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
