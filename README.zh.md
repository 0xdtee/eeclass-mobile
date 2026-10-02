# eeclass Mobile — 课堂实时字幕与笔记的 iPad / 手机客户端

[English](README.md) | **中文**

> **[eeclass](https://github.com/0xdtee/eeclass) 的手机与 iPad 客户端 —— 把一堂课变成随手可查、结构清晰的笔记。**

这是 eeclass 课堂转写与 AI 笔记系统的移动端。一套源码(React 19 + Vite + TypeScript + Tailwind)同时构建**所有目标**:

- 由 eeclass 后端在 `/m` 提供的 **网页应用**,
- 通过 [Capacitor](https://capacitorjs.com/) 打包的 **iPad 原生 App**,以及
- 由 GitHub Actions 用同一份产物构建的 **Android APK**。

所有重活 —— 语音识别、说话人分离、声纹、大模型能力 —— 都在 **eeclass 后端**上跑;本客户端负责采音、经 WSS 上传、并渲染字幕、摘要与课程视图,**自身不持有任何 API Key**。

## 亮点(Highlights)

- 📱 **一套代码,所有设备** —— 同一份 `src/` 构建网页 `/m`、iPad 原生 App 和 Android APK。课上用 iPad 录,课后用手机复习,同一后端、同一份数据。
- 🎙 **一点即录的实时字幕** —— 带标点、带说话人标签的流式字幕;收音增益最高 12×,经限幅器处理,老师离得远也能听清且不失真;板书随手拍,自动对齐时间轴。
- 🧠 **课后 AI 笔记** —— 一键生成本节课摘要与重点,可结合课堂文件库里你自己的课件;「一键标注」让 AI 补标定义(绿)和重点(黄);公式用 KaTeX 渲染。
- 🤝 **会议翻译** —— 勾选最多 3 种参会语言,说其中任意一种,其余语言实时出字幕;结束后自动生成会议纪要,历史记录与电脑端 eeclass 同步。
- 📤 **想导就导** —— 转写可导出 Word / PDF / 纯文本 / SRT / VTT 字幕;摘要可单份或批量导出 Word / PDF;模拟试卷导出时题目在前、参考答案在后。
- 🌏 **多语言识别 + 实时翻译** —— 识别中文(含方言)、英、法、德、意、西、俄、日、韩;通过原文 ⇄ 译文选择器加一条翻译字幕。
- 🏠 **开源(MIT)、自托管** —— 指向你自己的 eeclass 后端,无需第三方账号。

## 功能(Features)

### 上课
- **实时转写** —— 经 WebSocket 与后端串流字幕;说话人标签、行内翻译字幕(默认关闭,会记住你的选择)。
- **录音控制** —— 开始 / 暂停 / 标记重点 / 结束;收音增益 1–12× 可实时调节;录音中可直接打开课堂文件库里的课件。
- **不怕切页** —— 录音会话挂在路由之上,课上可以去看别的页面;首页会显示「回到录音页」横幅。
- **中断提示与恢复** —— 手机切到后台或锁屏导致麦克风被系统挂起时,录音页会明确提示,回到页面后自动重新接上麦克风;若 iOS 在课中杀掉并重启 App,会从服务器取回已录内容,点「重新接上麦克风」继续录同一节课。
- **续录** —— 在课时页点「继续录这节课」,接着录到同一节课里,不会拆成两节。
- **按课表录音** —— 在课表上点「录这节」即开始录这节课,录音归到该节课的日期;已经录过的(不论在哪台设备)直接打开,不会重复开录。

### 课后
- **AI 摘要** —— 本节课摘要 + 重点;生成前可勾选要结合的课堂资料(或让服务器自动匹配);一键同音纠错(「听成 X 应为 Y」)会改写转写全文并学习该词;可导出 Word / PDF。
- **转写全文** —— 行内编辑、点句子定位音频、逐句手动标注重点 / 定义,或点「一键标注」让 AI 补标;可导出 Word、PDF、纯文本,以及按录音时间轴对齐的 `.srt` / `.vtt` 字幕。
- **课程与复习** —— 课程详情(大总结、考点饼图、可导出 Word / PDF 的模拟卷、录音集合)、复习闪卡 / 测验。
- **搜索** —— 跨所有课时的全文检索。
- **课堂文件库** —— 上传课件、讲义、大纲,其中的文字会作为整理摘要时的资料。

### 会议翻译(`/meeting`)
- **多语言实时字幕** —— 最多 3 种语言;每句说完后由 AI 再译一次,译文更准更稳定。
- **会议纪要** —— 概述、讨论要点、决定事项、待办(含负责人),可切换任一参会语言查看;可复制或导出 PDF。
- **历史记录** —— 每场会议保存在账号下,与电脑端会议翻译共享。

### 账号与设置
- **课表与参考资料** —— 已导入的课表(含教室、老师、学分)与参考资料 / 大纲页。
- **声纹与标签** —— 给说话人命名一次,之后同一嗓音自动识别;打标签整理课时。
- **我的** —— 邮箱验证码注册、登录、按账号数据隔离、注销账号、更新日志,以及设置(AI 默认开关、课堂资料结合方式、深浅主题、收音增益)。
- **统一返回键** —— 轻点返回上页,长按回主界面。

## 工作原理(How it works)

```
iPad / Android App / 手机浏览器 (/m)  ──WSS / HTTPS──►  eeclass 后端
  React 19 + Vite + TS + Tailwind                       (aiohttp, :5901)
  · AudioWorklet 16 kHz 采音                             ├─ 识别(sherpa-onnx / 阿里云)
    增益 → 限幅 → 软削波                                  ├─ 会议翻译(/ws_meeting,Gummy)
  · 流式字幕 UI                                          ├─ VAD + 声纹
  · 录音会话跨页保活(Context Provider)                  ├─ PostgreSQL(账号 / 元数据)
  · Word / PDF / 字幕在本机生成                           └─ DeepSeek(摘要 / 纪要 / 翻译)
  Capacitor  ──►  iPad 原生 App / Android APK
```

- **仅客户端** —— 本仓库是前端,连接一个运行中的 [eeclass 后端](https://github.com/0xdtee/eeclass);识别与 AI 都在后端。
- **后端地址** —— 在 `src/lib/api.ts` 里设置。网页 `/m` 构建用当前页面同源(与后端同源,无 CORS);原生 App 指向固定的 HTTPS 后端地址,可在「我的 → 服务器配置」修改。
- **导出** —— Word、PDF、字幕和压缩包都在设备上生成;较重的库(docx、pdf-lib、jszip)只在第一次导出时加载。PDF 需要的中文字体从后端的 `/app/cjk.ttf`(随电脑端 eeclass 网页一起部署)获取,而不是把 8 MB 打进 App。原生 App 里导出的文件会弹出系统分享面板(可「存储到文件」等)。
- **原生打包** —— 原生壳是一层很薄的 Capacitor,`webDir` 就是 Vite 的产物目录 `out/`(见 `capacitor.config.ts`)。

## 环境要求(Requirements)

- Node.js 18+
- 一个可连接的 [eeclass 后端](https://github.com/0xdtee/eeclass)(导出 PDF 需要同时部署了电脑端网页)
- 打包 iPad App 还需:macOS + Xcode

## 开发运行

```bash
npm install
npm run dev        # Vite 开发服务器;连接 src/lib/api.ts 里配置的后端
```

检查:

```bash
npm run type-check
npm run lint
```

## 构建

```bash
# 网页 /m 应用(由后端在 /m 提供)
BASE_PATH=/ npm run build       # → out/
```

用同一份产物打包 iPad 原生 App:

```bash
BASE_PATH=/ npm run build
npx cap add ios                 # 仅首次
npx cap sync ios
npx cap open ios                # 再用 Xcode(或 xcodebuild + devicectl)构建安装
```

**Android APK** —— 由 GitHub Actions(`.github/workflows/android.yml`)构建:在 Actions 页手动运行 *Build Android APK* 得到可下载的产物,或推送 `v*` 标签把 APK 附到 GitHub Release。本地构建:`npx cap add android && npx cap sync android`,再 `cd android && ./gradlew assembleDebug`。

## 目录结构

```
src/
  pages/        各页面(home、record、summary、session、courses、course-detail、study、
                search、schedule、meeting、syllabus、voiceprints、tags、profile、login…)
  hooks/        数据与实时字幕 hook(useRecords、useLiveCaption…)
  components/   共享 UI(布局、返回键、课堂文件库、MathText…)
  lib/          api.ts(后端地址 + fetch/ws)、settings、changelog、
                exportWord / exportPdf / vectorPdf / exportSubtitle、download
index.html      Vite 入口
```

## 安全

- 客户端**不含任何密钥** —— 没有 API Key,只有一个公开的后端地址。
- 后端负责鉴权(令牌 / 登录)、pbkdf2 密码哈希与**严格的按账号数据隔离**;本客户端只渲染该账号有权看到的内容。
- 实时字幕的连接会等到登录后才建立,登录 / 注册页不会触发后端的防暴力破解锁定。

## 许可

[MIT](LICENSE) © 2026 dtee
