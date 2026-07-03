import { startMockServer } from "./src/grpc/test-harness";
import { spawnSync } from "node:child_process";

async function main() {
  const server = await startMockServer();
  server.setResponse("Login", { token: "123", role: "operator" });
  
  console.log("Server listening on", server.port);
  
  const res = spawnSync("bun", ["run", "src/index.tsx", "login", "--username", "alice", "--password", "secret"], {
    env: { ...process.env, CAMBRIAN_SERVER: `127.0.0.1:${server.port}` },
    encoding: "utf-8"
  });
  
  console.log("Exit code:", res.status);
  console.log("Stdout:", res.stdout);
  console.log("Stderr:", res.stderr);
  
  console.log("Calls received:", server.getCalls());
  
  await server.close();
}

main().catch(console.error);
