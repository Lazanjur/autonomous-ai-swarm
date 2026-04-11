$ErrorActionPreference = "Stop"

Write-Host "Preparing Autonomous AI Swarm workspace..."

if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

Write-Host "Install frontend dependencies with: cd apps/web; npm install"
Write-Host "Install backend dependencies with: cd apps/api; pip install -e .[dev]"
Write-Host "Start the local stack with: docker compose up --build"
