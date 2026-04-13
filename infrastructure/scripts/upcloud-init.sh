#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

APP_DIR="/opt/autonomous-ai-swarm"
REPO_URL="https://github.com/Lazanjur/autonomous-ai-swarm.git"

apt-get update
apt-get install -y ca-certificates curl git gnupg lsb-release openssl ufw fail2ban

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
echo \
  "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker

mkdir -p "${APP_DIR}"

if [ ! -d "${APP_DIR}/.git" ]; then
  git clone "${REPO_URL}" "${APP_DIR}"
else
  git -C "${APP_DIR}" fetch --all --prune
  if git -C "${APP_DIR}" show-ref --verify --quiet refs/remotes/origin/main; then
    git -C "${APP_DIR}" reset --hard origin/main
  fi
fi

if [ -f "${APP_DIR}/.env.production.example" ] && [ ! -f "${APP_DIR}/.env.production" ]; then
  cp "${APP_DIR}/.env.production.example" "${APP_DIR}/.env.production"
fi

cat >/usr/local/bin/swarm-deploy <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/autonomous-ai-swarm

if [ ! -f docker-compose.prod.yml ] || [ ! -f .env.production.example ]; then
  echo "The repository does not contain the production app files yet."
  echo "Push the local project to GitHub first, then rerun swarm-deploy."
  exit 1
fi

git pull --ff-only origin main

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  echo "Created .env.production from template. Edit it before rerunning swarm-deploy."
  exit 1
fi

./infrastructure/scripts/validate-production-env.sh .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
EOF
chmod +x /usr/local/bin/swarm-deploy

cat >/usr/local/bin/swarm-logs <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/autonomous-ai-swarm
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
EOF
chmod +x /usr/local/bin/swarm-logs

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable fail2ban
systemctl restart fail2ban

cat >/root/UPNEXT.txt <<'EOF'
Autonomous AI Swarm server bootstrap is complete.

Next steps:
1. SSH into the server.
2. Push the project to GitHub if the repository is still empty.
3. Edit /opt/autonomous-ai-swarm/.env.production
4. Set APP_DOMAIN, ACME_EMAIL, ALIBABA_API_KEY, SECRET_KEY, POSTGRES_PASSWORD, and MINIO_SECRET_KEY
5. Run: swarm-deploy
6. Check: docker ps
7. Set up cron for backup-production.sh and check-production-posture.sh
8. Visit: https://your-domain
EOF

echo "Bootstrap complete. Read /root/UPNEXT.txt after login."
