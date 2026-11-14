#!/usr/bin/env bash
# Publish only artifacts that already passed the package jobs.
set -euo pipefail
cd dist
sha256sum --check ./*.tar.gz.sha256
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
  --notes "Linux amd64 离线一键部署包，构建提交：$SOURCE_SHA。包含官方禅道和 MariaDB 镜像、统一 .env、持久化数据/日志、备份脚本及 SHA-256 校验。下载后解压，运行 sudo ./deploy.sh up。首次访问完成官方安装向导。"
gh release upload "$TAG" ./*.tar.gz ./*.tar.gz.sha256
gh release edit "$TAG" --draft=false --latest
