# XMW Release

基于官方源码标签 `zentaopms_22.7_20261103`，支持以下发布入口：

- PR 合并到 `release/22.7-xmw` 后自动触发，直接推送该分支也会触发。读取合并提交的 `VERSION`，生成 `22.7-xmw-<提交 SHA 前 12 位>` 标签，Release 标题为 `22.7-XMW (<提交 SHA 前 12 位>)`。每个新提交拥有独立 Release，不会移动原来的 `22.7` 标签。
- 推送与 `VERSION` 一致的数字版本标签（如 `22.7`）仍自动发布，Release 标题仍为 `22.7-XMW`。自动生成的 `*-xmw-*` 标签不触发第二次构建。
- 可重跑已有 Actions 运行记录。若工作流也已合入默认分支，可手动选择 `release/22.7-xmw` 或数字版本标签运行；其他分支不发布。

构建固定检出触发事件对应的提交，分支继续前进不会改变本次构建来源。两种 Docker 存储后端的构建和 smoke 测试全部通过后才创建分支发布标签、上传资产并发布。重跑同一提交或同一版本标签时，会在验证成功后替换同标签的旧 Release，源码标签保留；若已有分支发布标签指向其他提交则拒绝发布。包内 `docs/BUILD.txt` 和 Release 说明记录完整源码提交。

每次 Release 同时提供离线部署包及其 `.sha256`、`xmwprogramgantt-<插件版本>.zip` 及其 `.zip.sha256`，可以在 Release 页面的 Assets 中直接下载插件。插件版本由 `scripts/program-gantt/VERSION` 统一声明；构建来源与离线包固定为同一提交。插件的 PHP/权限/实际安装包和浏览器流程回归通过后才上传，插件缺失或任一校验和失败会阻止发布。浏览器回归覆盖管理员首次通过菜单进入甘特图、反复切换、局部刷新、拖动及图片/PDF 导出。

涉及本工作流或发布脚本的 PR 在合并前仅运行发布逻辑校验，不构建镜像、不创建标签或 Release；关闭但未合并 PR 也不会触发发布。

默认从官方 Docker Hub 镜像站 `easysoft/zentao:22.7` 拉取官方镜像，数据库固定 `mariadb:10.11.19`。离线包封装官方二进制镜像，不会将此仓库源码重新编译进镜像。甘特图作为独立 Release 附件提供，需要在禅道「后台 → 插件管理 → 本地安装」上传 ZIP；插件不会因部署离线包而自动安装。

本地构建与联调：

```bash
# 不访问 GitHub 或 Docker 的发布逻辑回归
bash scripts/release/test-prepare-release.sh
python3 scripts/release/test-publish-release.py

bash scripts/release/build-xmw.sh
bash scripts/release/smoke-xmw.sh dist/zentao-22.7-linux-amd64-offline.tar.gz
```

也可显式指定官方主仓库：`ZENTAO_IMAGE=hub.zentao.net/app/zentao:22.7 bash scripts/release/build-xmw.sh`。归档会记录实际来源与摘要，不自动降级到其他版本。

CI 需要访问官方镜像仓库和 Docker Hub。发布仅使用 GitHub 提供的 `GITHUB_TOKEN`，无额外 PAT；仓库须允许 Actions 及 `contents: write`。相同标签串行执行。发布失败可能留下草稿，可重跑；旧 Release 删除仅发生在新包构建与全部 smoke 测试通过之后。
