/**
 * Web-app side of the extension bridge.
 *
 * The page can't talk to the service worker directly, so a content script
 * injected on the LockIn origin relays `window.postMessage` <-> `chrome.runtime`.
 * If the extension isn't installed nothing listens and requests time out — that
 * timeout is exactly how "Not Connected" is detected.
 */
import {
  EXT_SOURCE,
  MSG,
  PROTOCOL_VERSION,
  WEB_SOURCE,
  isEnvelope,
  type BridgeState,
  type Envelope,
  type MessageType,
} from './protocol';

export type ConnectionStatus = 'unknown' | 'checking' | 'connected' | 'disconnected';

export interface ExtensionInfo {
  version?: string;
  protocolVersion?: number;
}

type Listener = (envelope: Envelope) => void;

const REQUEST_TIMEOUT_MS = 1200;

class ExtensionBridge {
  private listeners = new Set<Listener>();
  private pending = new Map<string, (env: Envelope) => void>();
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('message', this.onMessage);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('message', this.onMessage);
  }

  private onMessage = (event: MessageEvent) => {
    // Only same-window messages from our own content script are trusted.
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!isEnvelope(event.data)) return;
    const env = event.data as Envelope;
    if (env.source !== EXT_SOURCE) return;

    if (env.requestId && this.pending.has(env.requestId)) {
      const resolve = this.pending.get(env.requestId)!;
      this.pending.delete(env.requestId);
      resolve(env);
    }
    this.listeners.forEach((l) => l(env));
  };

  onPush(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fire-and-forget send. */
  post(type: MessageType, payload?: unknown, requestId?: string): void {
    const envelope: Envelope = {
      source: WEB_SOURCE,
      version: PROTOCOL_VERSION,
      type,
      requestId,
      payload,
    };
    try {
      window.postMessage(envelope, window.location.origin);
    } catch {
      /* structured-clone failure — payloads here are plain JSON, so this
         should not happen, but never let it break the UI */
    }
  }

  /** Send and await a reply. Resolves null when the extension is absent. */
  request<T = unknown>(
    type: MessageType,
    payload?: unknown,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Envelope<T> | null> {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, timeoutMs);

      this.pending.set(requestId, (env) => {
        window.clearTimeout(timer);
        resolve(env as Envelope<T>);
      });

      this.post(type, payload, requestId);
    });
  }

  async ping(): Promise<ExtensionInfo | null> {
    const reply = await this.request<ExtensionInfo>(MSG.PING);
    if (!reply || reply.type !== MSG.PONG) return null;
    return (reply.payload as ExtensionInfo) ?? {};
  }

  /** Pushes the authoritative state. Returns false if nothing acknowledged. */
  async syncState(state: BridgeState): Promise<boolean> {
    const reply = await this.request(MSG.SYNC_STATE, state);
    return !!reply && reply.type === MSG.STATE_ACK;
  }

  async getStats(): Promise<{ domain: string; count: number; lastBlockedAt: string }[] | null> {
    const reply = await this.request<{ stats: { domain: string; count: number; lastBlockedAt: string }[] }>(
      MSG.GET_STATS,
    );
    if (!reply || reply.type !== MSG.STATS) return null;
    return reply.payload?.stats ?? [];
  }

  async clearStats(): Promise<void> {
    await this.request(MSG.CLEAR_STATS);
  }
}

export const bridge = new ExtensionBridge();
