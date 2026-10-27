#!/usr/bin/env bash
# Builds the Mac zip (trial): the app plus two copies of Node.js, one for
# Apple chips and one for Intel, so users only unzip and double-click
# start.command, which picks the right one. Runs on Linux after
# build-portable.sh (which empties dist/ first) in .github/workflows/release.yml.
#
#   scripts/build-mac.sh <version> [node-major]
set -euo pipefail

VERSION="${1:?usage: build-mac.sh <version> [node-major]}"
NODE_MAJOR="${2:-22}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
NAME="Bridgeboard"
STAGE="$OUT/mac/$NAME"
WORK="$OUT/mac-work"

rm -rf "$OUT/mac" "$WORK" && mkdir -p "$STAGE/runtime" "$WORK"
# A failed build leaves no Mac zip behind, so a half-checked one is never published.
trap 'if [ $? -ne 0 ]; then rm -f "$OUT/$NAME-$VERSION-mac.zip" "$OUT/$NAME-Mac.zip"; fi' EXIT

# Latest release of the chosen Node major line, checked against nodejs.org's SHA256 list.
NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).find(r=>r.version.startsWith('v${NODE_MAJOR}.'));if(!v)process.exit(1);console.log(v.version)})")"
curl -fsSL -o "$WORK/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
for ARCH in arm64 x64; do
  TARBALL="node-$NODE_VERSION-darwin-$ARCH.tar.gz"
  curl -fsSL -o "$WORK/$TARBALL" "https://nodejs.org/dist/$NODE_VERSION/$TARBALL"
  (cd "$WORK" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c -)
  tar -xzf "$WORK/$TARBALL" -C "$WORK" "node-$NODE_VERSION-darwin-$ARCH/bin/node" "node-$NODE_VERSION-darwin-$ARCH/LICENSE"
  mv "$WORK/node-$NODE_VERSION-darwin-$ARCH/bin/node" "$STAGE/runtime/node-$ARCH"
  mv "$WORK/node-$NODE_VERSION-darwin-$ARCH/LICENSE" "$STAGE/runtime/LICENSE-node.txt"
done

# Only what the app needs at run time; no .bat files.
cp -r "$ROOT"/{server.js,package.json,LICENSE,README.md,start.command,demo.command,lib,public,vendor,docs} "$STAGE/"
rm -rf "$STAGE/docs/dev"

# Unix line endings and "can run" permission, or double-clicking fails.
sed -i 's/\r$//' "$STAGE/start.command" "$STAGE/demo.command"
chmod 755 "$STAGE/start.command" "$STAGE/demo.command" "$STAGE/runtime/node-arm64" "$STAGE/runtime/node-x64"

cat > "$STAGE/HOW-TO-USE.txt" <<TXT
Bridgeboard $VERSION（Blackboard 学习面板，Mac 试用版）

1. 双击 start.command。会打开「终端」窗口（通常是白色的），不要关掉它，浏览器会自动打开面板。
2. 填入学校的 Blackboard 网址，点"连接 Blackboard"，在弹出的窗口里登录。
3. 学校问"保持登录状态？"时选"是"。

第一次打开时，Mac 可能说"无法验证开发者"或"Apple 无法检查其是否包含恶意软件"。这是因为我们没有向苹果付费签名，按下面做一次就好：
- macOS 14 及更早：按住 Control 点 start.command（或者右键），选"打开"，再点"打开"。
- macOS 15 及以后：先双击一次，看到拦截后点"完成"；打开"系统设置 → 隐私与安全性"，拉到下面点"仍要打开"，输入电脑密码。
放行以后，终端里会说已去掉这个文件夹的"从网上下载"标记，以后双击就能直接打开。

想先看看效果：双击 demo.command（示例数据，不用登录）。
登录要用 Edge 或 Chrome 浏览器，没有的话请先安装其中一个。
电脑睡眠或合上盖子时不会发提醒；Mac 版暂时不能开机自动启动。
卡住了：点面板标题卡片里的「💡 帮助」或「常见问题」；也可以看 docs/FAQ.md 或 https://github.com/HeathTeng/Bridgeboard

已内置 Node.js $NODE_VERSION（runtime 文件夹，苹果芯片和 Intel 各一份），不需要另外安装。需要 macOS 11 或更新的系统。
TXT
# A UTF-8 BOM so TextEdit shows the Chinese correctly.
sed -i '1s/^/\xEF\xBB\xBF/' "$STAGE/HOW-TO-USE.txt"

(cd "$OUT/mac" && zip -qr "$OUT/$NAME-$VERSION-mac.zip" "$NAME")

# Unzip it again and check what a Mac will get: launchers with LF and the
# "can run" permission, both copies of Node.js runnable, no .bat files.
CHECK="$WORK/check"
mkdir -p "$CHECK" && unzip -q "$OUT/$NAME-$VERSION-mac.zip" -d "$CHECK"
for f in start.command demo.command runtime/node-arm64 runtime/node-x64; do
  [ -x "$CHECK/$NAME/$f" ] || { echo "Not executable in the zip: $f" >&2; exit 1; }
done
if grep -q $'\r' "$CHECK/$NAME/start.command" "$CHECK/$NAME/demo.command"; then
  echo "CRLF in a .command file" >&2
  exit 1
fi
if [ -n "$(find "$CHECK/$NAME" -name '*.bat')" ]; then
  echo ".bat file in the Mac zip" >&2
  exit 1
fi

# The same zip under a fixed name: getboundly.com will link to
# /releases/latest/download/Bridgeboard-Mac.zip, so keep this name exactly.
cp "$OUT/$NAME-$VERSION-mac.zip" "$OUT/$NAME-Mac.zip"
rm -rf "$OUT/mac" "$WORK"
echo "Built $OUT/$NAME-$VERSION-mac.zip and $NAME-Mac.zip with Node $NODE_VERSION"
