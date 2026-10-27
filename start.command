#!/bin/bash
# Bridgeboard for Mac: double-click to start. Opens 终端 (Terminal), which
# runs the panel; closing that window stops it.
#
# The zip holds two copies of Node.js: runtime/node-arm64 for Apple chips
# (M1 and later) and runtime/node-x64 for Intel Macs; this picks the one that
# fits. Without them it uses a Node.js installed on the Mac.
# Only shell built-ins plus sysctl, uname and xattr, so test/mac.test.js can
# run it with fake ones.

# Double-clicking starts in the home folder: go to the folder this file is in.
case "$0" in */*) cd "${0%/*}" || exit 1 ;; esac
DIR="$(pwd)"

wait_for_enter() {
  echo
  echo "按回车键关闭这个窗口…"
  read -r _
}

# Moved out on its own (e.g. into Downloads): the panel is not here, so say
# where to run it, and touch nothing in this folder.
if [ ! -f "$DIR/server.js" ]; then
  echo "start.command 要放在解压出来的 Bridgeboard 文件夹里运行（旁边有 server.js 和 runtime 文件夹）。"
  echo "请回到那个文件夹双击 start.command。"
  wait_for_enter
  exit 1
fi

# Apple chip or Intel. sysctl first: a Terminal running under Rosetta says
# x86_64 in uname -m even on an Apple chip.
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
  ARCH=arm64
else
  case "$(uname -m 2>/dev/null)" in
    arm64 | aarch64) ARCH=arm64 ;;
    *) ARCH=x64 ;;
  esac
fi
NODE="$DIR/runtime/node-$ARCH"

# The first time: macOS marks everything from the internet as "downloaded"
# and would stop the built-in Node.js again after start.command was allowed.
# Only this Bridgeboard folder is touched, nothing else on the Mac, and only
# when it really is one (server.js and the runtime folder next to this file).
if [ -f "$DIR/server.js" ] && [ -d "$DIR/runtime" ] && {
  xattr -p com.apple.quarantine "$DIR/start.command" >/dev/null 2>&1 \
    || { [ -f "$NODE" ] && xattr -p com.apple.quarantine "$NODE" >/dev/null 2>&1; }
}; then
  xattr -dr com.apple.quarantine "$DIR" 2>/dev/null
  echo "第一次运行：已去掉这个 Bridgeboard 文件夹里文件的「从网上下载」标记，以后不会再被拦（只处理这个文件夹，不碰电脑上其他地方）。"
fi

if [ -f "$NODE" ]; then
  # Some unzip tools drop the "can run" permission.
  [ -x "$NODE" ] || chmod +x "$NODE" 2>/dev/null
  if ! "$NODE" --version >/dev/null 2>&1; then
    echo "内置的 Node.js 启动不了，可能被系统拦住了。"
    echo "请打开「系统设置 → 隐私与安全性」，拉到下面点「仍要打开」，再双击 start.command。"
    echo "还是不行的话，从 https://nodejs.org 安装 LTS 版本后再试。"
    wait_for_enter
    exit 1
  fi
elif command -v node >/dev/null 2>&1; then
  NODE=node
else
  echo "没有找到 Node.js。"
  echo "请下载 Releases 里的 Bridgeboard-Mac.zip（里面已经带了 Node.js），解压后双击里面的 start.command。"
  echo "也可以从 https://nodejs.org 安装 LTS 版本后再试。"
  wait_for_enter
  exit 1
fi

# Extra options (e.g. --demo from demo.command) go on to the app.
"$NODE" server.js "$@"
code=$?
# Exit code 0: the panel was already running and its page was opened.
if [ "$code" -eq 0 ]; then
  echo "可以关掉这个窗口了。"
  exit 0
fi
wait_for_enter
exit "$code"
