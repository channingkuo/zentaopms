#!/usr/bin/env bash
# Exercise merge/branch releases and the original numeric tag path in a tiny repo.
set -Eeuo pipefail
SCRIPT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/prepare-release.sh
WORK=$(mktemp -d)
trap 'rm -rf -- "$WORK"' EXIT
git -C "$WORK" init -q
git -C "$WORK" -c user.name=ReleaseTest -c user.email=release-test@example.invalid commit --allow-empty -qm 'Test release source'
export GITHUB_SHA
GITHUB_SHA=$(git -C "$WORK" rev-parse HEAD)
export GITHUB_OUTPUT="$WORK/output"
cd "$WORK"
printf '22.7\n' > VERSION

GITHUB_REF=refs/heads/release/22.7-xmw bash "$SCRIPT"
grep -Fxq "tag=22.7-xmw-${GITHUB_SHA:0:12}" "$GITHUB_OUTPUT"
grep -Fxq "title=22.7-XMW (${GITHUB_SHA:0:12})" "$GITHUB_OUTPUT"
grep -Fxq "source_sha=$GITHUB_SHA" "$GITHUB_OUTPUT"
grep -Fxq 'create_tag=true' "$GITHUB_OUTPUT"
# Re-running the same source resolves to the same release.
cp "$GITHUB_OUTPUT" "$WORK/first"
: > "$GITHUB_OUTPUT"
GITHUB_REF=refs/heads/release/22.7-xmw bash "$SCRIPT"
cmp "$WORK/first" "$GITHUB_OUTPUT"

# Each newly merged commit gets a new tag without moving the numeric source tag.
previous_sha=$GITHUB_SHA
git -c user.name=ReleaseTest -c user.email=release-test@example.invalid commit --allow-empty -qm 'Merge next change'
GITHUB_SHA=$(git rev-parse HEAD)
: > "$GITHUB_OUTPUT"
GITHUB_REF=refs/heads/release/22.7-xmw bash "$SCRIPT"
grep -Fxq "tag=22.7-xmw-${GITHUB_SHA:0:12}" "$GITHUB_OUTPUT"
! grep -Fxq "tag=22.7-xmw-${previous_sha:0:12}" "$GITHUB_OUTPUT"

for version in 22.7 22.7.1; do
  printf '%s\n' "$version" > VERSION
  : > "$GITHUB_OUTPUT"
  GITHUB_REF="refs/tags/$version" bash "$SCRIPT"
  grep -Fxq "tag=$version" "$GITHUB_OUTPUT"
  grep -Fxq "title=$version-XMW" "$GITHUB_OUTPUT"
  grep -Fxq 'create_tag=false' "$GITHUB_OUTPUT"
done

printf '22.7\n' > VERSION
for ref in refs/heads/main refs/heads/feat/test refs/pull/1/merge refs/tags/22.8 refs/tags/22.7-xmw-test; do
  : > "$GITHUB_OUTPUT"
  if GITHUB_REF="$ref" bash "$SCRIPT" > "$WORK/rejected" 2>&1; then echo "Unexpectedly accepted $ref" >&2; exit 1; fi
  test ! -s "$GITHUB_OUTPUT"
done
for version in '' 22.7-beta '22.7 injected=value'; do
  printf '%s\n' "$version" > VERSION
  if GITHUB_REF=refs/heads/release/22.7-xmw bash "$SCRIPT" > "$WORK/rejected" 2>&1; then echo 'Accepted invalid VERSION' >&2; exit 1; fi
done
printf '22.7\n' > VERSION
if GITHUB_SHA="$previous_sha" GITHUB_REF=refs/heads/release/22.7-xmw bash "$SCRIPT" > "$WORK/rejected" 2>&1; then echo 'Accepted wrong checkout' >&2; exit 1; fi
test -z "$(git tag)"
echo 'PASS: branch merges, unique commit tags, reruns, numeric tags, rejected refs/versions/checkout, no tag mutation'
