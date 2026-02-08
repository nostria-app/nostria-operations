# Agent Activity Logs

All agent runs should produce a log entry here for auditing and review.

## Naming Convention

`YYYY-MM-DD-<agent>-<summary>.md`

Examples:
- `2026-02-08-management-weekly-review.md`
- `2026-02-10-marketing-nostr-posts-generated.md`
- `2026-02-12-devops-deployment-check.md`
- `2026-02-15-analytics-kpi-summary.md`

## Log Template

```markdown
# Agent Log: [Agent Name] — [Date]

## Task
[What the agent was asked to do]

## Actions Taken
1. [action]
2. [action]

## Output
[What was produced — links to files, issues, PRs]

## Issues Found
- [any problems or anomalies]

## Duration
[How long the run took]
```

## Notes

- Temporary context files (prefixed with `.`) can be cleaned up periodically
- Logs are for auditing — keep them factual and concise
- If an agent run fails, log it anyway with the error details
