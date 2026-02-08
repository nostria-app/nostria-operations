# AGENTS.md — Project Conventions for AI Agents

This file defines rules and conventions that all AI agents (and human operators) must follow when working in this repo.

## General Rules

1. **One focused change per commit.** Don't try to do everything at once.
2. **Always pull before starting work.** Run `git fetch origin && git pull --rebase origin main`.
3. **Never force-push to main.** If there's a conflict, rebase and resolve.
4. **Log your actions.** Every agent run should produce a log entry in `/logs/`.

## Repo Boundaries

- **This repo** (`nostria-operations`) is for operations, planning, and agent orchestration.
- **Do NOT** commit application code here. App code belongs in `nostria` or `nostria-website`.
- When agents need to modify app or website code, they should:
  1. Clone the target repo to a temp directory
  2. Make changes on a feature branch
  3. Open a PR via `gh pr create`
  4. Never merge their own PRs — wait for human review

## File Organization

- Agent configs go in `/agents/<agent-name>/`
- Generated marketing content goes in `/marketing/`
- Business documents go in `/business/`
- Automation scripts go in `/scripts/`
- Documentation goes in `/docs/`
- Logs go in `/logs/` with format `YYYY-MM-DD-<agent>-<summary>.md`

## Commit Messages

Use conventional commits:
- `feat:` — new feature, content, or capability
- `docs:` — documentation changes
- `chore:` — maintenance, cleanup
- `fix:` — bug fixes
- `plan:` — business plans, roadmaps, strategy updates

## Agent Behavior

- **Be conservative.** When in doubt, create a draft or log an issue instead of making changes.
- **Don't duplicate work.** Check existing issues and logs before starting a task.
- **Respect rate limits.** Space out API calls; don't hammer external services.
- **Keep secrets out.** Never commit API keys, tokens, or credentials. Use environment variables or GitHub Secrets.

## Cross-Repo Interaction

When working with other Nostria repos:

```bash
# Clone to temp workspace
git clone https://github.com/nostria-app/nostria.git /tmp/nostria-work
cd /tmp/nostria-work

# Create a branch
git checkout -b agent/<agent-name>/<description>

# Make changes, commit, push
git add .
git commit -m "feat: <description>"
git push origin agent/<agent-name>/<description>

# Open PR
gh pr create --title "<title>" --body "<description>" --repo nostria-app/nostria
```

## Quality Standards

- Markdown files should be well-formatted and readable
- Business documents should have clear headers, dates, and version info
- Generated content should be reviewed before publishing
- All plans should include success criteria and timelines
