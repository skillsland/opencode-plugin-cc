---
description: Run an OpenCode review that challenges implementation approach and design choices
argument-hint: "[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <provider/model>] [--variant minimal|low|medium|high|max] [focus ...]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial OpenCode review through the shared plugin runtime.
Position it as a challenge review that questions implementation approach, design choices, tradeoffs, and assumptions.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return OpenCode's output verbatim to the user.
- Keep the framing focused on whether the current approach is the right one and where it could fail.

Execution mode rules:

- If the raw arguments include `--wait`, do not ask. Run in the foreground.
- If the raw arguments include `--background`, do not ask. Run in a Claude background task.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, inspect `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work.
  - Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total.
  - In every other case, including unclear size, recommend background.
- Then use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:

- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself.
- Do not weaken the adversarial framing or rewrite the user's focus text.
- `/opencode:adversarial-review` uses the same review target selection as `/opencode:review`.
- It supports working-tree review, branch review, `--base <ref>`, and extra focus text.

Foreground flow:

- Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/scripts/opencode-companion.mjs" adversarial-review "$ARGUMENTS"
```

- Return the command stdout verbatim, exactly as-is.
- Do not fix any issues mentioned in the review output.

Background flow:

- Launch the review with `Bash` in the background:

```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/dist/scripts/opencode-companion.mjs" adversarial-review "$ARGUMENTS"`,
  description: "OpenCode adversarial review",
  run_in_background: true,
});
```

- Do not call `BashOutput` or wait for completion in this turn.
- After launching the command, tell the user: "OpenCode adversarial review started in the background. Check `/opencode:status` for progress."
