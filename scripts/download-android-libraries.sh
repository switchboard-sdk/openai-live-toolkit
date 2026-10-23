#!/usr/bin/env bash
#
# Downloads the Switchboard SDK + extension AARs for Android.
#
# Run by android/build.gradle when an AAR is missing, or directly with
# `npm run android:libraries`. Pulls private builds from Switchboard's S3 bucket,
# so it needs AWS credentials with read access to s3://switchboard-sdk. The
# downloaded binaries are git-ignored and re-fetched on a clean checkout.
#
# SWITCHBOARD_BUILD picks the build: "release/<version>" (default) or a branch
# build path.
#
# SWITCHBOARD_LOCAL_BUILD=<switchboard-sdk checkout>/out copies the AARs built
# there (inv sdk.build-android, inv openai.build-android, inv onnx.build-android,
# inv silerovad.build-android) instead, for SDK
# branches that aren't in S3. Packages it doesn't have still come from S3.
#
# Layout produced (matches android/build.gradle):
#   android/libs/<Package>.aar
set -euo pipefail

SWITCHBOARD_BUILD="${SWITCHBOARD_BUILD:-release/3.2.8}"
BASE_URL="s3://switchboard-sdk/builds/${SWITCHBOARD_BUILD}/android"

PACKAGES=(SwitchboardSDK SwitchboardOnnx SwitchboardSileroVAD SwitchboardOpenAI)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBS_DIR="${SCRIPT_DIR}/../android/libs"

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

  if ! command -v aws &> /dev/null; then
    echo "error: the AWS CLI is required to fetch private Switchboard builds (brew install awscli)." >&2
    exit 1
  fi
  echo "↓ Downloading ${pkg} (${SWITCHBOARD_BUILD})"
  # Extract next to the AAR and move it into place, so a failed download keeps the old copy.
  tmp_dir="$(mktemp -d "${LIBS_DIR}/.${pkg}.XXXXXX")"
  trap 'rm -rf "${tmp_dir}"' EXIT
  aws s3 cp --only-show-errors "${BASE_URL}/${pkg}.zip" "${tmp_dir}/${pkg}.zip"

  echo "  Extracting ${pkg}"
  unzip -oq "${tmp_dir}/${pkg}.zip" -d "${tmp_dir}"
  mv "${tmp_dir}/${pkg}.aar" "${dest}"
  rm -rf "${tmp_dir}"
  trap - EXIT
  echo "${SWITCHBOARD_BUILD}" > "${stamp}"
done

echo "✓ Switchboard Android libraries ready in android/libs/"
