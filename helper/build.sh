#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

OUT="dist/Purpur Helper.app"
rm -rf dist
mkdir -p "$OUT/Contents/MacOS"

swiftc -O -o "$OUT/Contents/MacOS/purpur-helper" main.swift
cp Info.plist "$OUT/Contents/Info.plist"

if codesign --force --deep --sign - "$OUT" >/dev/null 2>&1; then
  echo "helper built and ad-hoc signed: $OUT"
else
  echo "helper built (codesign unavailable, unsigned): $OUT"
fi
