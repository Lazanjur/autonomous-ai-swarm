#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/autonomous-ai-swarm}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
MAX_BACKUP_AGE_HOURS="${PRODUCTION_BACKUP_MAX_AGE_HOURS:-30}"
SSL_MIN_VALID_DAYS="${SSL_MIN_VALID_DAYS:-21}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

set -a
. "$ENV_FILE"
set +a

issues=()

if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api curl -fsS http://127.0.0.1:8000/api/v1/health/ready >/dev/null; then
  issues+=("api_readiness_failed")
fi

metrics_output="$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T api curl -fsS http://127.0.0.1:8000/api/v1/health/metrics || true)"
if [[ -z "$metrics_output" ]]; then
  issues+=("metrics_unavailable")
elif ! grep -q 'swarm_production_config_valid 1' <<<"$metrics_output"; then
  issues+=("production_config_invalid")
fi

if [[ -f "$BACKUP_ROOT/latest-success.json" ]]; then
  backup_age_seconds="$(( $(date +%s) - $(stat -c %Y "$BACKUP_ROOT/latest-success.json") ))"
  backup_age_hours="$(( backup_age_seconds / 3600 ))"
  if (( backup_age_hours > MAX_BACKUP_AGE_HOURS )); then
    issues+=("backup_too_old_${backup_age_hours}h")
  fi
else
  issues+=("backup_missing")
fi

if [[ -n "${APP_DOMAIN:-}" ]]; then
  cert_end_date="$(echo | openssl s_client -servername "$APP_DOMAIN" -connect "$APP_DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2- || true)"
  if [[ -z "$cert_end_date" ]]; then
    issues+=("ssl_probe_failed")
  else
    cert_end_epoch="$(date -d "$cert_end_date" +%s)"
    now_epoch="$(date +%s)"
    days_left="$(( (cert_end_epoch - now_epoch) / 86400 ))"
    if (( days_left < SSL_MIN_VALID_DAYS )); then
      issues+=("ssl_expires_in_${days_left}d")
    fi
  fi
fi

if (( ${#issues[@]} > 0 )); then
  echo "Production posture failed:"
  printf ' - %s\n' "${issues[@]}"
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    payload="$(printf '{"service":"autonomous-ai-swarm","level":"critical","issues":["%s"]}' "$(IFS='","'; echo "${issues[*]}")")"
    curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null || true
  fi
  exit 1
fi

echo "Production posture healthy."
