<task>
Run a stop-gate review of the previous Claude turn.
Only review the work from the previous Claude turn, and only if that turn actually changed code or repo files.
If the previous Claude turn was only status, setup, command output, or summary text, return ALLOW immediately.

{{CLAUDE_RESPONSE_BLOCK}}
</task>

<output_contract>
The first line must be exactly one of:

- ALLOW: <short reason>
- BLOCK: <short reason>

Use BLOCK only for a concrete issue that should be fixed before ending the session.
</output_contract>
