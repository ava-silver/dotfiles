# Pi extension standards

- Finish every change with `bun run check`.
- Keep `index.ts` focused on registration and lifecycle wiring.
- Import only from the same extension or `shared/`; communicate across extensions through typed `pi.events` contracts.
- Add shared code only when at least two extensions use it.
- Start long-lived resources during `session_start` and stop them idempotently during `session_shutdown`.
- Guard terminal components with `ctx.mode === "tui"` and dialogs with `ctx.hasUI`.
- Pass cancellation signals to async work and set intentional deadlines for external I/O.
- Truncate custom-tool output to Pi's exported byte and line limits. Save full output to a secure artifact when needed.
- Respect `ctx.isProjectTrusted()` before loading project-controlled configuration or instructions.
- Validate persisted, network, subprocess, and session data at module boundaries.
- Do not use `any` outside a documented compatibility adapter.
- Keep undocumented Pi internals and prototype patches inside `shared/*-compat.ts` modules with installed-runtime tests.
- Add a regression test for every bug fix.
- Declare dependencies in the root manifest. Do not add nested manifests or lockfiles.
- Provision external executables through `Brewfile`; extensions only detect and report missing dependencies.
