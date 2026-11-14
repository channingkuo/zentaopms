# 禅道 22.7-XMW 离线一键部署包（Linux amd64）

包含官方禅道 22.7、MariaDB 10.11.19 完整镜像，无需服务器访问镜像仓库。
需要 x86_64 Linux、Docker Engine、Compose >= 2.24（支持插件和独立版，包括 v5）、Bash、util-linux、GNU coreutils 和 tar。

```bash
sha256sum -c zentao-22.7-linux-amd64-offline.tar.gz.sha256
tar -xzf zentao-22.7-linux-amd64-offline.tar.gz
cd zentao-deploy
vi .env
sudo ./deploy.sh up
```

访问 `http://服务器IP:8080/`，完成官方安装向导并设置管理员。数据库主机 `db`、端口 `3306`，账号和密码见 `.env`。不会预置业务管理员或测试数据。

所有参数在 `.env` 中，脚本读取而不执行该文件。首次启动自动生成独立随机数据库密码；再次启动保留密码。不要丢失已有数据库对应的 `.env`。文件仅支持 `.env.example` 列出的参数，不支持插值、转义或行尾注释。路径相对部署目录解析，默认放在部署包的同级目录：

```dotenv
DATA_DIR=../zentao-data
LOG_DIR=../zentao-logs
BACKUP_DIR=../zentao-backups
```

例如在 `/data-8t/zentao/zentao-deploy` 下部署，三个目录分别为 `/data-8t/zentao/zentao-data`、`/data-8t/zentao/zentao-logs`、`/data-8t/zentao/zentao-backups`。已有 `.env` 不会被覆盖，已有数据不会自动迁移。

脚本优先使用 `docker compose` 插件，找不到兼容版本时自动使用独立版 `docker-compose`。运行 `docker compose version` 或 `docker-compose version`，任一输出 Compose >= 2.24 即可（例如独立版 v5.6.0）；不支持旧版 v1。

两种命令都不可用时，Ubuntu/Debian 在配置了 Docker 官方软件源后可以安装插件：

```bash
sudo apt-get update
sudo apt-get install docker-compose-plugin
docker compose version
```

其他发行版或尚未配置 Docker 软件源时，按 https://docs.docker.com/compose/install/linux/ 安装插件。Docker Engine 本身可用不代表已安装 Compose 插件。

- `DATA_DIR`：MariaDB 数据在 `mysql/`；禅道配置、附件和 session 在 `zentao/`。
- `LOG_DIR`：Apache、PHP、禅道、数据库及启动控制台日志分别映射。
- `BACKUP_DIR`：停机物理备份，包括数据、日志、`.env` 和编排文件，权限为 600。
- `HTTP_PORT`/`BIND_IP`：默认 `0.0.0.0:8080`，数据库端口不对外开放。
- Docker 控制台日志自动轮转；文件日志需由运维配置轮转策略。

`./deploy.sh help` 查看启停、状态、日志、镜像导入与备份命令。`down` 保留宿主机数据；`restart` 应用配置并重建容器。SMTP/LDAP 为可选集成，需在安装后核对应用设置。

## 备份恢复

`sudo ./deploy.sh backup` 会短暂停止全部服务，保存一致的数据与附件快照，再恢复原先运行的服务。备份包含凭据与业务数据，请妥善保管。

恢复到相同版本的全新目录：先解压部署包，不启动服务；从备份中提取 `.env`，保留原数据库凭据；执行 `./deploy.sh load`。将备份的 `data` 和 `logs` 用保持 UID/GID 的 `tar -xzpf` 恢复到空目录，再执行 `./deploy.sh up`。可使用包内 MariaDB 镜像作为辅助容器处理 rootless Docker 的 UID 映射。不要覆盖现有数据库，也不要跨数据库主版本直接恢复物理备份。

## 构建与验证

`images/images.lock` 记录实际拉取的官方镜像 ID，导入前验证归档 SHA-256，导入后核对 ID。`docs/images.jsonl` 保存镜像摘要与元数据，`docs/BUILD.txt` 记录源码提交。官方镜像保留原始层和许可，不包含仓库二次开发代码。

CI 使用完整交付归档执行 `docker load`、安装页面访问、日志落盘、容器重建持久化、停机备份和空目录恢复测试，通过后才发布。未覆盖管理员创建后的完整业务流程、SMTP/LDAP 或各发行版 SELinux 策略。

官方说明：https://www.zentao.net/book/zentaopms/docker-1111.html
