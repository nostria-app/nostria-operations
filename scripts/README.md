# Automation Scripts

## Structure

```
/scripts
  /automation-loops  — Main agent loop scripts
  /cross-repo        — Scripts that interact with other Nostria repos
```

## automation-loops/

Scripts that drive the agent execution loops. The main loop is `loop.ps1` in the repo root, but additional specialized loops can be placed here.

## cross-repo/

Scripts for interacting with `nostria` and `nostria-website` repos:
- Cloning repos
- Opening PRs
- Syncing content
- Running cross-repo checks
