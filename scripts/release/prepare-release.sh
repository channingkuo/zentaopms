#!/usr/bin/env bash
# Resolve release identity without creating tags or changing repository state.
set -Eeuo pipefail
version=$(cat VERSION)
[[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo 'Invalid VERSION' >&2; exit 1; }
source_sha=$(git rev-parse HEAD)
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid source commit' >&2; exit 1; }
[[ "$source_sha" == "${GITHUB_SHA:?Missing event commit}" ]] || { echo 'Checkout differs from event commit' >&2; exit 1; }

case "${GITHUB_REF:?Missing event ref}" in
  refs/heads/release/22.7-xmw)
    tag="$version-xmw-${source_sha:0:12}"
    title="$version-XMW (${source_sha:0:12})"
    create_tag=true
    ;;
  refs/tags/*)
    tag=${GITHUB_REF#refs/tags/}
    [[ "$tag" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ && "$tag" == "$version" ]] || { echo 'Tag and VERSION must match' >&2; exit 1; }
    title="$tag-XMW"
    create_tag=false
    ;;
  *) echo 'Only the release/22.7-xmw branch or a matching numeric version tag can publish' >&2; exit 1 ;;
esac

printf 'tag=%s\ntitle=%s\nsource_sha=%s\ncreate_tag=%s\n' \
  "$tag" "$title" "$source_sha" "$create_tag" >> "${GITHUB_OUTPUT:?Missing output file}"
