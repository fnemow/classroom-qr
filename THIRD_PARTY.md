# 依赖与许可

本项目原创源码按 `LICENSE` 中的 MIT 条款提供。第三方组件保留各自许可。

| 组件 | 版本 | 许可与来源 |
| --- | --- | --- |
| Hls.js | 1.7.3 | Apache-2.0；`extension/HLS-LICENSE.txt`；https://github.com/video-dev/hls.js |
| ZXing.Net | 0.16.11 | Apache-2.0；Copyright Michael Jahn / ZXing authors；`licenses/ZXing-Net-LICENSE.txt`；https://github.com/micjahn/ZXing.Net |
| .NET Windows 自包含运行时 | 10.0.13 | MIT 及随附第三方条款；`licenses/dotnet-*`、`licenses/winforms-*`；https://github.com/dotnet/runtime 、https://github.com/dotnet/winforms |
| FFmpeg Windows essentials | 6.1.1 | GPL-3.0；独立进程调用，二进制未经修改；`native/FFmpeg-LICENSE.txt`、`native/FFmpeg-README.txt` |

FFmpeg 原始二进制来自 https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 ，上游构建方为 https://www.gyan.dev/ffmpeg/builds/ 。确切 FFmpeg 源码提交为 https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 ，构建参数和依赖列表随上游 README 一同保留。再次分发该二进制时需遵守对应 GPL 条款，包括提供相应源码及构建所需材料的义务。

提醒音由本项目脚本合成，无外部音频素材。npm 开发工具及其许可记录在 `source/package-lock.json` 对应的软件包中，不随运行版执行。

ICS parsing: ical.js (MPL-2.0), local npm version pinned in source/package-lock.json. Source: https://github.com/kewisch/ical.js . License: licenses/ICAL-JS-LICENSE.txt .
XLSX decompression: fflate (MIT), locally bundled. Source: https://github.com/101arrowz/fflate . License: licenses/FFLATE-LICENSE.txt .
