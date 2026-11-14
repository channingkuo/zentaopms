#!/usr/bin/env bash
set -Eeuo pipefail
mkdir -p /deploy-logs /opt/zbox/logs /data/php/log /data/zentao/tmp/log
chown nobody:nogroup /opt/zbox/logs /data/php/log /data/zentao/tmp/log
exec > >(tee -a /deploy-logs/container.log) 2>&1
# 官方 getWebRoot() 会把非空的 / 拼成 //，使 CSS/JS 成为跨主机地址。
# 用空环境变量表示根路径，Apache 的 DocumentRoot 已指向 www。
if [[ "${ZT_WEB_ROOT:-/}" == / ]]; then
    export ZT_WEB_ROOT=''
    export APP_WEB_ROOT=''
fi
for template in /opt/zbox/etc/apache/httpd.conf*.tpl; do
    sed -i 's|"/dev/stderr"|"/opt/zbox/logs/apache_error.log"|g; s|"/dev/stdout"|"/opt/zbox/logs/apache_access.log"|g' "$template"
done
# 将 PHP 错误写入持久化文件，而非只依赖容器 stdout。
sed -i -E 's/^[; ]*log_errors[ ]*=.*/log_errors = On/' /opt/zbox/etc/php/php.ini.tpl
# 保留官方进程管理及信号处理逻辑。
exec /usr/bin/entrypoint.sh "$@"
