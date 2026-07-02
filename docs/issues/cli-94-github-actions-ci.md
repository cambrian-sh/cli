# cli-94 — GitHub Actions CI workflow

**Status:** TODO
**Parent ADR:** CLI-003 (distribution)
**Depends on:** cli-91, cli-92, cli-93 (the tests must pass for CI to be useful)
**Blocks:** cli-95
**Estimated effort:** 1 day

## Description

A GitHub Actions workflow that runs on every PR and every push to `main`. The workflow installs Bun, runs the type check, the unit tests, the integration tests (cli-91..93), the smoke tests, and the production build. PRs that fail any of these are blocked from merge.

## Steps

1. Read `.github/workflows/` (if it exists) to understand the repo's existing CI conventions.
2. Create `.github/workflows/ci.yml` with:
   - `name: CI`
   - `on: pull_request, push: { branches: [main] }`
   - `jobs.test:`
     - `runs-on: ${{ matrix.os }}`
     - `strategy.matrix.os: [ubuntu-latest, macos-latest]`
     - `steps:`
       - `actions/checkout@v4`
       - `oven-sh/setup-bun@v1` (with `bun-version: 1.3`)
       - `bun install --frozen-lockfile`
       - `bun run proto:gen`
       - `node_modules/.bin/tsc --noEmit`
       - `bun test`
       - `bun run test:smoke`
       - `bun run build`
3. Add a separate job `windows-dpapi` (only triggered on push to main, not on PRs to keep the PR loop fast):
   - `runs-on: windows-latest`
   - `steps:` same as above
   - This job is the only one that exercises the actual Windows DPAPI round-trip.
4. Add status badges to `README.md`:
   - `[![CI](https://github.com/your-org/cambrian-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/cambrian-cli/actions/workflows/ci.yml)`
5. Add branch protection: `main` requires the `test` job to pass.

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` exists.
- [ ] The workflow runs on `pull_request` and `push` to `main`.
- [ ] The matrix includes at least `ubuntu-latest` and `macos-latest`.
- [ ] The workflow runs: `bun install`, `bun run proto:gen`, `tsc --noEmit`, `bun test`, `bun run test:smoke`, `bun run build`.
- [ ] A failing test blocks the PR from being merged.
- [ ] The Windows job runs on `windows-latest` and includes the same steps.
- [ ] The README has a CI badge that reflects the workflow's actual status.
- [ ] No new dependencies (uses only `actions/checkout` + `oven-sh/setup-bun`).

## Notes

- Bun's setup action is `oven-sh/setup-bun@v1`. Pin the version: `bun-version: 1.3` (the version that `bun.lock` was generated with).
- The `proto:gen` step requires `protobufjs-cli` which is a devDependency — it should already be in `bun.lock`.
- The `bun run build` step produces `dist/index.js`. The CI does not need to upload this artifact; that's cli-95's job (release artifacts).
- For the Windows job: it runs the full suite but the DPAPI backend only actually works on Windows. The `keychain.test.ts` path-encoding tests pass on all OSes; the real DPAPI round-trip is only exercised on Windows.
- Branch protection settings are repo-level GitHub settings, not workflow config. The workflow can document this in a comment.
- The `--frozen-lockfile` flag ensures `bun.lock` is respected and prevents accidental upgrades.
