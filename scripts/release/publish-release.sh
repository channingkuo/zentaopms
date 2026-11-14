#!/usr/bin/env bash
# Publish only artifacts that already passed the package jobs.
set -euo pipefail
cd dist
shopt -s nullglob
offline=(zentao-*-linux-amd64-offline.tar.gz)
plugin=(xmwprogramgantt-*.zip)
if [[ ${#offline[@]} != 1 || ${#plugin[@]} != 1 ]]; then
  echo 'Expected exactly one tested offline bundle and one tested plugin ZIP.' >&2
  exit 1
fi
assets=("${offline[0]}" "${plugin[0]}")
checksums=("${offline[0]}.sha256" "${plugin[0]}.sha256")
sha256sum --strict --check "${checksums[@]}"
if [[ "$CREATE_TAG" == true ]]; then
  # Branch releases get a distinct tag bound to the exact tested commit.
  tag_sha=$(gh api "repos/$GH_REPO/git/matching-refs/tags/$TAG" \
    --jq ".[] | select(.ref == \"refs/tags/$TAG\") | .object.sha")
  if [[ -z "$tag_sha" ]]; then
    gh api --method POST "repos/$GH_REPO/git/refs" -f "ref=refs/tags/$TAG" -f "sha=$SOURCE_SHA" >/dev/null
  elif [[ "$tag_sha" != "$SOURCE_SHA" ]]; then
    echo 'Release tag points to a different source commit; refusing to publish.' >&2
    exit 1
  fi
fi
# Read failures must abort; do not mistake authorization/network errors for absence.
releases=$(gh api --paginate "repos/$GH_REPO/releases" --jq '.[].tag_name')
if grep -Fxq -- "$TAG" <<< "$releases"; then
  gh release delete "$TAG" --yes
fi
# Keep the source tag. Build/test failures never reach this job.
gh release create "$TAG" --verify-tag --draft --title "$TITLE" \
  --notes "Linux amd64 离线一键部署包，构建提交：$SOURCE_SHA。包含官方禅道和 MariaDB 镜像、统一 .env、持久化数据/日志、备份脚本及 SHA-256 校验。离线包下载后解压，运行 sudo ./deploy.sh up。甘特图插件请另下载附件 ${plugin[0]}，在禅道后台插件管理中本地安装；插件未预装到官方镜像。"
gh release upload "$TAG" "${assets[@]}" "${checksums[@]}"
gh release edit "$TAG" --draft=false --latest
