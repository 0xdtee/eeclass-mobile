# eeclass Mobile — iPad & Phone Client for Classroom Captions & Notes

**English** | [中文](README.zh.md)

> **The phone & iPad client of [eeclass](https://github.com/0xdtee/eeclass) — turn a live lecture into clean, structured, searchable notes, in your hand.**

This is the mobile client of the eeclass classroom transcription & AI-notes system. One source (React 19 + Vite + TypeScript + Tailwind) builds **all** targets:

- the **web app** served at `/m` by the eeclass backend,
- the **native iPad app**, packaged via [Capacitor](https://capacitorjs.com/), and
- an **Android APK**, built from the same output by GitHub Actions.

All heavy lifting — speech recognition, speaker separation, voiceprints and the LLM features — runs on the **eeclass backend**; this client captures audio, streams it over WSS, and renders captions, summaries and course views. It never holds an API key.

## Highlights

- 📱 **One codebase, every device** — the same `src/` builds the web `/m` app, the native iPad app and the Android APK. Record on the iPad in class, revise on your phone — same backend, same data.
- 🎙 **Tap-to-record live captions** — streaming, punctuated captions with speaker labels; pickup gain up to 12× through a limiter, so a distant lecturer comes through without distortion; snap the blackboard aligned to the timeline.
- 🧠 **AI notes after class** — one tap generates a per-class summary and key points, optionally combined with your own courseware from the class file library; one-click AI highlighting marks definitions (green) and key points (yellow); formulas render with KaTeX.
- 🤝 **Meeting translator** — pick up to 3 meeting languages; whichever is spoken, the others appear as live subtitles. Stopping writes the meeting minutes, and the history is shared with the desktop eeclass.
- 📤 **Export anything** — transcripts to Word / PDF / text / SRT / VTT subtitles, summaries to Word / PDF (one at a time or in batches), mock exam papers with an answer key.
- 🌏 **Multilingual + live translation** — recognizes Chinese (plus dialects), English, French, German, Italian, Spanish, Russian, Japanese and Korean; add a translated caption line with a source ⇄ target picker.
- 🏠 **Open source (MIT), self-hosted** — points at your own eeclass backend; no third-party account.

## Features

### In class
- **Real-time transcription** — streaming captions over a WebSocket to the backend, with speaker labels and inline translated subtitles (off by default; your choice is remembered).
- **Recording controls** — start / pause / mark a key point / stop; live-adjustable pickup gain (1–12×); open courseware from the file library without leaving the recording.
- **Stays recording** — the session lives above the page router, so you can browse other pages mid-class; the home page shows a banner back to the recording.
- **Dropout detection & recovery** — when the phone suspends the mic (app backgrounded / screen locked) the recording screen says so plainly and reopens the mic when you return; if iOS kills and relaunches the app mid-class, the transcript so far is restored from the server and 「重新接上麦克风」 keeps recording the same class.
- **Continue a class** — 「继续录这节课」 on a class page records onto that same class instead of starting a second one.
- **Record a timetable lesson** — tap 录这节 on the timetable to record that lesson; the recording is filed under the lesson's day, and a lesson already recorded (on any device) opens instead of starting a second one.

### After class
- **AI summary** — per-class summary + key points; pick which class files to combine first (or let the server auto-match them); one-tap homophone corrections ("misheard X → Y") rewrite the transcript and learn the term; export to Word / PDF.
- **Transcript** — edit lines inline, tap a line to seek the audio, mark lines as key point / definition by hand, or run **一键标注** to let the AI fill in what the live rules missed; export to Word, PDF, text, or `.srt` / `.vtt` subtitles timed to the recording.
- **Courses & study** — course detail (grand summary, exam-point pie, mock paper with Word / PDF export, recording set), review flashcards / quiz.
- **Search** — full-text search across every class.
- **Class file library** — upload slides, handouts and syllabi; their text becomes material for summaries.

### Meeting translator (`/meeting`)
- **Multilingual live subtitles** — up to 3 languages; each finished sentence is re-translated by the AI for a steadier result.
- **Minutes** — summary, discussion points, decisions and to-dos (with owners), in any of the meeting languages; copy or export to PDF.
- **History** — every meeting is saved to the account and shared with the desktop meeting page.

### Account & settings
- **Schedule & syllabus** — imported timetable with room, teacher and credits; reference-materials / syllabus view.
- **Voiceprints & tags** — name a speaker once and future recordings recognize the voice; tag and organize classes.
- **Account** — email-code registration, login, per-account data isolation, account deletion, changelog, and settings (AI defaults, class-material mode, light/dark theme, pickup gain).
- **Unified back button** — tap to go back, long-press to return home.

## How it works

```
iPad / Android app / phone browser (/m)  ──WSS / HTTPS──►  eeclass backend
  React 19 + Vite + TS + Tailwind                           (aiohttp, :5901)
  · AudioWorklet 16 kHz capture                              ├─ ASR (sherpa-onnx / Alibaba Cloud)
    gain → limiter → soft clip                               ├─ meeting translator (/ws_meeting, Gummy)
  · streaming captions UI                                    ├─ VAD + voiceprints
  · live session kept across pages (context provider)        ├─ PostgreSQL (accounts / metadata)
  · Word / PDF / subtitle export, generated on the device    └─ DeepSeek (summary / minutes / translation)
  Capacitor  ──►  native iPad app / Android APK
```

- **Client only** — this repo is the front-end. It talks to a running [eeclass backend](https://github.com/0xdtee/eeclass); recognition and AI live there.
- **Backend address** — set in `src/lib/api.ts`. The web `/m` build uses the current page origin (same origin as the backend, no CORS); the native app targets a fixed HTTPS backend URL, changeable in 我的 → 服务器配置.
- **Exports** — Word, PDF, subtitles and zips are generated on the device; the heavy libraries (docx, pdf-lib, jszip) load only when you first export. PDFs embed a CJK font fetched from the backend at `/app/cjk.ttf` (shipped with the desktop eeclass web app) instead of bundling 8 MB into the app. In the native app, exported files open the system share sheet ("Save to Files" etc.).
- **Native packaging** — the native wrapper is a thin Capacitor shell; `webDir` is the Vite output `out/` (see `capacitor.config.ts`).

## Requirements

- Node.js 18+
- A running [eeclass backend](https://github.com/0xdtee/eeclass) to connect to (with the desktop web app deployed, for PDF export)
- For the iPad app: macOS + Xcode

## Run (development)

```bash
npm install
npm run dev        # Vite dev server; talks to the backend set in src/lib/api.ts
```

Checks:

```bash
npm run type-check
npm run lint
```

## Build

```bash
# Web /m app (served by the backend at /m)
BASE_PATH=/ npm run build       # → out/
```

Package the native iPad app from the same output:

```bash
BASE_PATH=/ npm run build
npx cap add ios                 # first time only
npx cap sync ios
npx cap open ios                # then build & install with Xcode (or xcodebuild + devicectl)
```

**Android APK** — built by GitHub Actions (`.github/workflows/android.yml`): run *Build Android APK* from the Actions tab to get a downloadable artifact, or push a `v*` tag to attach the APK to a GitHub Release. Locally: `npx cap add android && npx cap sync android`, then `cd android && ./gradlew assembleDebug`.

## Project layout

```
src/
  pages/        Screens (home, record, summary, session, courses, course-detail, study,
                search, schedule, meeting, syllabus, voiceprints, tags, profile, login, …)
  hooks/        Data + live-caption hooks (useRecords, useLiveCaption, …)
  components/   Shared UI (layout, back button, class file library, MathText, …)
  lib/          api.ts (backend address + fetch/ws), settings, changelog,
                exportWord / exportPdf / vectorPdf / exportSubtitle, download
index.html      Vite entry
```

## Security

- The client holds **no secrets** — no API keys; only the backend URL, which is public.
- The backend enforces auth (token / login), pbkdf2 password hashing, and **strict per-account data isolation**; this client only renders what the account is allowed to see.
- The live-caption socket waits until you are signed in before connecting, so the login and sign-up pages never trip the backend's brute-force lockout.

## License

[MIT](LICENSE) © 2026 dtee
