import type * as grpc from "@grpc/grpc-js";
import type { OperatorClient } from "./operator-client";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_JITTER = 0.2;
const MAX_ATTEMPTS = 5;
const INTER_EVENT_TIMEOUT_MS = 60000;

export interface OpenOperatorEventStreamOptions {
  lastSeq?: number;
  onEvent: (event: any) => void;
  onError?: (err: Error) => void;
}

export interface OperatorEventStreamHandle {
  close(): void;
}

export function openOperatorEventStream(
  client: OperatorClient,
  opts: OpenOperatorEventStreamOptions
): OperatorEventStreamHandle {
  let attempt = 0;
  let closed = false;
  let currentCall: grpc.ClientReadableStream<any> | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let interEventTimer: NodeJS.Timeout | null = null;

  function scheduleReconnect() {
    if (closed) return;
    if (attempt >= MAX_ATTEMPTS) {
      opts.onError?.(new Error("kernel unreachable after max attempts"));
      return;
    }
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    const jitter = base * (1 - RECONNECT_JITTER + Math.random() * RECONNECT_JITTER * 2);
    const delay = Math.round(jitter);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      subscribe();
    }, delay);
  }

  function resetInterEventTimer() {
    if (interEventTimer) clearTimeout(interEventTimer);
    interEventTimer = setTimeout(() => {
      currentCall?.cancel?.();
      scheduleReconnect();
    }, INTER_EVENT_TIMEOUT_MS);
  }

  function subscribe() {
    if (closed) return;
    try {
      currentCall = client.streamEvents({ last_seq: opts.lastSeq ?? 0 });
    } catch (err) {
      scheduleReconnect();
      return;
    }
    resetInterEventTimer();
    currentCall.on("data", (event: any) => {
      attempt = 0;
      resetInterEventTimer();
      try {
        opts.onEvent(event);
      } catch { /* swallow handler errors */ }
    });
    currentCall.on("error", (err: Error) => {
      if (interEventTimer) clearTimeout(interEventTimer);
      if (!closed) scheduleReconnect();
    });
    currentCall.on("end", () => {
      if (interEventTimer) clearTimeout(interEventTimer);
      if (!closed) scheduleReconnect();
    });
  }

  subscribe();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (interEventTimer) clearTimeout(interEventTimer);
      currentCall?.cancel?.();
    },
  };
}
