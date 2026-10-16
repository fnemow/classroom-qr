# 课堂二维码提醒

Windows 上的 Chrome / Edge 扩展及 C# 本地辅助程序，当前版本 **1.2.0**。

## 功能

- 播放 HLS 课堂直播，共享本地分片缓存，并在落后时追赶直播位置。
- 导入 ICS 周课表，点击课程切换教室；支持课程筛选、Excel 教室编号导入和手动配置。课程直播链接为XDU的学在西电，其他需自行导入。
- 切换默认编号、编号 −1、编号 +1 三个直播视角；严重卡顿时提示切换。
- 在本地持续识别、记录二维码，默认仅对超星签到域名和 `/widget/sign/e` 路径响铃、恢复并置顶直播窗口。
- 支持允许/屏蔽规则、日志筛选与 JSON 导出；未知二维码只记录，不触发提醒。

每次监控首次签到码触发一次提醒，后续继续记录，重新监控或切换课次重新布防。二维码不会自动打开或提交。

## 从源码构建

需要 Windows x64、Node.js 22+、.NET 10 SDK。仓库保留 `source/` 布局，构建产物写入根目录 `extension/` 和 `native/`。

```powershell
cd source
npm ci
npm run typecheck
npm run build
node scripts/alarm.mjs
dotnet publish native/ClassroomQr.Host.csproj -c Release -o ../native --self-contained true
```

准备 Windows x64 FFmpeg，将 `ffmpeg.exe` 放入根目录 `native/`。二进制获取及再分发许可见 [第三方说明](THIRD_PARTY.md) 和 `native/FFmpeg-README.txt`。本源码仓库不包含 FFmpeg 或 .NET 自包含可执行程序。

## 安装

1. 构建后打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
2. 加载根目录下生成的 `extension` 文件夹，不能选择 `source/extension`。
3. 复制扩展 ID，双击根目录 `install.cmd` 并输入 ID。安装只修改当前用户的 Chrome / Edge Native Messaging 注册。
4. 点击扩展图标，粘贴直播地址，或导入课表并配置教室。

两个浏览器 ID 不同时，分别运行安装脚本；同一安装目录会保留已有授权。更新时关闭旧直播窗口并重新加载扩展，扩展与辅助程序应同时更新。卸载前停止监控，再运行 `uninstall.cmd` 并移除浏览器扩展。

## 配置与数据

- 课表不会自动定时切课；重启浏览器后由用户点击课程启动。
- 教室映射规范化大小写、空格和连字符；同名多编号标记冲突，需手动配置唯一编号。
- 直播 URL 模板保留 `/7302/00XXXX/` 占位符，按教室编号替换。默认模板和映射属于特定平台，可在界面替换。
- 超星签到规则严格匹配 HTTPS 域名与完整路径，忽略动态查询参数。屏蔽规则优先，未知码不报警；可从日志预填规则，测试后保存。
- 日志保存在浏览器扩展本地存储，按会话、内容和分类聚合；上限 1000 条、约 3 MiB，支持清空。Chrome 和 Edge 的数据各自独立。
- 共享视频缓存位于辅助程序内存，目标约 64 MiB，分片复用有效期 60 秒；停止后释放，不提供录像。

仓库不包含个人课表、原始 Excel 文件、二维码运行日志或本地认证配置。直播画面实际延迟仍取决于上游平台和网络；规则匹配不验证签到链接是否仍有效。

## 验证

构建并准备 FFmpeg 后，在 `source` 下运行：

```powershell
npm test
```

测试覆盖课表重复规则与时区、教室映射、卡顿判定、二维码多码识别、签到过滤、动态更新规则、持续记录、原生通信和清理。测试产物位于仓库根目录 `.qa/`，不进入 Git。浏览器打包检查使用本机 Chrome / Edge，未安装时跳过相应检查。真实课堂的画质、签到时效、置顶与通知需要现场验收。

## 许可

原创代码采用 [MIT License](LICENSE)。第三方依赖分别遵守其许可，见 [THIRD_PARTY.md](THIRD_PARTY.md) 和 `licenses/`。
