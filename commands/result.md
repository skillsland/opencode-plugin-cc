---
description: Show the stored final output for a finished OpenCode job in this repository
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/scripts/opencode-companion.mjs" result "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it. Preserve:

- Job ID and status
- The complete result payload
- File paths and line numbers exactly as reported
- Any error messages
- OpenCode session IDs when available
