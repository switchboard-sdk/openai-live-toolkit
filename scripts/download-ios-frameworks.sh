#!/usr/bin/env bash
#
# Downloads the Switchboard SDK + extension xcframeworks for iOS.
#
# Invoked by OpenAILiveToolkit.podspec's `prepare_command` during `pod install`.
# Fetches the public Switchboard SDK builds. The downloaded binaries are
# git-ignored and re-fetched on a clean checkout.
#
# SWITCHBOARD_BUILD picks the build as <channel>/<version>: "release/3.3.0"
# (default) or "develop/<version>".
#
# SWITCHBOARD_LOCAL_BUILD=<switchboard-sdk checkout>/out copies the packages
# built there instead. Packages it doesn't have are still downloaded.
#
# Layout produced (matches the podspec's vendored_frameworks / search paths):
#   ios/Frameworks/<Package>/ios/include/...           (C++ headers)
#   ios/Frameworks/<Package>/ios/<Package>.xcframework (binary)
set -euo pipefail

SWITCHBOARD_BUILD="${SWITCHBOARD_BUILD:-release/3.3.0}"
PUBLIC_URL="https://switchboard-sdk-public.s3.amazonaws.com/builds"

PACKAGES=(SwitchboardSDK SwitchboardOnnx SwitchboardSileroVAD SwitchboardOpenAI)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRAMEWORKS_DIR="${SCRIPT_DIR}/../ios/Frameworks"

case "${SWITCHBOARD_BUILD}" in
  */*) ;;
  *)
    echo "error: SWITCHBOARD_BUILD is <channel>/<version>, such as develop/3.3.0 or release/3.3.0." >&2
    exit 1
    ;;
esac
CHANNEL="${SWITCHBOARD_BUILD%%/*}"
VERSION="${SWITCHBOARD_BUILD#*/}"

# A release has a directory per version; a channel such as develop keeps each version's latest build.
package_url() {
  case "${CHANNEL}" in
    release) echo "${PUBLIC_URL}/release/${VERSION}/ios/$1-ios-${VERSION}.zip" ;;
    *) echo "${PUBLIC_URL}/${CHANNEL}/ios/$1-ios-${VERSION}.zip" ;;
  esac
}

mkdir -p "${FRAMEWORKS_DIR}"

for pkg in "${PACKAGES[@]}"; do
  dest="${FRAMEWORKS_DIR}/${pkg}/ios"
  stamp="${dest}/.switchboard-build"

  local_src="${SWITCHBOARD_LOCAL_BUILD:-}/${pkg}/iOS"
  if [ -n "${SWITCHBOARD_LOCAL_BUILD:-}" ] && [ -d "${local_src}/${pkg}.xcframework" ]; then
    # Always copied: a local build changes without its path changing. -L because CocoaPods
    # drops files that resolve outside the pod.
    echo "→ Copying ${pkg} from ${local_src}"
    rm -rf "${dest}"
    mkdir -p "${dest}"
    cp -RL "${local_src}/." "${dest}/"
    echo "local:${local_src}" > "${stamp}"
    continue
  fi

  # The stamp makes the skip build-aware: changing SWITCHBOARD_BUILD re-downloads
  # instead of leaving a stale xcframework in place.
  if [ -d "${dest}/${pkg}.xcframework" ] && [ "$(cat "${stamp}" 2>/dev/null)" = "${SWITCHBOARD_BUILD}" ]; then
    echo "✓ ${pkg} (${SWITCHBOARD_BUILD}) already present — skipping"
    continue
  fi

  url="$(package_url "${pkg}")"
  echo "↓ Downloading ${pkg} (${SWITCHBOARD_BUILD})"
  rm -rf "${dest}"
  mkdir -p "${dest}"
  tmp_zip="${dest}/${pkg}.zip"
  if ! curl -fsSL --retry 3 -o "${tmp_zip}" "${url}"; then
    echo "error: couldn't download ${url}" >&2
    exit 1
  fi

  echo "  Extracting ${pkg}"
  unzip -oq "${tmp_zip}" -d "${dest}"
  rm -f "${tmp_zip}"
  echo "${SWITCHBOARD_BUILD}" > "${stamp}"
done

echo "✓ Switchboard iOS frameworks ready in ios/Frameworks/"
