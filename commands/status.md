---
description: Show active and recent OpenCode jobs for this repository, including review-gate status
argument-hint: "[job-id] [--all]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/scripts/opencode-companion.mjs" status "$ARGUMENTS"`

If the user did not pass a job ID:

- Render the command output as a compact Markdown table.
- Do not add extra prose outside the table.

If the user did pass a job ID:

- Present the full command output to the user.
- Do not summarize or condense it.
