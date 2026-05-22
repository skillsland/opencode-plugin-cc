---
description: Check whether OpenCode CLI is ready and optionally toggle the stop-time review gate
argument-hint: "[--enable-review-gate|--disable-review-gate]"
allowed-tools: Bash(node:*), Bash(opencode:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/scripts/opencode-companion.mjs" setup --json $ARGUMENTS
```

If the result says OpenCode is unavailable:

- Tell the user to install OpenCode with:

```bash
curl -fsSL https://opencode.ai/install | bash
```

If OpenCode is installed but credentials are missing:

- Tell the user to run:

```bash
opencode providers login
```

If setup is ready:

- Present the setup output clearly.
- Preserve review gate state and any next steps.

Do not install OpenCode automatically unless the user explicitly asks.
