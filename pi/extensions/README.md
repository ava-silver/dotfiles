# Pi extensions

Local extensions loaded directly by `pi/settings.json`.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Use `bun run format` to apply formatting. Restart Pi or run `/reload` after changing extension code.

Bun manages dependencies and commands. Tests use Node because the workflow sandbox relies on Node's permission model.

## Layout

Keep small extensions as top-level `.ts` files. Use a directory with `index.ts` once an extension needs multiple modules. Colocate unit tests as `*.test.ts`; reserve `test/` for integration tests.

All dependencies belong in the root `package.json` and `bun.lock`. Pi-provided packages remain peer dependencies, with matching pinned development versions used by `setup.sh`. Provision external executables through `Brewfile`, not extension runtime code.
