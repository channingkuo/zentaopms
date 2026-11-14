#!/usr/bin/env bash
set -Eeuo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/scripts/common.sh"
action=${1:-up}
if (($#)); then shift; fi
case "$action" in
    help|-h|--help)
        cat <<'HELP'
用法：./deploy.sh [命令]（省略命令即 up）
  init                 初始化 .env，自动生成随机密码
  up                   导入离线镜像，创建目录并启动，等待健康检查
  check                检查 Docker、参数和 Compose 配置（不输出密码）
  load                 校验并导入离线镜像
  status               查看运行状态
  logs [db|zentao]      持续查看最近 200 行控制台日志
  stop                 停止服务，保留容器和数据
  down                 移除容器及网络，保留宿主机数据和日志
  restart              应用 .env 配置并重建服务，等待健康检查
  backup               短暂停机，完整备份数据、日志及 .env，再恢复原运行状态
  export-images        将当前配置的镜像重新导出到 exports/，用于离线搬运
HELP
        exit 0 ;;
    init|up|check|load|status|logs|stop|down|restart|backup|export-images) ;;
    *) fail "未知命令：$action；执行 ./deploy.sh help 查看帮助。" ;;
esac
if [[ "$action" != logs && "$action" != status ]]; then
    command -v flock >/dev/null || fail '需要 util-linux 提供的 flock 命令。'
    exec 9>"$DEPLOY_ROOT/.deploy.lock"
    flock -n 9 || fail '另一个部署或备份命令正在运行。'
fi
if [[ "$action" == init ]]; then init_env; exit 0; fi
require_docker
case "$action" in
    up|restart|check|load|backup|export-images) init_env ;;
    *) load_env ;;
esac
case "$action" in
    up|restart)
        prepare_dirs
        load_images
        compose config --quiet
        if ! compose up -d --pull never --wait --wait-timeout "$START_TIMEOUT"; then
            compose ps
            printf '启动未就绪；用 ./deploy.sh logs 查看原因，文件日志位于 %s。\n' "$LOG_DIR" >&2
            exit 1
        fi
        printf '\n服务已就绪。浏览器打开：http://服务器IP:%s%s\n' "$HTTP_PORT" "$ZT_WEB_ROOT"
        printf '首次访问请完成官方安装向导，并自行设置管理员账号和密码。\n'
        printf '数据库主机=db，端口=3306，库名=%s，用户=%s，密码见 .env 的 DB_PASSWORD。\n' "$DB_NAME" "$DB_USER"
        printf '数据目录：%s\n日志目录：%s\n' "$DATA_DIR" "$LOG_DIR"
        ;;
    check)
        compose config --quiet
        printf 'Docker / Compose / 架构 / .env / Compose 配置检查通过。\n' ;;
    load) load_images ;;
    status) compose ps -a ;;
    logs)
        (($# <= 1)) || fail '用法：./deploy.sh logs [db|zentao]'
        if (($#)); then [[ "$1" == db || "$1" == zentao ]] || fail '服务名只能是 db 或 zentao'; fi
        compose logs --tail=200 --follow "$@" ;;
    stop) compose stop --timeout "$STOP_TIMEOUT" ;;
    down) compose down --timeout "$STOP_TIMEOUT" ;;
    backup) source "$DEPLOY_ROOT/scripts/backup.sh" ;;
    export-images)
        load_images
        mkdir -p "$DEPLOY_ROOT/exports"
        file="$DEPLOY_ROOT/exports/images-$(date +%Y%m%d-%H%M%S)-amd64.tar.gz"
        docker save "$ZENTAO_IMAGE" "$DB_IMAGE" | gzip -1 > "$file.partial"
        mv "$file.partial" "$file"
        (cd "$DEPLOY_ROOT/exports" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
        printf '已导出：%s\n' "$file" ;;
esac
