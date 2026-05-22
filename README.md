# opencode-plugin-cc

OpenCode plugin for Claude Code.

## Development

Requirements:

- Node.js 22.18 or newer
- pnpm 10.33 or newer

Install dependencies:

```sh
pnpm install
```

Run the full local quality gate:

```sh
pnpm run check
```

Useful scripts:

- `pnpm run build` - bundle TypeScript into `dist/` with tsdown
- `pnpm run typecheck` - run TypeScript without emitting files
- `pnpm run lint` - run ESLint with type-aware TypeScript rules
- `pnpm run test` - run Vitest once
- `pnpm run format` - format the repo with Prettier
- `pnpm run changeset` - create a Changesets release note
- `pnpm run commit` - write a Conventional Commit with Commitizen

## Usage

After publishing this package, add it to your OpenCode config:

```json
{
  "plugin": ["opencode-plugin-cc"]
}
```
