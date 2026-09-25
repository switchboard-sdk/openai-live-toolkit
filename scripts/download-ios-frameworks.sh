#!/usr/bin/env bash
#
# Downloads the Switchboard SDK + extension xcframeworks for iOS.
#
# Invoked by OpenAILiveToolkit.podspec's `prepare_command` during `pod install`.
# Pulls private builds from Switchboard's S3 bucket (AICoustics isn't published
# publicly), so it needs AWS credentials with read access to s3://switchboard-sdk.
# The downloaded binaries are git-ignored and re-fetched on a clean checkout.
#
# SWITCHBOARD_BUILD picks the build: a branch build (default, until OpenAI.Live
# ships in a release) or "release/<version>".
#
# Layout produced (matches the podspec's vendored_frameworks / search paths):
#   ios/Frameworks/<Package>/ios/include/...           (C++ headers)
#   ios/Frameworks/<Package>/ios/<Package>.xcframework (binary)
#   ios/Frameworks/<Package>/ios/models/...            (AICoustics models)
set -euo pipefail

SWITCHBOARD_BUILD="${SWITCHBOARD_BUILD:-ivannador/swi-6906-openailive-node-in-switchboardopenai-extension}"
BASE_URL="s3://switchboard-sdk/builds/${SWITCHBOARD_BUILD}/ios"

PACKAGES=(SwitchboardSDK SwitchboardOpenAI SwitchboardAICoustics)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORKS_DIR="${SCRIPT_DIR}/../ios/Frameworks"

if ! command -v aws &> /dev/null; then
  echo "error: the AWS CLI is required to fetch private Switchboard builds (brew install awscli)." >&2
  exit 1
fi

mkdir -p "${FRAMEWORKS_DIR}"

for pkg in "${PACKAGES[@]}"; do
  dest="${FRAMEWORKS_DIR}/${pkg}/ios"
  stamp="${dest}/.switchboard-build"
  # The stamp makes the skip build-aware: changing SWITCHBOARD_BUILD re-downloads
  # instead of leaving a stale xcframework in place.
  if [ -d "${dest}/${pkg}.xcframework" ] && [ "$(cat "${stamp}" 2>/dev/null)" = "${SWITCHBOARD_BUILD}" ]; then
    echo "✓ ${pkg} (${SWITCHBOARD_BUILD}) already present — skipping"
    continue
  fi

  echo "↓ Downloading ${pkg} (${SWITCHBOARD_BUILD})"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  tmp_zip="${dest}/${pkg}.zip"
  aws s3 cp --only-show-errors "${BASE_URL}/${pkg}.zip" "${tmp_zip}"

  echo "  Extracting ${pkg}"
  unzip -oq "${tmp_zip}" -d "${dest}"
  rm -f "${tmp_zip}"
  echo "${SWITCHBOARD_BUILD}" > "${stamp}"
done

echo "✓ Switchboard iOS frameworks ready in ios/Frameworks/"
