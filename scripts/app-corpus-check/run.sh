#!/bin/sh
# Verifies the shared corpus against the native app's own compiler with a scratch SwiftPM build.
#
#   scripts/app-corpus-check/run.sh <native-home-worktree> [scratch-dir] [corpus-dir] [file ...]
#
# The app worktree is only read: the scratch package depends on its `apple` package by path and builds in
# <scratch-dir> (default: a temporary directory). Output is `appcheck`'s tab separated lines; see main.swift.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
app=$(cd "$1" && pwd)
scratch=${2:-$(mktemp -d)}
corpus=${3:-$here/../../contract/corpus}
[ $# -gt 3 ] && shift 3 || shift $#
mkdir -p "$scratch/Sources/appcheck"
cp "$here/main.swift" "$scratch/Sources/appcheck/main.swift"
cat > "$scratch/Package.swift" <<PKG
// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "appcheck",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "$app/apple")],
    targets: [.executableTarget(name: "appcheck", dependencies: [.product(name: "HassCore", package: "apple")],
                                swiftSettings: [.swiftLanguageMode(.v5)])]
)
PKG
cd "$scratch"
swift build -c debug --product appcheck 1>&2
"$scratch/.build/debug/appcheck" "$(cd "$corpus" && pwd)" "$@"
