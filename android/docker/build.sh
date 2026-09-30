#!/usr/bin/env bash
# Builds the signed release APK inside the toolchain image.
# Output: android/app/build/outputs/apk/release/app-release.apk
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
keys="${DURHAM_WEATHER_KEYS:-$HOME/.config/durham-weather}"
cache="${HOME}/.cache/durham-weather-gradle"
mkdir -p "$cache"
docker build -q -t durham-weather-android "$here/docker" >/dev/null
docker run --rm -u "$(id -u):$(id -g)" \
  -e GRADLE_USER_HOME=/gradle -e HOME=/tmp \
  -v "$cache:/gradle" -v "$here:/src" -v "$keys:/keys:ro" \
  durham-weather-android ./gradlew --no-daemon -q assembleRelease "$@"
ls -l "$here/app/build/outputs/apk/release/app-release.apk"
