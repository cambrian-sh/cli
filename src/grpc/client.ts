// gRPC client wrapper with typed methods.
// Uses @grpc/proto-loader with embedded proto (no runtime fs dependency).

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CAMBRIAN_PROTO } from "../proto-embed";
import type * as T from "../cambrian-types";
import type { Config } from "../config";

function writeProtoTempFile(): string {
  const tempDir = mkdtempSync(resolve(tmpdir(), "cambrian-proto-"));
  const protoPath = resolve(tempDir, "cambrian.proto");
  writeFileSync(protoPath, CAMBRIAN_PROTO, "utf-8");
  return protoPath;
}

export interface CambrianClient {
  watchApprovals(
    req: T.WatchApprovalsRequest
  ): grpc.ClientReadableStream<T.ApprovalRequest>;
  submitApprovalDecision(
    req: T.ApprovalDecisionRequest
  ): Promise<T.ApprovalDecisionResponse>;
  listTools(
    req: T.ListToolsRequest,
    extraMetadata?: Record<string, string>
  ): Promise<T.ListToolsResponse>;
  listSkills(
    req: T.ListSkillsRequest,
    extraMetadata?: Record<string, string>
  ): Promise<T.ListSkillsResponse>;
  listWatches(req: T.ListWatchesRequest): Promise<T.ListWatchesResponse>;
  registerWatch(req: T.RegisterWatchRequest): Promise<T.RegisterWatchResponse>;
  deleteWatch(req: T.DeleteWatchRequest): Promise<T.DeleteWatchResponse>;
  setWatchActive(req: T.SetWatchActiveRequest): Promise<T.SetWatchActiveResponse>;
  queryMemory(req: T.MemoryRequest): Promise<T.MemoryResponse>;
  ingestMemory(req: T.IngestMemoryRequest): Promise<T.IngestMemoryResponse>;
  executeTool(req: T.ExecuteToolRequest): Promise<T.ExecuteToolResponse>;
  getChannel(): grpc.Channel;
  close(): void;
}

function promisifyUnary<Req, Res>(
  client: grpc.Client,
  method: string,
  request: Req,
  metadata: grpc.Metadata,
  deadlineMs: number,
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

export function createClient(cfg: Config): CambrianClient {
  const protoPath = writeProtoTempFile();
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as any;
  const orchestrator = proto.cambrian?.Orchestrator;

  if (!orchestrator) {
    throw new Error(
      'Failed to load cambrian.Orchestrator service from embedded proto'
    );
  }

  const channelCreds = grpc.credentials.createInsecure();
  const client = new orchestrator(cfg.server, channelCreds, {
    "grpc.connect_timeout_ms": CONNECT_TIMEOUT_MS,
  });

  const baseMetadata = new grpc.Metadata();
  baseMetadata.set("x-agent-id", cfg.operatorId);

  function metadata(): grpc.Metadata {
    const md = new grpc.Metadata();
    md.set("x-agent-id", cfg.operatorId);
    return md;
  }

  let closed = false;

  return {
    watchApprovals(req: T.WatchApprovalsRequest) {
      const call = client.WatchApprovals(req, metadata());
      return call as grpc.ClientReadableStream<T.ApprovalRequest>;
    },

    async submitApprovalDecision(req: T.ApprovalDecisionRequest) {
      return promisifyUnary<T.ApprovalDecisionRequest, T.ApprovalDecisionResponse>(
        client,
        "SubmitApprovalDecision",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async listTools(
      req: T.ListToolsRequest,
      extraMetadata?: Record<string, string>
    ) {
      const md = metadata();
      if (extraMetadata) {
        for (const [k, v] of Object.entries(extraMetadata)) {
          md.set(k, v);
        }
      }
      return promisifyUnary<T.ListToolsRequest, T.ListToolsResponse>(
        client,
        "ListTools",
        req,
        md,
        UNARY_DEADLINE_MS
      );
    },

    async listSkills(
      req: T.ListSkillsRequest,
      extraMetadata?: Record<string, string>
    ) {
      const md = metadata();
      if (extraMetadata) {
        for (const [k, v] of Object.entries(extraMetadata)) {
          md.set(k, v);
        }
      }
      return promisifyUnary<T.ListSkillsRequest, T.ListSkillsResponse>(
        client,
        "ListSkills",
        req,
        md,
        UNARY_DEADLINE_MS
      );
    },

    async listWatches(req: T.ListWatchesRequest) {
      return promisifyUnary<T.ListWatchesRequest, T.ListWatchesResponse>(
        client,
        "ListWatches",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async registerWatch(req: T.RegisterWatchRequest) {
      return promisifyUnary<T.RegisterWatchRequest, T.RegisterWatchResponse>(
        client,
        "RegisterWatch",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async deleteWatch(req: T.DeleteWatchRequest) {
      return promisifyUnary<T.DeleteWatchRequest, T.DeleteWatchResponse>(
        client,
        "DeleteWatch",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async setWatchActive(req: T.SetWatchActiveRequest) {
      return promisifyUnary<T.SetWatchActiveRequest, T.SetWatchActiveResponse>(
        client,
        "SetWatchActive",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async queryMemory(req: T.MemoryRequest) {
      return promisifyUnary<T.MemoryRequest, T.MemoryResponse>(
        client,
        "QueryMemory",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async ingestMemory(req: T.IngestMemoryRequest) {
      return promisifyUnary<T.IngestMemoryRequest, T.IngestMemoryResponse>(
        client,
        "IngestMemory",
        req,
        metadata(),
        UNARY_DEADLINE_MS
      );
    },

    async executeTool(req: T.ExecuteToolRequest) {
      return promisifyUnary<T.ExecuteToolRequest, T.ExecuteToolResponse>(
        client,
        "ExecuteTool",
        req,
        metadata(),
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
