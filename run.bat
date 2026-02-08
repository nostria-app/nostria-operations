@echo off
REM Single run of ralphy with PRD.md
ralphy --opencode --model github-copilot/claude-opus-4.6 --prd PRD.md %*
