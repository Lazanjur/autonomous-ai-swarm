#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${1:-/opt/autonomous-ai-swarm/.env.production}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

errors=()

[[ "${APP_ENV:-}" == "production" ]] || errors+=("APP_ENV must be production")
[[ "${ENABLE_DEMO_MODE:-false}" == "false" ]] || errors+=("ENABLE_DEMO_MODE must be false")
[[ "${ALLOW_LOCAL_PROVIDER_FALLBACK:-false}" == "false" ]] || errors+=("ALLOW_LOCAL_PROVIDER_FALLBACK must be false")
[[ -n "${APP_DOMAIN:-}" && "${APP_DOMAIN}" != *"example.com"* ]] || errors+=("APP_DOMAIN is missing or still a placeholder")
[[ "${PUBLIC_APP_URL:-}" == "https://${APP_DOMAIN}" ]] || errors+=("PUBLIC_APP_URL must match https://APP_DOMAIN")
[[ "${PUBLIC_API_URL:-}" == "https://${APP_DOMAIN}" ]] || errors+=("PUBLIC_API_URL must match https://APP_DOMAIN")
[[ "${NEXT_PUBLIC_APP_URL:-}" == "https://${APP_DOMAIN}" ]] || errors+=("NEXT_PUBLIC_APP_URL must match https://APP_DOMAIN")
[[ "${NEXT_PUBLIC_API_URL:-}" == "https://${APP_DOMAIN}" ]] || errors+=("NEXT_PUBLIC_API_URL must match https://APP_DOMAIN")
[[ "${SECRET_KEY:-}" != *"change-me"* ]] || errors+=("SECRET_KEY still contains a placeholder value")
[[ "${POSTGRES_PASSWORD:-}" != *"change-me"* ]] || errors+=("POSTGRES_PASSWORD still contains a placeholder value")
[[ "${MINIO_SECRET_KEY:-}" != *"change-me"* ]] || errors+=("MINIO_SECRET_KEY still contains a placeholder value")
[[ -n "${ALIBABA_API_KEY:-}" && "${ALIBABA_API_KEY}" != "replace-with-real-key" ]] || errors+=("ALIBABA_API_KEY is missing or still a placeholder")

if (( ${#errors[@]} > 0 )); then
  echo "Production env validation failed:"
  printf ' - %s\n' "${errors[@]}"
  exit 1
fi

echo "Production env validation passed."
