#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd "$ROOT"
VERSION=$(cat VERSION)
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo 'Invalid VERSION' >&2; exit 1; }
# Mirror can be selected explicitly when the primary registry is unreachable.
ZENTAO_IMAGE=${ZENTAO_IMAGE:-easysoft/zentao:$VERSION}
DB_IMAGE=mariadb:10.11.19
OUT=${OUT:-$ROOT/dist}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd -P)
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
PACKAGE="$WORK/zentao-deploy"
cp -a deploy/xmw "$PACKAGE"
mkdir -p "$PACKAGE/images" "$PACKAGE/docs/licenses"
sed -i "s|^ZENTAO_IMAGE=.*|ZENTAO_IMAGE=$ZENTAO_IMAGE|" "$PACKAGE/.env.example"
cp "$PACKAGE/.env.example" "$PACKAGE/.env"
chmod 600 "$PACKAGE/.env"
: > "$PACKAGE/images/images.lock"
: > "$PACKAGE/images/identities.lock"
: > "$PACKAGE/docs/images.jsonl"
for ref in "$ZENTAO_IMAGE" "$DB_IMAGE"; do
  docker pull --platform linux/amd64 "$ref"
  test "$(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}')" = linux/amd64
  filename="$(basename "$ref" | tr ':' '-')-linux-amd64.tar.gz"
  docker save "$ref" | gzip -1 > "$PACKAGE/images/$filename"
  id=$(python3 scripts/release/archive-identity.py "$PACKAGE/images/$filename" "$ref" "$PACKAGE/images/identities.lock")
  (cd "$PACKAGE/images" && sha256sum "$filename" > "$filename.sha256")
  printf '%s|%s|%s\n' "$ref" "$filename" "$id" >> "$PACKAGE/images/images.lock"
  docker image inspect "$ref" --format '{{json .}}' >> "$PACKAGE/docs/images.jsonl"
done
container=$(docker create --platform linux/amd64 "$ZENTAO_IMAGE")
# Never start or modify the upstream image while collecting license files.
for license in LICENSE.CN LICENSE.EN GITFOX_LICENSE; do
  if ! docker cp "$container:/apps/zentao/$license" "$PACKAGE/docs/licenses/$license"; then
    docker rm "$container" >/dev/null
    exit 1
  fi
done
docker rm "$container" >/dev/null
printf 'source_commit=%s\nversion=%s\nplatform=linux/amd64\n' "$(git rev-parse HEAD)" "$VERSION" > "$PACKAGE/docs/BUILD.txt"
(cd "$PACKAGE" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256)
archive="zentao-$VERSION-linux-amd64-offline.tar.gz"
tar --owner=0 --group=0 --numeric-owner -C "$WORK" -cf - zentao-deploy | gzip -1 > "$OUT/$archive.partial"
mv "$OUT/$archive.partial" "$OUT/$archive"
(cd "$OUT" && sha256sum "$archive" > "$archive.sha256")
printf 'Built %s/%s\n' "$OUT" "$archive"
