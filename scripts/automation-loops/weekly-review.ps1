#!/usr/bin/env pwsh
# weekly-review.ps1 - Run the management agent's weekly review
#
# Usage: pwsh scripts/automation-loops/weekly-review.ps1

param(
  [string]$Model = "github-copilot/claude-opus-4.6"
)

$ErrorActionPreference = "Stop"
$date = Get-Date -Format "yyyy-MM-dd"
$logFile = "logs/$date-management-weekly-review.md"

Write-Host "Running weekly review for $date..."

# Gather open issues across repos
$repos = @("nostria-app/nostria", "nostria-app/nostria-website", "nostria-app/nostria-operations")

$issuesSummary = ""
foreach ($repo in $repos) {
  Write-Host "Fetching issues from $repo..."
  $issues = & gh issue list --repo $repo --state open --limit 20 --json number,title,labels,createdAt 2>&1
  $issuesSummary += "`n## $repo`n$issues`n"
}

# Write context for the agent
$contextFile = "logs/.weekly-review-context.md"
$issuesSummary | Out-File -FilePath $contextFile -Encoding utf8

Write-Host "Context written to $contextFile"
Write-Host "Feed this to your management agent along with agents/management/system-prompt.md"
Write-Host "Output should go to: $logFile"
