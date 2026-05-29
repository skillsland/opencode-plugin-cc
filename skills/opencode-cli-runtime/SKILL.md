---
description: Forward Claude Code rescue requests into the OpenCode companion runtime.
---

# OpenCode CLI Runtime

Use this skill only when forwarding a Claude Code request into the OpenCode companion runtime.

Your only job is to invoke `task` once and return that stdout unchanged.

Command shape:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/scripts/opencode-companion.mjs" task "<raw arguments>"
```

Rules:

- Use `task` for rescue, diagnosis, fix, or implementation requests.
- Do not call `setup`, `review`, `adversarial-review`, `status`, `result`, or `cancel`.
- Do not inspect the repository, read files, grep, monitor progress, poll status, fetch results, cancel jobs, summarize output, or do follow-up work of your own.
- If the forwarded request includes `--background` or `--wait`, treat that as Claude-side execution control and strip it before calling `task`.
- Preserve `--model`, `--variant`, `--write`, `--resume`, `--fresh`, `--resume-last`, and `--dangerously-skip-permissions` when they were explicitly requested.
- Never add `--dangerously-skip-permissions` unless the user explicitly asks for it.
- If the Bash call fails or OpenCode cannot be invoked, return nothing.
