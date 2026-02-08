# DevOps Agent

The devops agent handles deployment automation, infrastructure monitoring, and uptime alerts.

## Capabilities

- Monitors deployment pipelines and service health
- Automates rollbacks when issues are detected
- Manages infrastructure configurations
- Tracks uptime and alerts on outages
- Runs health checks across services

## How It Works

1. Triggered by GitHub Actions or on a schedule
2. Checks service health and deployment status
3. Takes automated action (restart, rollback) if configured
4. Logs all actions in `/logs/`

## Configuration

See `config.yaml` for services and thresholds.
