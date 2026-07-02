# cli-95 — Coverage reporting

**Status:** TODO
**Parent ADR:** CLI-003
**Depends on:** cli-94
**Blocks:** —
**Estimated effort:** 1 day

## Description

Integrate `bun test --coverage` and surface the coverage report in CI. The coverage threshold for new code is 80% lines, 75% branches. PRs that drop coverage below the threshold are blocked.

## Steps

1. Read `bun test --help` to find the coverage flags (Bun supports `--coverage` with `--coverage-reporter=text` and `--coverage-reporter=lcov`).
2. Update `.github/workflows/ci.yml` to add a coverage step after `bun test`:
   - `bun test --coverage --coverage-reporter=text --coverage-reporter=lcov`
   - Upload the `lcov` artifact via `actions/upload-artifact@v4`.
3. Add a coverage script to `package.json`:
   - `"coverage": "bun test --coverage --coverage-reporter=text"`
4. Add a comment to `README.md` under Testing: "Coverage: `bun run coverage`. Threshold: 80% lines, 75% branches."
5. Add a coverage badge to `README.md` (optional, but useful):
   - `[![Coverage](https://img.shields.io/badge/Coverage-80%25-green)]()`

## Acceptance criteria

- [ ] `bun run coverage` works locally and prints line + branch coverage.
- [ ] The CI workflow uploads the `lcov` report as an artifact.
- [ ] The README's Testing section mentions `bun run coverage`.
- [ ] No new dependencies (Bun's built-in coverage is used).
- [ ] `tsc --noEmit` clean.
- [ ] `package.json` has the new `coverage` script.

## Notes

- Bun's coverage is built-in; no `nyc` or `c8` needed.
- The coverage threshold is enforced socially (a comment in the README + a CI check) — Bun does not have a built-in threshold-fail flag in the current version. Document the threshold; rely on PR review to enforce it.
- The `lcov` report can be visualized locally with `genhtml coverage/lcov.info -o coverage/html` (if `lcov` is installed) or by uploading to Coveralls/Codecov in a follow-up.
- This ticket is the lightest in Phase 9. Do it after cli-94 is merged and CI is green.
