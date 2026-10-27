# Mac 版（试用，v0.3.4 起）

目标：Mac 同学下载一个 zip，解压，双击 `start.command` 就能用，不用装 Node.js。功能和 Windows 版一样；只读、只在本机、零依赖这些规则不变。我们没有 Mac，下面「请 Mac 同学验证」里的事只能在真 Mac 上确认。

## 怎么做的

- **打包**：`scripts/build-mac.sh`（在 ubuntu 上跑，`release.yml` 里排在 Windows 打包之后，因为 Windows 脚本会先清空 `dist/`）。从 nodejs.org 下载和 Windows 同一大版本的 `darwin-arm64` / `darwin-x64` 包，用 SHASUMS256 核对，取出 `bin/node` 放成 `runtime/node-arm64`、`runtime/node-x64`。zip 里有 `start.command`、`demo.command`（LF、755）、`HOW-TO-USE.txt`（Mac 版，UTF-8 带 BOM）和 app 文件，没有 `.bat`。打完包会解压检查权限、LF、没有 `.bat`，不对就让发布失败。产出 `Bridgeboard-<版本>-mac.zip` 和固定名字的 `Bridgeboard-Mac.zip`（官网以后链到 `/releases/latest/download/Bridgeboard-Mac.zip`，`test/mac.test.js` 守着这个名字）。Windows 的两个 zip 名字和内容没变。
- **启动脚本**：`start.command` cd 到自己的文件夹；`sysctl hw.optional.arm64` 为 1 就用 arm64（Rosetta 下的终端里 `uname -m` 会说 x86_64），否则看 `uname -m`；没有 runtime 就用 PATH 里的 node，都没有就用中文说明。参数原样传给 `server.js`；退出码 0（面板已经在运行，只打开了页面）时说「可以关掉这个窗口了」。`demo.command` 就是 `start.command --demo`。
- **第一次放行**（和主人商定）：`start.command` 被放行后，如果自己或内置 node 还带着 `com.apple.quarantine`，就 `xattr -dr com.apple.quarantine` 这个 Bridgeboard 文件夹（只这一个文件夹），并在终端里用一句中文说明。这样 node 和 `demo.command` 不会再被拦。
- **按系统换说法**：`lib/os-words.js`（以 `/os-words.js` 提供给页面）。`/api/ping` 带 `os`（`windows` / `mac` / `other`）；`theme.js` 在第一次绘制前按上次的结果（或浏览器的 `navigator.platform`）设好 `<html data-os>`，`layout.js` 的 `applyOs` 再按服务器的结果改正并记住。`index.html` 里的说法是成对的 `.os-win` / `.os-mac` span，CSS 只显示一个。新手引导第 2 页有 `macLines`（`useGuideOs`）。FAQ 是同一份文件，写成「黑色窗口（Mac 上是终端窗口）」，Mac 的步骤单独写。keep-open 版本号升到 2。
- **预览 Mac 文案**：`node server.js --demo --os=mac`（只换文字，不改行为）。
- **开机自动启动**：Mac 不做。服务器在 Mac 上回 `autostart: { supported: false, mac: true }`，页面不显示开关，显示 `#autostartMac` 的杏色提醒。
- **选择文件夹**：`lib/pick-folder.js`。Windows 仍是 PowerShell；Mac 用 `osascript` 的 `choose folder`，起始文件夹作为参数传入，不拼进脚本；取消（-128）返回 null，什么都不改。
- **登录窗口**：Mac 上也找 `~/Applications` 里的 Edge / Chrome；都没装时提示安装其中一个；Mac 上加 `--use-mock-keychain`，免得新的浏览器资料夹弹钥匙串密码框（cookie 是经 CDP 读的，用不到钥匙串）。
- **保存位置**：Mac 上可以写 `~/课程资料`；示例是 `/Users/你的名字/课程资料`。文件名里的 `:` 和 `/` 本来就被库的 `safeFileName` 换成 `_`。
- **不做**：防睡眠（`caffeinate`），和 Windows 一致；页面、HOW-TO-USE.txt、FAQ 写明电脑睡眠或合上盖子时不会发提醒。

## 请 Mac 同学验证

请用发布页上的 `Bridgeboard-Mac.zip`，每一项回答「行 / 不行（截图）」，并写上 macOS 版本、苹果芯片还是 Intel。

1. 用 Safari 下载、用 Chrome 下载，各解压一次：`start.command` 还能双击运行吗（权限还在）？
2. 第一次被拦时的样子和我们写的步骤一样吗？macOS 14 及更早：按住 Control 点 → 打开 → 打开。macOS 15 及以后：完成 → 系统设置 → 隐私与安全性 → 仍要打开 → 输入密码。
3. 放行 `start.command` 后，终端里有没有出现「已去掉这个 Bridgeboard 文件夹里文件的「从网上下载」标记」？之后 `runtime/node-*` 有没有再被拦一次？
4. 之后双击 `demo.command` 还会被拦吗？
5. 终端里显示的是哪种 node？在终端里运行 `file runtime/node-arm64 runtime/node-x64` 和 `uname -m`，截图。苹果芯片的 Mac 上，用「使用 Rosetta 打开」的终端再试一次。
6. 把文件夹放在「下载」里、改名成带空格和中文的名字（比如「Bridgeboard 课程」），还能启动吗？
7. 点「连接 Blackboard」能弹出 Edge 或 Chrome 并登录成功吗？有没有弹出钥匙串（输入密码）的框？Edge / Chrome 装在 `~/Applications`（用户自己的「应用程序」）时能找到吗？两个都没装时提示看得懂吗？
8. 登录时会不会自动用个人微软账号、出现 AADSTS50020？（Windows 上靠关掉 Edge 的「个人微软账号自动登录」，Mac 版 Edge 上不确定有没有用。）
9. 关掉终端窗口、等 3 小时以上再打开：后台自动重新登录（无窗口的 Edge）成功吗？Dock 里有没有闪出图标？
10. 「选择文件夹」的窗口出现在最前面吗？点取消后保存位置没变吗？
11. 下载到「文稿」「桌面」「下载」时，Mac 有没有问「终端」能否访问？点「好」后能下载吗？下载完「打开文件夹」能打开吗？
12. 关掉终端窗口后，页面会不会显示「面板已停止运行（可能是终端窗口被关掉了）。请重新双击 start.command。」？面板开着时再双击 `start.command`，是否只打开页面，新窗口写「可以关掉这个窗口了」？
13. 页面上的说法：标题卡下面的红色提醒、手机提醒里的杏色提醒、新手引导第 2 页，写的都是「终端窗口」吗？手机提醒的第 3 步是「Mac 版暂时不能开机自动启动……」，没有开关吗？
14. Bark / ntfy 测试和真实提醒能收到吗？合上盖子一段时间再打开，期间是否没发（这是预期的）？
15. 用「文本编辑」打开 `HOW-TO-USE.txt`，中文正常吗？
16. 第一次启动时，Mac 有没有问「是否允许 node 接受传入网络连接」（防火墙）？面板只监听本机，按理不会问。
17. 意见反馈的邮件里写的是「macOS 版本」吗？

试用通过后：README 下载区加 Mac 按钮；官网仓库在 `div.bb-actions` 里 `#bbDownload` 旁边加 Mac 下载按钮，链到 `/releases/latest/download/Bridgeboard-Mac.zip`。有问题就出 v0.3.5。
