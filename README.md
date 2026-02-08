# Nostria Operations

The operational backbone of Nostria — a one-person studio powered by AI agents.

This repo is the **company HQ**: agents, marketing, business plans, strategy, and orchestration all live here. Production code lives in separate repos:

| Repo | Purpose |
|------|---------|
| [nostria](https://github.com/nostria-app/nostria) | Main app (backend + frontend) |
| [nostria-website](https://github.com/nostria-app/nostria-website) | Public website |
| **nostria-operations** (this repo) | Company operations, AI agents, business planning |

## Repo Structure

```
/agents              — AI agent configs, prompts, and scripts
  /marketing         — Social media, content generation, campaigns
  /management        — Planning, task prioritization, weekly reviews
  /analytics         — App usage, KPIs, trend analysis
  /devops            — Deployment, monitoring, uptime
/business            — Business planning and strategy
  /plans             — Business plans, investor materials
  /roadmaps          — Product and company roadmaps
  /strategy          — Strategic docs, competitive analysis
/marketing           — Generated marketing output
  /campaigns         — Campaign plans and execution
  /assets            — Generated images, copy, media
  /social            — Social media posts and schedules
/docs                — Documentation and guides
  /playbooks         — Operational playbooks
  /agent-guides      — How each agent works
/scripts             — Automation loops and glue code
  /automation-loops  — Agent loop scripts
  /cross-repo        — Scripts that interact with other repos
/logs                — Agent activity logs for auditing
```

## How It Works

### Agent Loop

The main automation loop (`loop.ps1`) watches for GitHub Issues labeled `ready` and dispatches them to [Ralphy](https://github.com/niclas-AE/ralphy) (an AI coding agent). When idle, it runs codebase improvements.

```powershell
# Start the loop
pwsh loop.ps1

# Or on Windows
loop.bat
```

### Cross-Repo Workflow

Agents in this repo can interact with `nostria` and `nostria-website` by:

1. **Cloning** the target repo into a temporary workspace
2. **Making changes** (e.g., generating blog posts, updating docs)
3. **Opening PRs** via GitHub CLI (`gh pr create`)

This keeps production repos clean — agents never pollute them with experimental scripts.

### Agent Specialization

Each agent is a specialized "employee" with its own:
- **System prompt** — defines personality and capabilities
- **Config** — parameters, schedules, integrations
- **Scripts** — automation specific to that agent's domain
- **Output folder** — where generated artifacts land

## Getting Started

1. Clone this repo
2. Ensure `gh` (GitHub CLI) is authenticated
3. Run the loop: `pwsh loop.ps1`
4. Create GitHub Issues with the `ready` label to assign tasks

## Philosophy

- **Separation of concerns**: Each agent has a clear domain
- **Auditable**: All agent actions produce logs or issue updates
- **Gradual scaling**: Start with one agent, add more as trust builds
- **Production safety**: Agents clone prod repos — they never run inside them
