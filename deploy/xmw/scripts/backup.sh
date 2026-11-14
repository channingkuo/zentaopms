#!/usr/bin/env bash
# 由 deploy.sh 加载；用原始 UID/GID 保存完整物理备份，避免读取宿主机权限问题。
prepare_dirs
load_images
mapfile -t running_services < <(compose ps --status running --services)
docker run --rm --network none --entrypoint /bin/bash \
    -v "$DATA_DIR/mysql:/var/lib/mysql:ro,z" "$DB_IMAGE" -ec 'test -d /var/lib/mysql/mysql' || fail '数据库尚未初始化，无需备份。'
backup_name="zentao-$(date +%Y%m%d-%H%M%S)-$$.tar.gz"
resume_services() {
    local result=$?
    trap - EXIT
    if ((${#running_services[@]})); then
        printf '恢复备份前运行的服务……\n'
        if ! compose start --wait --wait-timeout "$START_TIMEOUT" "${running_services[@]}"; then
            printf '服务恢复失败，请执行 ./deploy.sh up。\n' >&2
            result=1
        fi
    fi
    exit "$result"
}
trap resume_services EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '即将短暂停机备份数据库与文件；完成或失败后均尝试恢复原运行服务。\n'
compose stop --timeout "$STOP_TIMEOUT"
[[ -z $(compose ps --status running --services) ]] || fail '仍有服务在运行，拒绝生成不一致的物理备份。'
docker run --rm --network none --entrypoint /bin/bash \
    -v "$DATA_DIR:/snapshot/data:ro,z" \
    -v "$LOG_DIR:/snapshot/logs:ro,z" \
    -v "$DEPLOY_ROOT/.env:/snapshot/.env:ro,z" \
    -v "$DEPLOY_ROOT/compose.yaml:/snapshot/compose.yaml:ro,z" \
    -v "$BACKUP_DIR:/backup:z" \
    "$DB_IMAGE" -ec 'umask 077; tar -C /snapshot -czpf "/backup/$1.partial" data logs .env compose.yaml; mv "/backup/$1.partial" "/backup/$1"' -- "$backup_name"
# 校验文件由辅助容器创建，兼容 rootless Docker 下的文件属主。
docker run --rm --network none --entrypoint /bin/bash \
    -v "$BACKUP_DIR:/backup:z" "$DB_IMAGE" \
    -ec 'cd /backup; sha256sum "$1" > "$1.sha256"; chmod 600 "$1" "$1.sha256"' -- "$backup_name"
printf '备份已完成：%s/%s（包含 .env 密码，请妥善保管）。\n' "$BACKUP_DIR" "$backup_name"
