# cli-10 — Vendor `operator.proto` to `cli/proto/`

**Status:** TODO
**Parent ADR:** CLI-001
**Blocks:** cli-11, cli-12
**Estimated effort:** 30 minutes

## Description

Copy `api/proto/operator.proto` to `cli/proto/operator.proto`. Add a vendored header (mirroring `ui/proto/operator.proto`'s pinning comment). The vendored file is read-only — updates require re-vendoring from the kernel repo.

## Steps

1. `cp api/proto/operator.proto cli/proto/operator.proto`
2. Prepend the vendored header:
   ```
   // VENDORED — DO NOT EDIT BY HAND.
   // Source of truth: cambrian-runtime api/proto/operator.proto
   // Pinned to kernel/contract version: 0047 (kernel 0.6.9-alpha).
   // Re-vendor from the kernel repo when the contract bumps; verify via the
   // Snapshot handshake (contract_version) at runtime. ADR-0047 0047-13.
   ```
3. Verify the file is byte-identical to `api/proto/operator.proto` except for the header.

## Acceptance criteria

- [ ] `cli/proto/operator.proto` exists with the vendored header.
- [ ] File is byte-identical to `api/proto/operator.proto` (post-header).
- [ ] Header comment matches `ui/proto/operator.proto` style.
- [ ] No manual edits to the file content.

## Notes

- The CLI currently vendors `cambrian.proto` (agent-plane) the same way. This ticket adds `operator.proto` (operator-plane) alongside it.
- Both protos will be embedded in `src/proto-embed.ts` (cli-11).
