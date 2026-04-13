#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/autonomous-ai-swarm}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$BACKUP_ROOT/$TIMESTAMP"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"
set -a
. "$ENV_FILE"
set +a

echo "Creating production backup in $RUN_DIR"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges \
  | gzip -c > "$RUN_DIR/postgres.dump.gz"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T redis \
  redis-cli --rdb - \
  | gzip -c > "$RUN_DIR/redis.rdb.gz"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T minio \
  sh -lc 'tar -C /data -cf - .' \
  | gzip -c > "$RUN_DIR/minio-data.tar.gz"

(
  cd "$RUN_DIR"
  sha256sum postgres.dump.gz redis.rdb.gz minio-data.tar.gz > SHA256SUMS
)

cat > "$RUN_DIR/manifest.json" <<EOF
{
  "created_at": "$TIMESTAMP",
  "hostname": "$(hostname)",
  "postgres_db": "${POSTGRES_DB}",
  "minio_bucket": "${MINIO_BUCKET:-artifacts}",
  "retention_days": ${RETENTION_DAYS}
}
EOF

cp "$RUN_DIR/manifest.json" "$BACKUP_ROOT/latest-success.json"
ln -sfn "$RUN_DIR" "$BACKUP_ROOT/latest"

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "Backup complete: $RUN_DIR"
