#!/usr/bin/env bash
#
# Downloads the Switchboard SDK + extension AARs for Android.
#
# Run by android/build.gradle when an AAR is missing, or directly with
# `npm run android:libraries`. Fetches the public Switchboard SDK builds. The
# downloaded binaries are git-ignored and re-fetched on a clean checkout.
#
# SWITCHBOARD_BUILD picks the build as <channel>/<version>: "develop/3.3.0"
# (default) or "release/<version>".
#
# SWITCHBOARD_LOCAL_BUILD=<switchboard-sdk checkout>/out copies the AARs built
# there instead. Packages it doesn't have are still downloaded.
#
# Layout produced (matches android/build.gradle):
#   android/libs/<Package>.aar
set -euo pipefail

SWITCHBOARD_BUILD="${SWITCHBOARD_BUILD:-develop/3.3.0}"
PUBLIC_URL="https://switchboard-sdk-public.s3.amazonaws.com/builds"

PACKAGES=(SwitchboardSDK SwitchboardOnnx SwitchboardSileroVAD SwitchboardOpenAI)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBS_DIR="${SCRIPT_DIR}/../android/libs"

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
    release) echo "${PUBLIC_URL}/release/${VERSION}/android/$1-android-${VERSION}.zip" ;;
    *) echo "${PUBLIC_URL}/${CHANNEL}/android/$1-android-${VERSION}.zip" ;;
  esac
}

mkdir -p "${LIBS_DIR}"

for pkg in "${PACKAGES[@]}"; do
  dest="${LIBS_DIR}/${pkg}.aar"
  stamp="${LIBS_DIR}/.${pkg}.switchboard-build"

  local_src="${SWITCHBOARD_LOCAL_BUILD:-}/${pkg}/Android/${pkg}.aar"
  if [ -n "${SWITCHBOARD_LOCAL_BUILD:-}" ] && [ -f "${local_src}" ]; then
    # Always copied: a local build changes without its path changing.
    echo "→ Copying ${pkg} from ${local_src}"
    cp "${local_src}" "${dest}"
    echo "local:${local_src}" > "${stamp}"
    continue
  fi

  # The stamp makes the skip build-aware: changing SWITCHBOARD_BUILD re-downloads
  # instead of leaving a stale AAR in place.
  if [ -f "${dest}" ] && [ "$(cat "${stamp}" 2>/dev/null)" = "${SWITCHBOARD_BUILD}" ]; then
    echo "✓ ${pkg} (${SWITCHBOARD_BUILD}) already present — skipping"
    continue
  fi

  url="$(package_url "${pkg}")"
  echo "↓ Downloading ${pkg} (${SWITCHBOARD_BUILD})"
  # Extract next to the AAR and move it into place, so a failed download keeps the old copy.
  tmp_dir="$(mktemp -d "${LIBS_DIR}/.${pkg}.XXXXXX")"
  trap 'rm -rf "${tmp_dir}"' EXIT
  if ! curl -fsSL --retry 3 -o "${tmp_dir}/${pkg}.zip" "${url}"; then
    echo "error: couldn't download ${url}" >&2
    exit 1
  fi

  echo "  Extracting ${pkg}"
  unzip -oq "${tmp_dir}/${pkg}.zip" -d "${tmp_dir}"
  mv "${tmp_dir}/${pkg}.aar" "${dest}"
  rm -rf "${tmp_dir}"
  trap - EXIT
  echo "${SWITCHBOARD_BUILD}" > "${stamp}"
done

echo "✓ Switchboard Android libraries ready in android/libs/"
