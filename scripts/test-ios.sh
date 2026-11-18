#!/usr/bin/env bash
#
# Runs the iOS native unit tests (ios/Tests) on a simulator, with `npm run test:ios`.
# They build only the code under test, so they need neither React Native nor the
# Switchboard frameworks.
#
# IOS_SIMULATOR picks the simulator by name or UDID. Otherwise it's a booted iPhone,
# or the newest available one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${SCRIPT_DIR}/../ios/Tests/OpenAILiveToolkitTests.xcodeproj"

# Lines such as "    iPhone 17 (020F8537-447D-4E2B-8724-6C89E1188CCD) (Shutdown)", oldest OS first.
devices="$(xcrun simctl list devices available)"
if [ -n "${IOS_SIMULATOR:-}" ]; then
  device="$(grep -F -e " ${IOS_SIMULATOR} (" -e "(${IOS_SIMULATOR})" <<<"${devices}" | tail -1 || true)"
else
  iphones="$(grep -E '^ +iPhone' <<<"${devices}" || true)"
  device="$(grep -m1 '(Booted)' <<<"${iphones}" || tail -1 <<<"${iphones}")"
fi
udid="$(grep -oE '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}' <<<"${device}" || true)"
if [ -z "${udid}" ]; then
  echo "No simulator found${IOS_SIMULATOR:+ named ${IOS_SIMULATOR}}. Add an iPhone in Xcode, or set IOS_SIMULATOR." >&2
  exit 1
fi

# Only errors, warnings, failed tests and each suite's result.
xcodebuild test \
  -project "${PROJECT}" \
  -scheme OpenAILiveToolkitTests \
  -destination "id=${udid}" 2>&1 |
  grep -E "error:|warning:|Test Case .* failed|Test Suite '.*' (passed|failed)|Executed [0-9]+ test|\*\* .* \*\*"
