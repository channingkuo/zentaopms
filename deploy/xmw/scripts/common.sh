#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s extglob
DEPLOY_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
compose() { docker compose --project-directory "$DEPLOY_ROOT" --env-file "$DEPLOY_ROOT/.env" -f "$DEPLOY_ROOT/compose.yaml" -p "$COMPOSE_PROJECT_NAME" "$@"; }
trim() { REPLY=${1##+([[:space:]])}; REPLY=${REPLY%%+([[:space:]])}; }
load_env() {
    [[ -f "$DEPLOY_ROOT/.env" ]] || cp "$DEPLOY_ROOT/.env.example" "$DEPLOY_ROOT/.env"
    local line key value allowed
    allowed=$'\n'$(sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' "$DEPLOY_ROOT/.env.example")$'\n'
    while IFS= read -r line || [[ -n "$line" ]]; do
        trim "${line%$'\r'}"; line=$REPLY
        [[ -z "$line" || "$line" == \#* ]] && continue
        [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || fail '.env 需使用 KEY=value 格式，不支持多行。'
        key=${BASH_REMATCH[1]}; trim "${BASH_REMATCH[2]}"; value=$REPLY
        [[ "$allowed" == *$'\n'"$key"$'\n'* ]] || fail ".env 中存在未知参数：$key"
        if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value=${value:1:${#value}-2}; fi
        [[ "$value" != *'$'* && "$value" != *'\'* && "$value" != *'`'* ]] || fail ".env 参数 $key 不支持变量插值、反斜杠或反引号。"
        export "$key=$value"
    done < "$DEPLOY_ROOT/.env"
    local required
    while IFS= read -r required; do
        [[ -v "$required" ]] || fail ".env 缺少参数：$required，请对照 .env.example 补齐。"
    done < <(sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' "$DEPLOY_ROOT/.env.example")
    [[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail 'COMPOSE_PROJECT_NAME 仅支持小写字母、数字、下划线、短横线。'
    [[ "$PLATFORM" == linux/amd64 ]] || fail '本离线包仅包含 linux/amd64 镜像。'
    [[ "$HTTP_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$HTTP_PORT > 0 && 10#$HTTP_PORT <= 65535)) || fail 'HTTP_PORT 必须是 1~65535。'
    [[ "$START_TIMEOUT" =~ ^[1-9][0-9]*$ && "$STOP_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || fail '超时参数必须为正整数。'
    [[ "$DB_NAME" =~ ^[a-zA-Z][a-zA-Z0-9_]{0,63}$ ]] || fail 'DB_NAME 需以字母开头，仅包含字母、数字、下划线。'
    [[ "$DB_USER" =~ ^[a-zA-Z][a-zA-Z0-9_]{0,31}$ && "$DB_USER" != root ]] || fail '请使用独立的 DB_USER（字母、数字、下划线，不能是 root）。'
    local path_key path_value
    for path_key in DATA_DIR LOG_DIR BACKUP_DIR; do
        path_value=${!path_key}; [[ -n "$path_value" ]] || fail "$path_key 不能为空。"
        [[ "$path_value" == /* ]] || path_value="$DEPLOY_ROOT/$path_value"
        path_value=$(readlink -m -- "$path_value")
        [[ "$path_value" != / && "$path_value" != "$DEPLOY_ROOT" && "$path_value" != *:* && "$path_value" != *,* ]] || fail "$path_key 路径不适用。"
        export "$path_key=$path_value"
    done
    [[ "$DATA_DIR/" != "$LOG_DIR/"* && "$LOG_DIR/" != "$DATA_DIR/"* && "$BACKUP_DIR/" != "$DATA_DIR/"* && "$DATA_DIR/" != "$BACKUP_DIR/"* && "$BACKUP_DIR/" != "$LOG_DIR/"* && "$LOG_DIR/" != "$BACKUP_DIR/"* ]] || fail '数据、日志、备份目录不能相同或相互包含。'
}
require_docker() {
    command -v docker >/dev/null || fail '请先安装 Docker Engine 和 Docker Compose v2 插件，见 README.md。'
    docker info >/dev/null 2>&1 || fail '无法连接 Docker，请启动 Docker 服务，或使用 sudo ./deploy.sh up。'
    local ver major minor
    ver=$(docker compose version 2>/dev/null) || fail '未检测到 Docker Compose v2 插件。请安装 Compose >= 2.24，并确认 docker compose version 可用，见 README.md。'
    [[ "$ver" =~ ^Docker[[:space:]]Compose[[:space:]]version[[:space:]]v?([0-9]+)\.([0-9]+) ]] || fail '无法识别 Compose 版本。请确认 docker compose version 输出 Docker Compose version v2.24 或更高版本。'
    major=${BASH_REMATCH[1]}; minor=${BASH_REMATCH[2]}
    ((major > 2 || major == 2 && minor >= 24)) || fail '需要 Docker Compose >= 2.24。'
    [[ $(uname -m) == x86_64 ]] || fail '此离线包需要 x86_64 服务器。'
}
check_passwords() {
    local key value
    for key in DB_PASSWORD DB_ROOT_PASSWORD; do
        value=${!key}
        [[ "$value" =~ ^[a-zA-Z0-9_.@%+=:-]{16,128}$ && "$value" != __AUTO__ ]] || fail "$key 需要 16~128 位字母、数字或 _.@%+=:-；首次启动可使用 __AUTO__ 自动生成。"
    done
    [[ "$DB_PASSWORD" != "$DB_ROOT_PASSWORD" ]] || fail '应用密码和 root 密码需使用不同值。'
}
init_env() {
    load_env
    if [[ "$DB_PASSWORD" == __AUTO__ || "$DB_ROOT_PASSWORD" == __AUTO__ ]]; then
        if [[ -d "$DATA_DIR/mysql" ]]; then
            [[ -r "$DATA_DIR/mysql" && -x "$DATA_DIR/mysql" ]] || fail '无法检查现有数据库目录，请恢复原 .env；不要重新生成密码。'
            [[ -z $(ls -A -- "$DATA_DIR/mysql") ]] || fail '已存在数据库文件，但 .env 仍为 __AUTO__；请恢复原 .env，不能重新生成密码。'
        fi
        local tmp key value
        tmp=$(mktemp "$DEPLOY_ROOT/.env.XXXXXX")
        cp "$DEPLOY_ROOT/.env" "$tmp"
        for key in DB_PASSWORD DB_ROOT_PASSWORD; do
            if [[ ${!key} == __AUTO__ ]]; then
                value=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
                sed -i "s/^$key=.*/$key=$value/" "$tmp"
            fi
        done
        chmod 600 "$tmp"; mv -f -- "$tmp" "$DEPLOY_ROOT/.env"
        printf '已生成独立随机数据库密码并保存到 .env（权限 600）。\n'
        load_env
    fi
    chmod 600 "$DEPLOY_ROOT/.env"
    check_passwords
}
prepare_dirs() {
    mkdir -p -- "$DATA_DIR/mysql" "$DATA_DIR/zentao" "$LOG_DIR/mysql" "$LOG_DIR/apache" "$LOG_DIR/php" "$LOG_DIR/zentao" "$LOG_DIR/runtime" "$BACKUP_DIR"
}
load_images() {
    local ref file expected actual
    while IFS='|' read -r ref file expected; do
        # 用户改用其他版本镜像时，不覆盖用户指定的镜像。
        [[ "$ref" == "$ZENTAO_IMAGE" || "$ref" == "$DB_IMAGE" ]] || continue
        actual=$(docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null || true)
        if [[ "$actual" != "$expected" ]]; then
            [[ -f "$DEPLOY_ROOT/images/$file" ]] || fail "缺少离线镜像：images/$file"
            printf '校验并导入离线镜像：%s\n' "$ref"
            (cd "$DEPLOY_ROOT/images" && sha256sum --check --status "$file.sha256") || fail "离线镜像校验失败：$file"
            docker load --input "$DEPLOY_ROOT/images/$file"
            actual=$(docker image inspect "$ref" --format '{{.Id}}')
            [[ "$actual" == "$expected" ]] || fail "导入镜像 ID 不匹配：$ref"
        fi
    done < "$DEPLOY_ROOT/images/images.lock"
    for ref in "$ZENTAO_IMAGE" "$DB_IMAGE"; do
        docker image inspect "$ref" >/dev/null 2>&1 || fail "本地不存在 $ref，请先 docker pull 或 docker load 后重试。"
        [[ $(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}') == "$PLATFORM" ]] || fail "镜像架构不匹配：$ref"
    done
}
