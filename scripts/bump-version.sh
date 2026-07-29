#!/bin/bash
# EcoPilot 版本 Bump 脚本
# 用法: ./scripts/bump-version.sh 1.2.0 ["release notes"]
set -e

VERSION="${1:?Usage: ./scripts/bump-version.sh <version> [notes]}"
NOTES="${2:-Release $VERSION}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "Bumping version to $VERSION..."

# 更新 electron-app/package.json
node -e "
const fs = require('fs');
['desktop/electron-app/package.json', 'desktop/frontend/package.json'].forEach(p => {
  const path = require('path').join('$ROOT', p);
  const data = JSON.parse(fs.readFileSync(path));
  data.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log('  Updated:', p, '->', data.version);
});
"

# Commit + Tag
cd "$ROOT"
git add desktop/electron-app/package.json desktop/frontend/package.json
git commit -m "chore: bump version to $VERSION

$NOTES"
git tag -a "v$VERSION" -m "$NOTES"

echo ""
echo "✅ Version bumped to v$VERSION"
echo "   Run 'git push origin main --tags' to trigger the release build."
echo ""
echo "   Or push manually:"
echo "   git push origin main"
echo "   git push origin v$VERSION"
