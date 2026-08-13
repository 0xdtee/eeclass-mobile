# eeclass Mobile — 课堂实时字幕与笔记的 iPad / 手机客户端

[English](README.md) | **中文**

> **[eeclass](https://github.com/0xdtee/eeclass) 的手机与 iPad 客户端 —— 把一堂课变成随手可查、结构清晰的笔记。**

这是 eeclass 课堂转写与 AI 笔记系统的移动端。一套源码(React 19 + Vite + TypeScript + Tailwind)同时构建**两个目标**:

- 由 eeclass 后端在 `/m` 提供的 **网页应用**,以及
- 通过 [Capacitor](https://capacitorjs.com/) 打包的 **iPad 原生 App**。

所有重活 —— 语音识别、说话人分离、声纹、大模型能力 —— 都在 **eeclass 后端**上跑;本客户端负责采音、经 WSS 上传、并渲染字幕、摘要与课程视图,**自身不持有任何 API Key**。

## 亮点(Highlights)

- 📱 **一套代码,两种设备** —— 同一份 `src/` 既构建网页 `/m`,又构建 iPad 原生 App(Capacitor)。课上用 iPad 录,课后用手机浏览器复习,同一后端、同一份数据。
- 🎙 **一点即录的实时字幕** —— 开录即见带标点、带说话人标签的流式字幕;板书随手拍,自动对齐时间轴。
- 🧠 **课后 AI 笔记** —— 一键生成本节课摘要与重点;进入课程可看整门课大总结、考点预测、模拟卷与复习闪卡。
- 🌏 **多语言识别 + 实时翻译** —— 识别中文(含方言)、英、法、德、意、西、俄、日、韩;通过原文 ⇄ 译文选择器加一条翻译字幕。
- ✏️ **边看边改** —— 任意一句可行内编辑;点句子把录音跳到该处;一键替换识别听错的词(并记住,之后自动纠)。
- 🏠 **开源(MIT)、自托管** —— 指向你自己的 eeclass 后端,无需第三方账号。

## 功能(Features)

- **实时转写** —— 经 WebSocket 与后端串流字幕;说话人标签、行内翻译字幕、同屏笔记。
- **录音控制** —— 开始 / 暂停 / 停止,随拾音灵敏度调整;停止后可自动跳转摘要并生成。
- **AI 摘要** —— 本节课摘要 + 重点;一键同音纠错(「听成 X 应为 Y」)会改写转写全文并学习该词。
- **转写全文** —— 行内编辑、点句子定位音频、带进度条回放。
- **课程与复习** —— 课程详情(大总结、考点饼图、模拟卷、录音集合)、复习闪卡 / 测验。
- **搜索** —— 跨所有课时的全文检索。
- **课表与参考资料** —— 逐级下钻课表(年 → 月 → 日 → 课程)与参考资料 / 大纲页。
- **声纹与标签** —— 给说话人命名一次,之后同一嗓音自动识别;打标签整理课时。
- **我的** —— 邮箱验证码注册、登录、按账号数据隔离、注销账号、更新日志,以及设置(AI 默认开关、深浅主题、拾音灵敏度)。
- **统一返回键** —— 轻点返回上页,长按回主界面。

## 工作原理(How it works)

```
iPad App / 手机浏览器 (/m)   ──WSS / HTTPS──►  eeclass 后端
  React 19 + Vite + TS + Tailwind               (aiohttp, :5901)
  · AudioWorklet 16 kHz 采音                      ├─ 识别(sherpa-onnx / 阿里云)
  · 流式字幕 UI                                   ├─ VAD + 声纹
  · 跨页保活导航(Context Provider)              ├─ PostgreSQL(账号 / 元数据)
  Capacitor  ──►  iPad 原生 App                   └─ DeepSeek(摘要 / 翻译)
```

- **仅客户端** —— 本仓库是前端,连接一个运行中的 [eeclass 后端](https://github.com/0xdtee/eeclass);识别与 AI 都在后端。
- **后端地址** —— 在 `src/lib/api.ts` 里设置。网页 `/m` 构建用当前页面同源(与后端同源,无 CORS);原生 App 指向固定的 HTTPS 后端地址。
- **iPad 打包** —— 原生壳是一层很薄的 Capacitor(`webDir = www`)。在此构建网页产物,拷进 Capacitor 项目,`cap sync`,再用 Xcode 构建安装。

## 环境要求(Requirements)

- Node.js 18+
- 一个可连接的 [eeclass 后端](https://github.com/0xdtee/eeclass)
- 打包 iPad App 还需:macOS + Xcode + 一个 Capacitor 壳工程

## 开发运行

```bash
npm install
npm run dev        # Vite 开发服务器;连接 src/lib/api.ts 里配置的后端
```

## 构建

```bash
# 网页 /m 应用(由后端在 /m 提供)
BASE_PATH=/ npm run build       # → out/
```

用同一份产物打包 iPad 原生 App:

```bash
BASE_PATH=/ npm run build
cp -r out <你的 Capacitor 工程>/www
cd <你的 Capacitor 工程>
npx cap sync ios
# 再用 Xcode(或 xcodebuild + devicectl)构建安装
```

## 目录结构

```
src/
  pages/        各页面(home、record、summary、session、courses、study、search、
                schedule、syllabus、voiceprints、tags、profile、login、register…)
  hooks/        数据与实时字幕 hook(useRecords、useLiveCaption…)
  components/   共享 UI(布局、返回键、日历…)
  lib/          api.ts(后端地址 + fetch/ws)、i18n、changelog
index.html      Vite 入口
```

## 安全

- 客户端**不含任何密钥** —— 没有 API Key,只有一个公开的后端地址。
- 后端负责鉴权(令牌 / 登录)、pbkdf2 密码哈希与**严格的按账号数据隔离**;本客户端只渲染该账号有权看到的内容。

## 许可

[MIT](LICENSE) © 2026 dtee
