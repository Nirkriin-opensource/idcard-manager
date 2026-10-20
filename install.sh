#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
step='argument validation'
trap 'rc=$?; printf "\nInstallation failed during: %s (line %s, exit %s).\nFix: check the preceding error, available disk, repository connectivity and service journals; then rerun this installer. Existing data is retained.\n" "$step" "$LINENO" "$rc" >&2; exit "$rc"' ERR
domain='' email='' noninteractive=false demo=false fail2ban=false
while (($#)); do
  case "$1" in
    --domain) domain="${2:?--domain requires a hostname}"; shift 2;;
    --email) email="${2:?--email requires an administrator email}"; shift 2;;
    --non-interactive) noninteractive=true; shift;;
    --demo-data) demo=true; shift;;
    --fail2ban) fail2ban=true; shift;;
    --help) echo 'sudo ./install.sh [--domain cards.example.org] --email admin@example.org [--demo-data] [--non-interactive]'; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
if [[ -z $email ]]; then
  if $noninteractive; then echo '--email is required in non-interactive mode.' >&2; exit 2; fi
  read -r -p 'Administrator email: ' email
fi
[[ $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo 'Invalid administrator email.' >&2; exit 2; }
[[ -z $domain || $domain =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { echo 'Invalid domain. Supply a hostname without a scheme or path.' >&2; exit 2; }
step='server checks'
source /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 22.04 || $VERSION_ID == 24.04 ) ]] || { echo 'Ubuntu 22.04 or 24.04 LTS is required.' >&2; exit 1; }
ram_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
((ram_kb >= 1900000)) || { echo 'At least 2 GB RAM is required.' >&2; exit 1; }
disk_kb=$(df --output=avail / | tail -1 | tr -d ' ')
((disk_kb >= 10*1024*1024)) || { echo 'At least 10 GB free disk is required.' >&2; exit 1; }
src=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f $src/package-lock.json && -f $src/src/db/migrations/001_initial.sql ]] || { echo 'Run the installer from the complete idcard source folder.' >&2; exit 1; }
step='installing signed package repositories'
apt-get update
apt-get install -y ca-certificates curl gnupg rsync openssl build-essential python3 fonts-dejavu-core fonts-noto-core fontconfig
curl --fail --silent --show-error --location --max-time 30 https://registry.npmjs.org/next >/dev/null
install -d -m 755 /usr/share/keyrings /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /etc/apt/keyrings/idcard-node.asc
printf 'deb [signed-by=/etc/apt/keyrings/idcard-node.asc] https://deb.nodesource.com/node_24.x nodistro main\n' >/etc/apt/sources.list.d/idcard-node.list
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /etc/apt/keyrings/idcard-postgres.asc
printf 'deb [signed-by=/etc/apt/keyrings/idcard-postgres.asc] https://apt.postgresql.org/pub/repos/apt %s-pgdg main\n' "$VERSION_CODENAME" >/etc/apt/sources.list.d/idcard-postgres.list
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /etc/apt/keyrings/idcard-caddy.asc
printf 'deb [signed-by=/etc/apt/keyrings/idcard-caddy.asc] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main\n' >/etc/apt/sources.list.d/idcard-caddy.list
chmod 644 /etc/apt/keyrings/idcard-*.asc /etc/apt/sources.list.d/idcard-*.list
apt-get update
step='installing Node, PostgreSQL and Caddy'
apt-get install -y nodejs postgresql-16 postgresql-client-16 caddy ufw
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { echo 'Node 24 is required. Resolve conflicting Node apt sources.' >&2; exit 1; }
systemctl enable --now postgresql
pgport=$(pg_lsclusters --no-header | awk '$1==16 && $2=="main" {print $3}')
[[ $pgport == 5432 ]] || { echo 'PostgreSQL 16/main must use port 5432. Another cluster may already occupy it; resolve this without deleting any data and rerun.' >&2; exit 1; }
[[ -d /etc/postgresql/16/main/conf.d ]] || { echo 'PostgreSQL main cluster configuration not found.' >&2; exit 1; }
printf "listen_addresses = 'localhost'\npassword_encryption = 'scram-sha-256'\n" >/etc/postgresql/16/main/conf.d/idcard.conf
chmod 644 /etc/postgresql/16/main/conf.d/idcard.conf
systemctl restart postgresql@16-main
step='creating service user and persistent storage'
id idcard &>/dev/null || useradd --system --home-dir /var/lib/idcard --shell /usr/sbin/nologin idcard
install -d -m 755 /opt/idcard /opt/idcard/releases
install -d -m 700 /etc/idcard
install -d -o root -g root -m 755 /var/lib/idcard
install -d -o idcard -g idcard -m 700 /var/lib/idcard/.npm /var/lib/idcard/.cache
install -d -o root -g idcard -m 750 /var/lib/idcard/storage
for dir in photos templates generated exports imports temp; do install -d -o idcard -g idcard -m 700 "/var/lib/idcard/storage/$dir"; done
install -d -o root -g root -m 700 /var/lib/idcard/storage/backups
step='database credentials and environment'
if [[ ! -f /etc/idcard/idcard.env ]]; then
  exists=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname='idcard'")
  [[ $exists == 0 ]] || { echo 'An idcard DB role exists without the environment file. Recover its credentials; refusing to change its password.' >&2; exit 1; }
  existing_db=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_database WHERE datname='idcard'")
  [[ $existing_db == 0 ]] || { echo 'An idcard database already exists without configuration. Recover its environment file before installing; no data was changed.' >&2; exit 1; }
  dbpass=$(openssl rand -hex 32)
  if [[ -n $domain ]]; then origin="https://$domain"; else server_ip=$(hostname -I | awk '{print $1}'); [[ $server_ip =~ ^[0-9.]+$ ]] || { echo 'No IPv4 address found. Supply --domain.' >&2; exit 1; }; origin="http://$server_ip"; fi
  # Persist credentials first so an interrupted database setup can be resumed safely.
  printf 'DATABASE_URL=postgresql://idcard:%s@127.0.0.1:5432/idcard\nAPP_ORIGIN=%s\nSTORAGE_ROOT=/var/lib/idcard/storage\nNODE_ENV=production\nNEXT_TELEMETRY_DISABLED=1\n' "$dbpass" "$origin" >/etc/idcard/idcard.env.new
  mv /etc/idcard/idcard.env.new /etc/idcard/idcard.env
fi
chmod 600 /etc/idcard/idcard.env
chown root:root /etc/idcard/idcard.env
set -a; source /etc/idcard/idcard.env; set +a
[[ $APP_ORIGIN =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo 'APP_ORIGIN is invalid; correct /etc/idcard/idcard.env.' >&2; exit 1; }
if [[ -n $domain && $APP_ORIGIN != "https://$domain" ]]; then echo 'Existing APP_ORIGIN differs from --domain. Update the environment and Caddy configuration together; credentials were preserved.' >&2; exit 1; fi
exists=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname='idcard'")
if [[ $exists == 0 ]]; then
  IDCARD_DB_PASSWORD=$(node -e 'const u=new URL(process.env.DATABASE_URL);if(u.username!=="idcard"||u.hostname!=="127.0.0.1"||u.pathname!=="/idcard"||!u.password)throw new Error("Installer requires the local idcard database URL; review the environment file.");process.stdout.write(decodeURIComponent(u.password));')
  export IDCARD_DB_PASSWORD
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 <<'SQL'
\getenv pw IDCARD_DB_PASSWORD
CREATE ROLE idcard LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'pw';
SQL
  unset IDCARD_DB_PASSWORD
fi
unsafe_role=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='idcard'")
[[ $unsafe_role == f ]] || { echo 'The idcard database role has unsafe superuser/BYPASSRLS privileges. Correct them before continuing.' >&2; exit 1; }
existing_db=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_database WHERE datname='idcard'")
if [[ $existing_db == 0 ]]; then runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE idcard OWNER idcard'; fi
correct_owner=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c "SELECT pg_get_userbyid(datdba)='idcard' FROM pg_database WHERE datname='idcard'")
[[ $correct_owner == t ]] || { echo 'The existing idcard database has a different owner. Review it manually; ownership and data were not changed.' >&2; exit 1; }
step='building a new release'
release="/opt/idcard/releases/$(date -u +%Y%m%d%H%M%S)-$$"
install -d -o idcard -g idcard -m 755 "$release"
rsync -a --exclude=node_modules --exclude=.next --exclude=dist --exclude=storage --exclude='.env*' --exclude=.git --exclude=test-results "$src/" "$release/"
chown -R idcard:idcard "$release"
cd "$release"
runuser -u idcard -- env NODE_ENV=development npm ci --no-fund
runuser -u idcard -- env NODE_ENV=production npm run build
step='non-destructive migrations'
runuser -u idcard -- node dist/cli/main.js migrate
step='creating administrator'
runuser -u idcard -- node dist/cli/main.js admin "$email"
if $demo; then runuser -u idcard -- node dist/cli/main.js demo; fi
chown -R root:root "$release"
chmod -R a+rX "$release"
step='switching application release'
ln -s "$release" /opt/idcard/current.new
mv -Tf /opt/idcard/current.new /opt/idcard/current
install -m 644 deploy/systemd/idcard-web.service /etc/systemd/system/idcard-web.service
install -m 644 deploy/systemd/idcard-worker.service /etc/systemd/system/idcard-worker.service
install -m 755 deploy/scripts/idcardctl /usr/local/bin/idcardctl
install -m 644 deploy/systemd/idcard-backup.service /etc/systemd/system/idcard-backup.service
install -m 644 deploy/systemd/idcard-backup.timer /etc/systemd/system/idcard-backup.timer
systemctl daemon-reload
systemctl enable --now idcard-backup.timer
systemctl enable idcard-web idcard-worker
systemctl restart idcard-web idcard-worker
step='Caddy configuration'
install -d -m 755 /etc/caddy/idcard
if [[ $APP_ORIGIN == https://* ]]; then host=${APP_ORIGIN#https://}; else host=':80'; fi
printf '%s {\n encode zstd gzip\n request_body {\n max_size 26MB\n }\n reverse_proxy 127.0.0.1:3000 {\n header_up X-Forwarded-For {remote_host}\n }\n}\n' "$host" >/etc/caddy/idcard/app.caddy
if ! grep -qF 'import /etc/caddy/idcard/*.caddy' /etc/caddy/Caddyfile; then
  # Preserve an existing server configuration. On a fresh Caddy package, replace only its default page.
  default_config=$(awk '{sub(/#.*/,"");gsub(/[[:space:]]/,"");printf "%s",$0}' /etc/caddy/Caddyfile)
  if [[ $default_config == ':80{root*/usr/share/caddyfile_server}' ]]; then cp -an /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-idcard; printf 'import /etc/caddy/idcard/*.caddy\n' >/etc/caddy/Caddyfile;
  else printf '\nimport /etc/caddy/idcard/*.caddy\n' >>/etc/caddy/Caddyfile; fi
fi
chmod 644 /etc/caddy/idcard/app.caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable --now caddy
systemctl reload caddy
step='firewall'
if $fail2ban; then bash deploy/scripts/harden.sh --fail2ban; else bash deploy/scripts/harden.sh; fi
step='health checks'
for attempt in {1..30}; do if curl -fsS http://127.0.0.1:3000/api/health/ready >/dev/null; then break; fi; sleep 2; done
idcardctl test
printf '\nInstalled phases 1–22 at %s\nAdministrator: %s\nExisting users keep their passwords. New passwords were printed above once.\nNext: sign in, change the temporary password and open Setup for the guided first-card workflow.\n' "$APP_ORIGIN" "$email"
printf 'Daily backups are enabled. Run idcardctl doctor, test a restore on a separate server and calibrate printing before production acceptance.\n'
