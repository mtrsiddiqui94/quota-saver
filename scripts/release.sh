#!/bin/sh
# Prepare a release: set the version, check the changelog has its entry, run
# every check. Commits and tags nothing: review the diff, then do that yourself.
# Usage: scripts/release.sh <version> [path-to-claude]   e.g. scripts/release.sh 0.18.2
set -eu
cd "$(dirname "$0")/.."
VERSION="${1:?usage: scripts/release.sh <version> [path-to-claude]}"
case "$VERSION" in
  *[!0-9.]* | .* | *. | *..*) echo "release: '$VERSION' is not a version like 1.2.3" >&2; exit 1 ;;
esac
if ! grep -q "^## \[$VERSION\] - " CHANGELOG.md; then
  echo "release: CHANGELOG.md has no '## [$VERSION] - <date>' entry; write it first" >&2
  exit 1
fi
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" .claude-plugin/plugin.json
rm -f .claude-plugin/plugin.json.bak
sh scripts/check.sh "${2:-claude}"
echo "release: $VERSION is ready. Next: git commit -am \"... ($VERSION)\" && git tag v$VERSION"
