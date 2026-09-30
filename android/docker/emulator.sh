#!/usr/bin/env bash
# Starts the headless emulator in the toolchain image (needs /dev/kvm), installs the
# release APK, and leaves the container running as "durham-weather-emu".
# Drive it with: docker exec durham-weather-emu adb ...
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
docker rm -f durham-weather-emu >/dev/null 2>&1 || true
docker run -d --name durham-weather-emu --device /dev/kvm -v "$here:/src:ro" durham-weather-android \
  emulator -avd test -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -feature -Wifi >/dev/null
docker exec durham-weather-emu adb wait-for-device
until [ "$(docker exec durham-weather-emu adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 3; done
docker exec durham-weather-emu adb install -r /src/app/build/outputs/apk/release/app-release.apk
