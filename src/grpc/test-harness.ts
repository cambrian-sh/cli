import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CAMBRIAN_PROTO, OPERATOR_PROTO } from "../proto-embed";

// We only want to write the temp files once per process to avoid duplicate temp-file logic overhead
let tempProtoDir: string | null = null;

function writeProtosTempFiles(): string {
  if (tempProtoDir) return tempProtoDir;
  tempProtoDir = mkdtempSync(resolve(tmpdir(), "cambrian-test-proto-"));
  
  const agentPath = resolve(tempProtoDir, "cambrian.proto");
  writeFileSync(agentPath, CAMBRIAN_PROTO, "utf-8");
  
  const operatorPath = resolve(tempProtoDir, "operator.proto");
  writeFileSync(operatorPath, OPERATOR_PROTO, "utf-8");
  
  return tempProtoDir;
}

export interface CallRecord {
  method: string;
  request: any;
  metadata: grpc.Metadata;
}

export interface MockServer {
  port: number;
  setResponse: (rpc: string, response: any) => void;
  pushEvent: (event: any) => void;
  endStream: () => void;
  injectError: (rpc: string, code: grpc.status, message: string) => void;
  getCalls: (rpc?: string) => CallRecord[];
  clearCalls: () => void;
  clearResponses: () => void;
  close: () => Promise<void>;
}

export async function startMockServer(): Promise<MockServer> {
  const tempDir = writeProtosTempFiles();
  
  const packageDefAll = protoLoader.loadSync(
    [resolve(tempDir, "cambrian.proto"), resolve(tempDir, "operator.proto")],
    {
      keepCase: false,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    }
  );
  
  const protoAll = grpc.loadPackageDefinition(packageDefAll) as any;

  const server = new grpc.Server();
  
  const calls: CallRecord[] = [];
  const responses = new Map<string, any[]>();
  const errors = new Map<string, {code: grpc.status, message: string}[]>();
  
  let currentStream: grpc.ServerWritableStream<any, any> | null = null;

  const createHandler = (method: string) => {
    return (call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) => {
      calls.push({ method, request: call.request, metadata: call.metadata });
      try {
        const errs = errors.get(method);
        if (errs && errs.length > 0) {
          const errInfo = errs.shift()!;
          const err: grpc.ServiceError = new Error(errInfo.message) as any;
          err.code = errInfo.code;
          err.details = errInfo.message;
          callback(err, null);
          return;
        }
        
        const resps = responses.get(method);
        if (resps && resps.length > 0) {
          callback(null, resps.shift());
        } else {
          callback(null, {}); // Default empty
        }
      } catch (e: any) {
        callback(e, null);
      }
    };
  };

  const createStreamHandler = (method: string) => {
    return (call: grpc.ServerWritableStream<any, any>) => {
      calls.push({ method, request: call.request, metadata: call.metadata });
      const errs = errors.get(method);
      if (errs && errs.length > 0) {
          const errInfo = errs.shift()!;
          const err: grpc.ServiceError = new Error(errInfo.message) as any;
          err.code = errInfo.code;
          err.details = errInfo.message;
          call.emit('error', err);
          return;
      }

      currentStream = call;
      // We don't automatically end the stream so pushEvent can be used
    };
  };

  const addMethods = (serviceObject: any) => {
    if (!serviceObject) return;
    const methods: Record<string, grpc.UntypedHandleCall> = {};
    for (const methodName of Object.keys(serviceObject)) {
      const serviceDef = serviceObject[methodName];
      if (!serviceDef.requestStream && !serviceDef.responseStream) {
        methods[methodName] = createHandler(methodName) as grpc.UntypedHandleCall;
      } else if (!serviceDef.requestStream && serviceDef.responseStream) {
        methods[methodName] = createStreamHandler(methodName) as grpc.UntypedHandleCall;
      }
    }
    server.addService(serviceObject, methods);
  };

  if (protoAll.cambrian?.OperatorConsole?.service) {
    addMethods(protoAll.cambrian.OperatorConsole.service);
  }
  if (protoAll.cambrian?.Orchestrator?.service) {
    addMethods(protoAll.cambrian.Orchestrator.service);
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      "0.0.0.0:0",
      grpc.ServerCredentials.createInsecure(),
      (err, port) => {
        if (err) reject(err);
        else resolve(port);
      }
    );
  });
  
  server.start();
  
  return {
    port,
    setResponse: (rpc: string, response: any) => {
      if (!responses.has(rpc)) responses.set(rpc, []);
      responses.get(rpc)!.push(response);
    },
    pushEvent: (event: any) => {
      if (!currentStream) throw new Error("No active stream");
      currentStream.write(event);
    },
    endStream: () => {
      if (currentStream) {
        currentStream.end();
        currentStream = null;
      }
    },
    injectError: (rpc: string, code: grpc.status, message: string) => {
      if (!errors.has(rpc)) errors.set(rpc, []);
      errors.get(rpc)!.push({ code, message });
    },
    getCalls: (rpc?: string) => {
      if (rpc) return calls.filter((c) => c.method === rpc);
      return calls;
    },
    clearCalls: () => {
      calls.length = 0;
    },
    clearResponses: () => {
      responses.clear();
      errors.clear();
    },
    close: () => {
      return new Promise<void>((resolve, reject) => {
        // tryShutdown fails sometimes if streams are active, force shutdown fallback if needed
        server.tryShutdown((err) => {
          if (err) {
             server.forceShutdown();
          }
          resolve();
        });
      });
    },
  };
}
