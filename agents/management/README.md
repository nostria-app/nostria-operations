# Management Agent

The management agent is your virtual COO. It handles planning, task prioritization, and weekly reviews.

## Capabilities

- Scans GitHub Issues across all Nostria repos
- Generates weekly progress summaries
- Suggests next tasks based on priorities and roadmap
- Creates and organizes GitHub Issues
- Tracks deadlines and milestones

## How It Works

1. Runs on a schedule (weekly) via GitHub Actions
2. Reads open issues from `nostria`, `nostria-website`, and `nostria-operations`
3. Produces a summary in `/logs/`
4. Creates new issues for upcoming work

## Configuration

See `config.yaml` for schedule and parameters.

## Prompts

- `system-prompt.md` — The agent's personality and instructions
- `weekly-review-prompt.md` — Template for weekly reviews
