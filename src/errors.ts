// Clean error display for gRPC + common CLI errors.

const GRPC_STATUS: Record<number, string> = {
  0: "OK",
  1: "CANCELLED",
  2: "UNKNOWN",
  3: "INVALID_ARGUMENT",
  4: "DEADLINE_EXCEEDED",
  5: "NOT_FOUND",
  6: "ALREADY_EXISTS",
  7: "PERMISSION_DENIED",
  8: "RESOURCE_EXHAUSTED",
  9: "FAILED_PRECONDITION",
  10: "ABORTED",
  11: "OUT_OF_RANGE",
  12: "UNIMPLEMENTED",
  13: "INTERNAL",
  14: "UNAVAILABLE",
  15: "DATA_LOSS",
  16: "UNAUTHENTICATED",
};

export function handleConnectionError(err: any, server: string): void {
  if (isGrpcError(err)) {
    const code = err.code ?? 2;
    const name = GRPC_STATUS[code] ?? `UNKNOWN(${code})`;
    console.error(`gRPC error (${name}): ${err.details || err.message}`);

    if (code === 14) {
      console.error(`Could not connect to ${server}.`);
      console.error(`Is the Cambrian orchestrator running?`);
      console.error(`Try: CAMBRIAN_SERVER=<host>:<port> cambrian ...`);
    } else if (code === 4) {
      console.error(`Request timed out. The server may be overloaded.`);
    } else if (code === 5) {
      console.error(`Resource not found on server.`);
    } else if (code === 7) {
      console.error(`Permission denied. Check your operator identity.`);
    }
    return;
  }

  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ECONNREFUSED") {
      console.error(`Connection refused at ${server}.`);
      console.error(`Is the Cambrian orchestrator running on that port?`);
      return;
    }
    if (e.code === "ETIMEDOUT") {
      console.error(`Connection timed out at ${server}.`);
      return;
    }
    if (e.code === "ENOTFOUND") {
      console.error(`Server host not found: ${server}`);
      return;
    }
  }

  console.error(err?.message || String(err));
}

function isGrpcError(err: any): boolean {
  return err && typeof err === "object" && typeof err.code === "number" && err.code >= 0 && err.code <= 16;
}