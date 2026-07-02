# cli-11 — Update `embed-proto.ts` for `operator.proto`

**Status:** TODO
**Parent ADR:** CLI-001
**Depends on:** cli-10
**Blocks:** cli-12
**Estimated effort:** 30 minutes

## Description

Update `cli/scripts/embed-proto.ts` to embed both `cambrian.proto` (agent-plane) and `operator.proto` (operator-plane) as TypeScript string constants. The runtime uses the operator proto for `OperatorConsole` calls.

## Steps

1. Read `cli/scripts/embed-proto.ts` to understand the current single-proto embedding pattern.
2. Update it to read both protos and emit two named exports:
   - `EMBEDDED_AGENT_PROTO` (from `proto/cambrian.proto`)
   - `EMBEDDED_OPERATOR_PROTO` (from `proto/operator.proto`)
3. Run `bun run proto:gen` to regenerate `src/proto-embed.ts`.
4. Verify both exports are present in the generated file.

## Acceptance criteria

- [ ] `src/proto-embed.ts` exports both `EMBEDDED_AGENT_PROTO` and `EMBEDDED_OPERATOR_PROTO`.
- [ ] `bun run proto:gen` runs cleanly.
- [ ] No regression: existing agent-plane client still loads the embedded proto.
- [ ] `tsc --noEmit` clean.

## Notes

- The proto-loader writes the embedded string to `os.tmpdir()` at runtime. We may need two temp files (one per plane) if proto-loader doesn't share the file path. If so, extend `src/grpc/client.ts` to write both.
- The agent-plane proto is still needed (CLI-001: tool/skill/memory/watches/exec stay on `Orchestrator`).
