#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${ROOT_DIR:-/opt/autonomous-ai-swarm}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
ROTATION_DIR="${ROTATION_DIR:-$ROOT_DIR/rotations}"
MODE="${1:-preview}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$ROTATION_DIR"

new_secret_key="$(openssl rand -hex 32)"
new_session_cookie_name="swarm_session_$(openssl rand -hex 4)"
new_postgres_password="$(openssl rand -base64 32 | tr -d '\n' | tr '/+' 'XY' | cut -c1-32)"
new_minio_secret="$(openssl rand -base64 32 | tr -d '\n' | tr '/+' 'AB' | cut -c1-32)"

cat > "$ROTATION_DIR/rotation-$STAMP.env" <<EOF
SECRET_KEY=$new_secret_key
SESSION_COOKIE_NAME=$new_session_cookie_name
POSTGRES_PASSWORD=$new_postgres_password
MINIO_SECRET_KEY=$new_minio_secret
ROTATED_AT=$STAMP
EOF

if [[ "$MODE" == "--apply-app-only" ]]; then
  cp "$ENV_FILE" "$ENV_FILE.$STAMP.bak"
  sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$new_secret_key/" "$ENV_FILE"
  sed -i "s/^SESSION_COOKIE_NAME=.*/SESSION_COOKIE_NAME=$new_session_cookie_name/" "$ENV_FILE"
  echo "Applied app/session secret rotation to $ENV_FILE"
  echo "A backup copy was written to $ENV_FILE.$STAMP.bak"
else
  echo "Generated rotation plan: $ROTATION_DIR/rotation-$STAMP.env"
fi

echo "Next steps:"
echo "1. Review the generated values."
echo "2. Apply SECRET_KEY and SESSION_COOKIE_NAME during the next deploy to invalidate old sessions."
echo "3. Coordinate POSTGRES_PASSWORD and MINIO_SECRET_KEY rotation during a maintenance window."
echo "4. Run the deployment preflight and then redeploy the stack."
