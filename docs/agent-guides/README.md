# Agent Guides

Documentation for how each AI agent works, its capabilities, and how to configure it.

## Available Agents

| Agent | Purpose | Schedule |
|-------|---------|----------|
| [Management](../../agents/management/) | Planning, task prioritization, weekly reviews | Weekly |
| [Marketing](../../agents/marketing/) | Content generation, campaigns, social media | On-demand |
| [Analytics](../../agents/analytics/) | KPIs, metrics, trend analysis | Weekly |
| [DevOps](../../agents/devops/) | Deployment, monitoring, uptime | Daily |

## Adding a New Agent

1. Create a folder under `/agents/<agent-name>/`
2. Add `README.md` — what the agent does
3. Add `config.yaml` — parameters and schedule
4. Add `system-prompt.md` — the agent's instructions
5. Optionally add scripts in `/scripts/`
6. Document it here in the agent guides

## General Agent Architecture

```
Agent Loop:
  1. Read config and system prompt
  2. Gather context (issues, metrics, repo state)
  3. Execute task (generate content, analyze data, etc.)
  4. Write output to appropriate folder
  5. Log activity in /logs/
  6. Optionally create GitHub Issues or PRs
```
