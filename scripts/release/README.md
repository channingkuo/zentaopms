# XMW Release

基于官方源码标签 `zentaopms_22.7_20261103`，将包含本工作流的提交推送为 `22.7` 标签后自动构建发布。Release 标题为 `22.7-XMW`；重新运行该标签的工作流会先完成构建和测试，再删除同标签的旧 Release 并发布新资产，源码标签保留。可重新运行该标签已有的 Actions 运行记录。若工作流也已合入默认分支，可选择该标签手动运行；分支上的手动运行不会发布。

默认从官方 Docker Hub 镜像站 `easysoft/zentao:22.7` 拉取官方镜像，数据库固定 `mariadb:10.11.19`。本包封装官方二进制镜像，**不会将此仓库源码重新编译进镜像**。如需发布二次开发代码，应另行增加源码镜像构建流程。

本地构建与联调：

```bash
bash scripts/release/build-xmw.sh
bash scripts/release/smoke-xmw.sh dist/zentao-22.7-linux-amd64-offline.tar.gz
```

也可显式指定官方主仓库：`ZENTAO_IMAGE=hub.zentao.net/app/zentao:22.7 bash scripts/release/build-xmw.sh`。归档会记录实际来源与摘要，不自动降级到其他版本。

CI 需要访问官方镜像仓库和 Docker Hub。发布仅使用 GitHub 提供的 `GITHUB_TOKEN`，无额外 PAT；仓库须允许 Actions 及 `contents: write`。相同标签串行执行。发布失败可能留下草稿，可重跑；旧 Release 删除仅发生在新包构建与全部 smoke 测试通过之后。
