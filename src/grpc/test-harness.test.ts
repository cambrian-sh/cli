import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import * as grpc from "@grpc/grpc-js";
import { startMockServer, MockServer } from "./test-harness";
import { createOperatorClient, OperatorClient } from "./operator-client";

describe("Mock gRPC Server Harness", () => {
  let mockServer: MockServer;
  let client: OperatorClient;

  beforeAll(async () => {
    mockServer = await startMockServer();
    client = createOperatorClient({ server: `127.0.0.1:${mockServer.port}`, token: "test-token" });
  });

  afterAll(async () => {
    client.close();
    await mockServer.close();
  });

  it("should script responses for a unary call (Login) and record metadata", async () => {
    mockServer.setResponse("Login", { token: "new-token", role: "operator" });
    
    const resp = await client.login({ username: "testuser", password: "pwd" });
    
    expect(resp.token).toBe("new-token");
    expect(resp.role).toBe("operator");

    const calls = mockServer.getCalls("Login");
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    expect(latestCall.request.username).toBe("testuser");
  });

  it("should record authorization headers on authenticated calls", async () => {
    mockServer.setResponse("Snapshot", { as_of_seq: 10 });
    
    await client.snapshot({});
    
    const calls = mockServer.getCalls("Snapshot");
    expect(calls.length).toBeGreaterThan(0);
    
    const latestCall = calls[calls.length - 1];
    const authHeader = latestCall.metadata.get("authorization");
    expect(authHeader).toEqual(["Bearer test-token"]);
  });

  it("should support server-streaming (StreamEvents)", async () => {
    const stream = client.streamEvents({ last_seq: 1 });
    
    const events: any[] = [];
    const done = new Promise<void>((resolve, reject) => {
      stream.on("data", (data) => events.push(data));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    // Wait a tick for the stream to connect and the handler to be registered
    await new Promise((r) => setTimeout(r, 50));

    mockServer.pushEvent({ seq: 2, session_id: "s1" });
    mockServer.pushEvent({ seq: 3, session_id: "s2" });
    mockServer.pushEvent({ seq: 4, session_id: "s3" });
    mockServer.endStream();

    await done;

    expect(events.length).toBe(3);
    expect(events[0].seq).toBe(2);
    expect(events[1].seq).toBe(3);
    expect(events[2].seq).toBe(4);
  });

  it("should support error injection", async () => {
    mockServer.injectError("ResolveHITL", grpc.status.UNAUTHENTICATED, "token rejected");
    
    let error: any = null;
    try {
      await client.resolveHITL({ command_id: "123", reason: "test", intervention_id: "abc", approve: true });
    } catch (e) {
      error = e;
    }
    
    expect(error).not.toBeNull();
    expect(error.code).toBe(grpc.status.UNAUTHENTICATED);
    expect(error.details).toBe("token rejected");
  });
});
