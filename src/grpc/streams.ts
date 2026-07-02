// Stream lifecycle management for server-streaming RPCs.
// Handles auto-reconnect with exponential backoff.

import * as grpc from "@grpc/grpc-js";
import type { CambrianClient } from "./client";
import type * as T from "../cambrian-types";

export type StreamState = "connecting" | "connected" | "disconnected" | "error";

export interface StreamHandle<T> {
  onData: (msg: T) => void;
  onError: (err: Error) => void;
  onStateChange: (state: StreamState) => void;
}

const MAX_BACKOFF_MS = 16_000;
const INITIAL_BACKOFF_MS = 1_000;

export function openApprovalStream(
  client: CambrianClient,
  handle: StreamHandle<T.ApprovalRequest>
): () => void {
  let stream: grpc.ClientReadableStream<T.ApprovalRequest> | null = null;
  let cancelled = false;
  let backoffMs = INITIAL_BACKOFF_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  handle.onStateChange("connecting");

  function connect() {
    if (cancelled) return;

    const req: T.WatchApprovalsRequest = {};
    stream = client.watchApprovals(req);

    stream.on("data", (msg: T.ApprovalRequest) => {
      backoffMs = INITIAL_BACKOFF_MS;
      handle.onStateChange("connected");
      handle.onData(msg);
    });

    stream.on("error", (err: Error) => {
      handle.onStateChange("error");
      handle.onError(err);
      stream?.destroy();
      scheduleRetry();
    });

    stream.on("end", () => {
      handle.onStateChange("disconnected");
      stream?.destroy();
      scheduleRetry();
    });

    stream.on("status", (status: grpc.StatusObject) => {
      if (status.code === grpc.status.OK) {
        // Normal end, don't reconnect
      }
    });
  }

  function scheduleRetry() {
    if (cancelled) return;
    handle.onStateChange("connecting");
    retryTimer = setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      connect();
    }, backoffMs);
  }

  connect();

  return () => {
    cancelled = true;
    if (retryTimer) clearTimeout(retryTimer);
    stream?.destroy();
    handle.onStateChange("disconnected");
  };
}
