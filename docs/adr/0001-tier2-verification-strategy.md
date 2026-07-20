# ADR 0001: Verification strategy for Tier 2 refactors

## Status

Accepted.

## Context

The e2e suite runs only in demo mode (`npm start` / the `if (DEMO_MODE)` block in
`src/main.js`), which replaces ~40 IPC handlers with fakes: clone, pip, docker, ollama, venv,
env-write, startup-task, Tailscale, and the update orchestrator. The Tier 2 refactors touch this
orchestration, so demo mode alone cannot verify them. We needed one durable policy before
starting, because the right answer differs by category:

- Renderer handlers (the progress/poll/clone helpers, issues #9 and #10) run the same code in demo
  and real mode; only the IPC responses are faked. The existing demo e2e suite already drives
  clone progress, install logs, and the retry/poll loops, so demo fidelity is sufficient at the
  UI layer and no new infrastructure is warranted.

- Main-process orchestration (the `run()` helper, the unified update path, the `shell:true` audit
  -- issues #7, #8, #11, #13) is the actual gap. This is the logic that warrants real coverage, so
  it gets a layered approach: unit-test the infrastructure helpers directly (run a real harmless
  command, assert the result and timeout), extract pure decision-logic into `src/lib/`, and add
  targeted `--real` integration tests for the hermetic paths. Note: `run()` keeps `shell:true` for
  parity when it lands (#7), so its args are shell-interpreted, not literal. The "pass
  metacharacter-bearing args as an array and assert they arrive literally" assertion therefore
  belongs with the `shell:true` audit (#11) — which flips specific sites to `shell:false` — and is
  not a #7 deliverable.

- pip, docker, ollama, and similar external-dependency handlers are deliberately left demo-only.
  A `--real` test of these is slow, network-dependent, and requires toolchain or daemon state
  (a running Docker daemon, an Ollama install, multi-GB model pulls) that CI cannot guarantee
  hermetically. This carve-out is intentional, not arbitrary: the cost and flakiness outweigh the
  coverage, so demo remains their only automated check.

- The hermetic `--real` tests (clone against a local bare git repo, write-env and git-pull/version
  logic against temp dirs) run as a dedicated fast CI job on PR and push. The `helpers.cjs`
  `extraArgs` seam already passes `--real`; the prep step is making the clone repo URL injectable
  so the clone path can target a local bare repo instead of GitHub.

## Decision

Adopt a per-category verification strategy:

1. Renderer refactors: the existing demo e2e suite is the regression guard.
2. Main-process orchestration: the layered hybrid (helper unit tests + `src/lib/` extraction +
   hermetic `--real` integration tests).
3. External-dependency handlers (pip/docker/ollama): demo-only, by deliberate exception.

Hermetic `--real` tests run in a dedicated fast `test:integration` CI job on PR and push, gated
behind the injectable-clone-URL seam.

## Consequences

- A new `test:integration` script and CI workflow (fast, hermetic, ubuntu and optionally windows),
  plus the injectable-clone-URL prerequisite.
- This sets the Tier 2 testing architecture; anything that builds on Tier 2 inherits it.
- Two rejected alternatives, recorded so they are not re-litigated:
  - `--real` everything: standing up Docker, Ollama, network, and multi-GB pulls in CI is slow,
    flaky, and hostile to Windows runners.
  - demo-only everything: cheapest, but the shipped orchestration keeps ~0% real coverage and
    orchestration bugs ship unverified -- the exact gap the review flagged.
