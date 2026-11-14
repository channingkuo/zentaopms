#!/usr/bin/env bash
set -Eeuo pipefail
[[ $# == 1 && -f "$1" ]] || { echo 'Usage: smoke-xmw.sh bundle.tar.gz' >&2; exit 1; }
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
ARCHIVE=$(realpath "$1")
(cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256")
WORK=$(mktemp -d "$(dirname "$ARCHIVE")/.smoke.XXXXXX")
PROJECT="xmw-smoke-$$"
PACKAGE="$WORK/zentao-deploy"
DATA_PATH="$WORK/zentao-data"
LOG_PATH="$WORK/zentao-logs"
BACKUP_PATH="$WORK/zentao-backups"
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -f "$PACKAGE/.env" ]]; then
    docker compose --project-directory "$PACKAGE" --env-file "$PACKAGE/.env" -f "$PACKAGE/compose.yaml" -p "$PROJECT" down --timeout 60 >/dev/null 2>&1 || true
  fi
  if [[ -n ${DB_IMAGE:-} ]]; then
    docker run --rm --network none --entrypoint /bin/bash -v "$WORK:/cleanup:z" "$DB_IMAGE" -ec \
      'rm -rf /cleanup/zentao-data /cleanup/zentao-logs /cleanup/zentao-backups /cleanup/old-data /cleanup/old-logs' || true
  fi
  rm -rf "$WORK" || true
  exit "$result"
}
trap cleanup EXIT
tar -xzf "$ARCHIVE" -C "$WORK"
cd "$PACKAGE"
sha256sum --check --status MANIFEST.sha256
source "$PACKAGE/scripts/common.sh"
while IFS='|' read -r ref file id; do
  (cd images && sha256sum --check "$file.sha256")
  docker load --input "images/$file"
  image_identity_matches "$ref" "$id" "$(docker image inspect "$ref" --format '{{.Id}}')"
done < images/images.lock
DB_IMAGE=$(sed -n 's/^DB_IMAGE=//p' .env.example)
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
sed -i "s/^COMPOSE_PROJECT_NAME=.*/COMPOSE_PROJECT_NAME=$PROJECT/; s/^HTTP_PORT=.*/HTTP_PORT=$PORT/; s/^BIND_IP=.*/BIND_IP=127.0.0.1/" .env
./deploy.sh init
before=$(sha256sum .env)
./deploy.sh init
test "$before" = "$(sha256sum .env)"
./deploy.sh up
compose() { docker compose --project-directory "$PACKAGE" --env-file "$PACKAGE/.env" -f "$PACKAGE/compose.yaml" -p "$PROJECT" "$@"; }
check_http() {
  curl --fail --silent --show-error --location --max-time 30 "http://127.0.0.1:$PORT/" -o "$WORK/page.html"
  grep -Eq '22\.7|ZenTao|禅道' "$WORK/page.html"
  python3 "$ROOT/scripts/release/check-web-assets.py" "http://127.0.0.1:$PORT/"
}
check_http
compose exec -T db bash -ec 'MYSQL_PWD="$MARIADB_PASSWORD" mariadb --user="$MARIADB_USER" "$MARIADB_DATABASE" -e "CREATE TABLE xmw_deploy_probe (id INT PRIMARY KEY); INSERT INTO xmw_deploy_probe VALUES (227);"'
compose exec -T zentao bash -ec 'echo xmw-persistent > /data/zentao/www/data/xmw-probe.txt; /opt/zbox/bin/php -r '\''error_log("xmw-log-probe");'\'''
check_data() {
  test "$(compose exec -T db bash -ec 'MYSQL_PWD="$MARIADB_PASSWORD" mariadb --user="$MARIADB_USER" "$MARIADB_DATABASE" -Nse "SELECT id FROM xmw_deploy_probe"')" = 227
  test "$(compose exec -T zentao cat /data/zentao/www/data/xmw-probe.txt)" = xmw-persistent
  compose exec -T zentao bash -ec 'grep -q xmw-log-probe /data/php/log/error.log; test -s /opt/zbox/logs/apache_access.log'
  check_http
}
./deploy.sh down
./deploy.sh up
check_data
./deploy.sh backup
./deploy.sh down
# Restore the physical backup into empty directories, using original UID/GID.
backup=$(find "$BACKUP_PATH" -maxdepth 1 -name '*.tar.gz' -printf '%f\n')
[[ -n "$backup" && "$backup" != *$'\n'* ]]
mv "$DATA_PATH" "$WORK/old-data"
mv "$LOG_PATH" "$WORK/old-logs"
mkdir "$DATA_PATH" "$LOG_PATH"
docker run --rm --network none --entrypoint /bin/bash \
  -v "$BACKUP_PATH:/backup:ro,z" -v "$DATA_PATH:/restore/data:z" -v "$LOG_PATH:/restore/logs:z" \
  "$DB_IMAGE" -ec 'cd /backup; sha256sum -c "$1.sha256"; tar -xzpf "$1" -C /restore data logs' -- "$backup"
./deploy.sh up
check_data
printf 'PASS: original image load, installer, logs, rebuild persistence, backup and restore\n'
