#!/usr/bin/env bash
set -Eeuo pipefail
mkdir -p /var/log/mysql
chown mysql:mysql /var/log/mysql
chmod 750 /var/log/mysql
# 同时将启动过程/控制台日志写入宿主机日志目录。
exec > >(tee -a /var/log/mysql/container.log) 2>&1
exec /usr/local/bin/docker-entrypoint.sh "$@"
