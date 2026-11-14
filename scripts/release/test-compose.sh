#!/usr/bin/env bash
# Exercise both command layouts, minimum versions, and command forwarding.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
for scenario in plugin standalone newer-standalone missing legacy; do
  export SCENARIO="$scenario"
  if output=$(bash -c '
    source "$1/deploy/xmw/scripts/common.sh"
    docker() {
      if [[ "$*" == info ]]; then return 0; fi
      if [[ "$*" == "compose version" ]]; then
        case "$SCENARIO" in
          plugin) echo "Docker Compose version v2.40.3" ;;
          newer-standalone) echo "Docker Compose version v2.23.0" ;;
          *) return 1 ;;
        esac
      else
        [[ "$SCENARIO" == plugin && "$1" == compose && "${*: -2}" == "config --quiet" ]] || return 98
        echo plugin-forwarded
      fi
    }
    docker-compose() {
      if [[ "$*" == version ]]; then
        case "$SCENARIO" in
          standalone|newer-standalone) echo "Docker Compose version v5.6.0" ;;
          legacy) echo "docker-compose version 1.29.2" ;;
          *) return 1 ;;
        esac
      else
        [[ "${*: -2}" == "config --quiet" ]] || return 98
        echo standalone-forwarded
      fi
    }
    require_docker
    COMPOSE_PROJECT_NAME=test
    compose config --quiet
  ' test "$ROOT" 2>&1); then
    case "$scenario" in
      plugin) [[ "$output" == plugin-forwarded ]] ;;
      standalone|newer-standalone) [[ "$output" == standalone-forwarded ]] ;;
      *) echo "Unexpected success: $scenario" >&2; exit 1 ;;
    esac
  else
    [[ "$scenario" == missing || "$scenario" == legacy ]] || { echo "$output" >&2; exit 1; }
    [[ "$output" == *'需要 Docker Compose >= 2.24'* ]]
  fi
done
echo 'PASS: plugin, standalone v5, old-plugin fallback, missing Compose, legacy v1, command forwarding'
