# Analytics Agent

The analytics agent monitors app usage, backend performance, and key business metrics.

## Capabilities

- Tracks KPIs (user growth, engagement, retention)
- Monitors backend logs for errors and anomalies
- Generates daily/weekly metric summaries
- Identifies trends and suggests optimizations
- Flags performance regressions

## How It Works

1. Runs on a schedule (daily or weekly)
2. Pulls metrics from configured data sources
3. Produces summaries in `/logs/`
4. Creates GitHub Issues for anomalies or actionable insights

## Configuration

See `config.yaml` for data sources and thresholds.
