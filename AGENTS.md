# AGENTS.md

These instructions apply throughout Midscene Arm Kit. Start with the [README](./README.md) for setup and usage.

## Development workflow

- Use pnpm 9.3.0 and a Node.js version supported by the root package manifest. Install dependencies from the repository root.
- Run `pnpm build` after installation. Workspace packages import compiled entry points. To rebuild one package and its dependencies, use a filter such as `pnpm --filter @midscene/arm-kit... -r build`.
- Keep regression tests in the owning package’s or app’s `tests/` directory. Start with the relevant suite, for example `pnpm --filter @midscene/arm-kit test`. Run `pnpm typecheck` for changes to shared types or package exports.
- Before submitting changes, run `pnpm lint:check`. The separate `pnpm lint` command applies fixes. Edit sources and rebuild generated files when needed.
- When changing calibration packaging, run `pnpm build`, then `pnpm --filter @midscene/arm-kit... -r exec pnpm pack --pack-destination /absolute/output/directory`. In a temporary consumer, install the SDK tarball and use pnpm overrides for the shared and calibration UI tarballs. Exercise the installed SDK through `packages/arm-kit/tests/fixtures/installed-sdk.mjs`.

## Package boundaries and hardware

- Keep vendor commands, units and measured completion in the adapter. Implement adapters against `@midscene/arm-kit/adapter-development`. The Controller owns the action queue shared by its Devices.
- Put browser-safe protocol types and camera geometry used by both the SDK and UI in `packages/shared`. The SDK resolves the standalone page through the calibration UI package’s `./standalone` export.
- Keep the reusable Playground in `packages/playground` and MG400-specific network prompts in `apps/playground`.
- Use the test adapter for automated checks. For physical movement, obtain operator confirmation and use measured setup values and verified routes. Report simulated and hardware results separately.

## Documentation

Update the English and Chinese READMEs together when commands, package boundaries or public behavior change. Keep model credentials and local machine settings out of examples.
