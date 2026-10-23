#!/usr/bin/env bash
# Builds the Windows portable zip: the app plus a copy of node.exe, so users
# only unzip and double-click start.bat. Used by .github/workflows/release.yml.
#
#   scripts/build-portable.sh <version> [node-major]
set -euo pipefail

VERSION="${1:?usage: build-portable.sh <version> [node-major]}"
NODE_MAJOR="${2:-22}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
NAME="Bridgeboard"
STAGE="$OUT/$NAME"

rm -rf "$OUT" && mkdir -p "$STAGE/runtime"

# Latest release of the chosen Node major line, checked against nodejs.org's SHA256 list.
NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).find(r=>r.version.startsWith('v${NODE_MAJOR}.'));if(!v)process.exit(1);console.log(v.version)})")"
NODE_ZIP="node-$NODE_VERSION-win-x64.zip"
curl -fsSL -o "$OUT/$NODE_ZIP" "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP"
curl -fsSL -o "$OUT/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
(cd "$OUT" && grep " $NODE_ZIP\$" SHASUMS256.txt | sha256sum -c -)
unzip -q -j "$OUT/$NODE_ZIP" "node-$NODE_VERSION-win-x64/node.exe" "node-$NODE_VERSION-win-x64/LICENSE" -d "$STAGE/runtime"
mv "$STAGE/runtime/LICENSE" "$STAGE/runtime/LICENSE-node.txt"

# Only what the app needs at run time.
cp -r "$ROOT"/{server.js,package.json,LICENSE,README.md,start.bat,demo.bat,lib,public,vendor,docs} "$STAGE/"
rm -rf "$STAGE/docs/dev"

# Windows wants CRLF in batch files.
sed -i 's/\r\?$/\r/' "$STAGE/start.bat" "$STAGE/demo.bat"

cat > "$STAGE/HOW-TO-USE.txt" <<TXT
Bridgeboard $VERSION（Blackboard 学习面板，Windows 便携版）

1. 双击 start.bat。会出现一个黑色窗口，不要关掉它，浏览器会自动打开面板。
2. 填入学校的 Blackboard 网址，点"连接 Blackboard"，在弹出的窗口里登录。
3. 学校问"保持登录状态？"时选"是"。

想先看看效果：双击 demo.bat（示例数据，不用登录）。
Windows 提示"已保护你的电脑"时，点"更多信息"，再点"仍要运行"。
常见问题：docs/FAQ.md，或 https://github.com/HeathTeng/Bridgeboard

已内置 Node.js $NODE_VERSION（runtime 文件夹），不需要另外安装。
TXT
# CRLF and a UTF-8 BOM so Notepad shows the Chinese correctly. ASCII file
# name, because zip only marks UTF-8 names on some tools and Windows would garble it.
sed -i -e 's/\r\?$/\r/' -e '1s/^/\xEF\xBB\xBF/' "$STAGE/HOW-TO-USE.txt"

(cd "$OUT" && zip -qr "$NAME-$VERSION-windows.zip" "$NAME")
# The same zip under a fixed name: getboundly.com links to
# /releases/latest/download/Bridgeboard-Windows.zip, so keep this name exactly.
cp "$OUT/$NAME-$VERSION-windows.zip" "$OUT/$NAME-Windows.zip"
rm -rf "$STAGE" "$OUT/$NODE_ZIP" "$OUT/SHASUMS256.txt"
echo "Built $OUT/$NAME-$VERSION-windows.zip and $NAME-Windows.zip with Node $NODE_VERSION"
