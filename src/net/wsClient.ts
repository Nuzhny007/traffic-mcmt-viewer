import type { ConnectionStatus, ServerMessage } from '../types/tracking';
import { parseServerMessage } from './protocol';

export interface TrackingSocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus, attempt: number) => void;
}

export interface TrackingSocketOptions {
  url: string;
  handlers: TrackingSocketHandlers;
  /** Reconnect after this much silence, ms. */
  heartbeatTimeoutMs?: number;
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

const DEFAULTS = {
  heartbeatTimeoutMs: 20_000,
  minReconnectDelayMs: 1_000,
  maxReconnectDelayMs: 30_000,
};

/**
 * Resilient JSON WebSocket client.
 *
 * - exponential backoff with jitter on reconnect;
 * - heartbeat watchdog: a silent socket is closed and reconnected;
 * - malformed frames are ignored (throttled warning), never crash the feed.
 */
export class TrackingSocket {
  private readonly url: string;
  private readonly handlers: TrackingSocketHandlers;
  private readonly heartbeatTimeoutMs: number;
  private readonly minReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private stopped = true;
  private lastMessageAt = 0;
  private lastWarnAt = 0;

  constructor(options: TrackingSocketOptions) {
    this.url = options.url;
    this.handlers = options.handlers;
    this.heartbeatTimeoutMs =
      options.heartbeatTimeoutMs ?? DEFAULTS.heartbeatTimeoutMs;
    this.minReconnectDelayMs =
      options.minReconnectDelayMs ?? DEFAULTS.minReconnectDelayMs;
    this.maxReconnectDelayMs =
      options.maxReconnectDelayMs ?? DEFAULTS.maxReconnectDelayMs;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();

    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'client stop');
      }
    }

    this.handlers.onStatus('idle', 0);
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.handlers.onStatus('connecting', this.attempt);

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.handlers.onStatus('open', 0);
      this.startWatchdog();
    };

    ws.onmessage = (event: MessageEvent) => {
      this.lastMessageAt = Date.now();
      if (typeof event.data !== 'string') {
        return;
      }
      const message = parseServerMessage(event.data);
      if (!message) {
        this.warnMalformed();
        return;
      }
      this.handlers.onMessage(message);
    };

    ws.onerror = () => {
      // onclose normally follows; make sure the socket is torn down.
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      this.stopWatchdog();
      if (this.ws === ws) {
        this.ws = null;
      }
      if (this.stopped) {
        return;
      }
      this.handlers.onStatus('closed', this.attempt + 1);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }

    const exponent = Math.min(this.attempt, 5);
    const base = Math.min(
      this.maxReconnectDelayMs,
      this.minReconnectDelayMs * 2 ** exponent,
    );
    const delay = base + Math.random() * 250;
    this.attempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt <= this.heartbeatTimeoutMs) {
        return;
      }
      const ws = this.ws;
      if (ws) {
        try {
          ws.close(4000, 'heartbeat timeout');
        } catch {
          // ignore
        }
      }
    }, 5_000);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopWatchdog();
  }

  private warnMalformed(): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 5_000) {
      return;
    }
    this.lastWarnAt = now;
    console.warn('[ws] ignored malformed message from', this.url);
  }
}
