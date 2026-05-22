# opencode-plugin-cc

Use OpenCode from inside Claude Code for code reviews or delegated tasks.

This plugin mirrors the workflow shape of `codex-plugin-cc`, but delegates to the local `opencode` CLI.

## What You Get

- `/opencode:review` for a read-only OpenCode review
- `/opencode:adversarial-review` for a steerable challenge review
- `/opencode:rescue`, `/opencode:status`, `/opencode:result`, and `/opencode:cancel` to delegate work and manage background jobs
- `/opencode:setup` to check local OpenCode readiness and toggle the optional stop-time review gate

## Requirements

- Node.js 22.18 or newer
- pnpm 10.33 or newer for local development
- OpenCode CLI installed and authenticated

Install OpenCode:

```sh
curl -fsSL https://opencode.ai/install | bash
```

Log in to a provider:

```sh
opencode providers login
```

Then run in Claude Code:

```text
/opencode:setup
```

## Usage

### `/opencode:review`

Runs a read-only OpenCode review on your current git state.

Examples:

```text
/opencode:review
/opencode:review --base main
/opencode:review --background
```

### `/opencode:adversarial-review`

Runs a review that challenges the implementation approach and design assumptions.

Examples:

```text
/opencode:adversarial-review
/opencode:adversarial-review --base main challenge the retry and rollback design
/opencode:adversarial-review --background look for race conditions
```

### `/opencode:rescue`

Delegates an investigation or fix request to OpenCode.

Examples:

```text
/opencode:rescue investigate why tests are failing
/opencode:rescue --write fix the failing test with the smallest safe patch
/opencode:rescue --model anthropic/claude-sonnet-4-5 --variant high inspect this regression
/opencode:rescue --background --write implement the missing edge case
```

Notes:

- The plugin never adds `--dangerously-skip-permissions` unless you explicitly ask for it.
- Follow-up rescue requests can resume the latest tracked OpenCode task when an OpenCode session ID is available.

### Job Management

```text
/opencode:status
/opencode:status <job-id>
/opencode:result
/opencode:result <job-id>
/opencode:cancel
/opencode:cancel <job-id>
```

### Review Gate

```text
/opencode:setup --enable-review-gate
/opencode:setup --disable-review-gate
```

When enabled, the plugin uses a Claude Code `Stop` hook to run a compact OpenCode review of the previous Claude turn. If OpenCode returns `BLOCK: ...`, the stop is blocked so Claude can address the issue first.

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
