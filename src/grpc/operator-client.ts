// gRPC client for the operator-plane OperatorConsole service (ADR-0047).
// Parallel to client.ts (which wraps the agent-plane Orchestrator).
//
// Auth: `authorization: Bearer <token>` on every authenticated call.
// Login is the only unauthenticated RPC. ADR-0047 D13.

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { OPERATOR_PROTO } from "../proto-embed";
import type * as T from "../cambrian-types";

function writeOperatorProtoTempFile(): string {
  const tempDir = mkdtempSync(resolve(tmpdir(), "cambrian-operator-proto-"));
  const protoPath = resolve(tempDir, "operator.proto");
  writeFileSync(protoPath, OPERATOR_PROTO, "utf-8");
  return protoPath;
}

export interface OperatorClient {
  // Auth
  login(req: T.LoginRequest): Promise<T.LoginResponse>;

  // Reads (any authenticated role)
  snapshot(req: T.SnapshotRequest): Promise<T.SnapshotResponse>;
  streamEvents(
    req: T.SubscribeRequest
  ): grpc.ClientReadableStream<any>;
  queryAudit(req: T.QueryAuditRequest): Promise<T.QueryAuditResponse>;

  // Mutations (Operator-only, all return CommandAck)
  resolveHITL(req: T.ResolveHITLRequest): Promise<T.CommandAck>;
  setToolGrant(req: T.SetToolGrantRequest): Promise<T.CommandAck>;
  pauseSession(req: T.SessionCommandRequest): Promise<T.CommandAck>;
  resumeSession(req: T.SessionCommandRequest): Promise<T.CommandAck>;
  tagMemory(req: T.TagMemoryRequest): Promise<T.CommandAck>;
  setScope(req: T.SetScopeRequest): Promise<T.CommandAck>;
  registerSkill(req: T.RegisterSkillRequest): Promise<T.CommandAck>;
  registerMCP(req: T.RegisterMCPRequest): Promise<T.CommandAck>;
  triggerConsolidation(
    req: T.TriggerConsolidationRequest
  ): Promise<T.CommandAck>;

  // Chat & steer
  createSession(
    req: T.CreateSessionRequest
  ): Promise<T.CreateSessionResponse>;
  sendMessage(req: T.SendMessageRequest): Promise<T.CommandAck>;
  injectCorrection(
    req: T.InjectCorrectionRequest
  ): Promise<T.CommandAck>;

  // Lifecycle
  getChannel(): grpc.Channel;
  close(): void;
}

function promisifyUnary<Req, Res>(
  client: grpc.Client,
  method: string,
  request: Req,
  metadata: grpc.Metadata,
  deadlineMs: number
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${deadlineMs}ms`));
    }, deadlineMs);
    (client as any)[method](request, metadata, (err: grpc.ServiceError | null, res: Res) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(res);
    });
  });
}

const CONNECT_TIMEOUT_MS = 5000;
const UNARY_DEADLINE_MS = 15000;

export interface OperatorClientConfig {
  server: string;
  token?: string;
}

export function createOperatorClient(cfg: OperatorClientConfig): OperatorClient {
  const protoPath = writeOperatorProtoTempFile();
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const operatorConsole = proto.cambrian?.OperatorConsole;

  if (!operatorConsole) {
    throw new Error(
      "Failed to load cambrian.OperatorConsole service from embedded proto"
    );
  }

  const channelCreds = grpc.credentials.createInsecure();
  const client = new operatorConsole(cfg.server, channelCreds, {
    "grpc.connect_timeout_ms": CONNECT_TIMEOUT_MS,
  });

  function authedMetadata(): grpc.Metadata {
    if (!cfg.token) {
      throw new Error(
        "Operator-plane call requires an auth token. Run `cambrian login` or pass --token."
      );
    }
    const md = new grpc.Metadata();
    md.set("authorization", `Bearer ${cfg.token}`);
    return md;
  }

  function unauthedMetadata(): grpc.Metadata {
    return new grpc.Metadata();
  }

  let closed = false;

  return {
    async login(req: T.LoginRequest) {
      return promisifyUnary<T.LoginRequest, T.LoginResponse>(
        client,
        "Login",
        req,
        unauthedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async snapshot(req: T.SnapshotRequest) {
      return promisifyUnary<T.SnapshotRequest, T.SnapshotResponse>(
        client,
        "Snapshot",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    streamEvents(req: T.SubscribeRequest) {
      const call = client.StreamEvents(req, authedMetadata());
      return call as grpc.ClientReadableStream<any>;
    },

    async queryAudit(req: T.QueryAuditRequest) {
      return promisifyUnary<T.QueryAuditRequest, T.QueryAuditResponse>(
        client,
        "QueryAudit",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async resolveHITL(req: T.ResolveHITLRequest) {
      return promisifyUnary<T.ResolveHITLRequest, T.CommandAck>(
        client,
        "ResolveHITL",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async setToolGrant(req: T.SetToolGrantRequest) {
      return promisifyUnary<T.SetToolGrantRequest, T.CommandAck>(
        client,
        "SetToolGrant",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async pauseSession(req: T.SessionCommandRequest) {
      return promisifyUnary<T.SessionCommandRequest, T.CommandAck>(
        client,
        "PauseSession",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async resumeSession(req: T.SessionCommandRequest) {
      return promisifyUnary<T.SessionCommandRequest, T.CommandAck>(
        client,
        "ResumeSession",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async tagMemory(req: T.TagMemoryRequest) {
      return promisifyUnary<T.TagMemoryRequest, T.CommandAck>(
        client,
        "TagMemory",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async setScope(req: T.SetScopeRequest) {
      return promisifyUnary<T.SetScopeRequest, T.CommandAck>(
        client,
        "SetScope",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async registerSkill(req: T.RegisterSkillRequest) {
      return promisifyUnary<T.RegisterSkillRequest, T.CommandAck>(
        client,
        "RegisterSkill",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async registerMCP(req: T.RegisterMCPRequest) {
      return promisifyUnary<T.RegisterMCPRequest, T.CommandAck>(
        client,
        "RegisterMCP",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async triggerConsolidation(req: T.TriggerConsolidationRequest) {
      return promisifyUnary<T.TriggerConsolidationRequest, T.CommandAck>(
        client,
        "TriggerConsolidation",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async createSession(req: T.CreateSessionRequest) {
      return promisifyUnary<T.CreateSessionRequest, T.CreateSessionResponse>(
        client,
        "CreateSession",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async sendMessage(req: T.SendMessageRequest) {
      return promisifyUnary<T.SendMessageRequest, T.CommandAck>(
        client,
        "SendMessage",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    async injectCorrection(req: T.InjectCorrectionRequest) {
      return promisifyUnary<T.InjectCorrectionRequest, T.CommandAck>(
        client,
        "InjectCorrection",
        req,
        authedMetadata(),
        UNARY_DEADLINE_MS
      );
    },

    getChannel() {
      return client.getChannel();
    },

    close() {
      if (closed) return;
      closed = true;
      client.close();
    },
  };
}

export type { T };
