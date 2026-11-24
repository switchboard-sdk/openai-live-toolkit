#!/usr/bin/env bash
#
# Downloads the Switchboard SDK's object types (each node's events and their data) to
# .switchboard/object-types.json, with `npm run sdk:schema`. The Jest suite checks the node
# events it fakes against them, so the fakes can't drift from what the SDK sends.
#
# SWITCHBOARD_BUILD picks the build as in download-ios-frameworks.sh, with the same default.
# A channel such as develop publishes one schema, for its latest build of any version.
set -euo pipefail

SWITCHBOARD_BUILD="${SWITCHBOARD_BUILD:-release/3.3.0}"
PUBLIC_URL="https://switchboard-sdk-public.s3.amazonaws.com/builds"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/../.switchboard"

case "${SWITCHBOARD_BUILD}" in
  */*) ;;
  *)
    echo "error: SWITCHBOARD_BUILD is <channel>/<version>, such as develop/3.3.0 or release/3.3.0." >&2
    exit 1
    ;;
esac
CHANNEL="${SWITCHBOARD_BUILD%%/*}"
VERSION="${SWITCHBOARD_BUILD#*/}"

case "${CHANNEL}" in
  release) url="${PUBLIC_URL}/release/${VERSION}/schemas/object-types.json" ;;
  *) url="${PUBLIC_URL}/${CHANNEL}/schemas/object-types.json" ;;
esac

mkdir -p "${OUT_DIR}"
tmp="${OUT_DIR}/object-types.json.tmp"
echo "↓ Downloading the SDK schema (${SWITCHBOARD_BUILD})"
if ! curl -fsSL --retry 3 -o "${tmp}" "${url}"; then
  rm -f "${tmp}"
  echo "error: couldn't download ${url}" >&2
  exit 1
fi
mv "${tmp}" "${OUT_DIR}/object-types.json"
echo "✓ SDK schema in .switchboard/object-types.json"
