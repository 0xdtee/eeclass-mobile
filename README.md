# eeclass Mobile — iPad & Phone Client for Classroom Captions & Notes

**English** | [中文](README.zh.md)

> **The phone & iPad client of [eeclass](https://github.com/0xdtee/eeclass) — turn a live lecture into clean, structured, searchable notes, in your hand.**

This is the mobile client of the eeclass classroom transcription & AI-notes system. One source (React 19 + Vite + TypeScript + Tailwind) builds **both** targets:

- the **web app** served at `/m` by the eeclass backend, and
- the **native iPad app**, packaged via [Capacitor](https://capacitorjs.com/).

All heavy lifting — speech recognition, speaker separation, voiceprints and the LLM features — runs on the **eeclass backend**; this client captures audio, streams it over WSS, and renders captions, summaries and course views. It never holds an API key.

## Highlights

- 📱 **One codebase, two devices** — the same `src/` builds the web `/m` app and the native iPad app (Capacitor). Record on the iPad in class, revise on your phone browser — same backend, same data.
- 🎙 **Tap-to-record live captions** — start recording and see streaming, punctuated captions with speaker labels; snap the blackboard aligned to the timeline.
- 🧠 **AI notes after class** — one tap generates a per-class summary and key points; open a course for its grand summary, exam-point prediction, mock paper and flashcards.
- 🌏 **Multilingual + live translation** — recognizes Chinese (plus dialects), English, French, German, Italian, Spanish, Russian, Japanese and Korean; add a translated caption line with a source ⇄ target picker.
- ✏️ **Fix as you review** — edit any transcript line, tap a sentence to seek the recording to it, and one-tap replace ASR mishearings (learned so future sessions auto-correct).
- 🏠 **Open source (MIT), self-hosted** — points at your own eeclass backend; no third-party account.

## Features

- **Real-time transcription** — streaming captions over a WebSocket to the backend; speaker labels, inline translated subtitles, and a running notes pane.
- **Recording controls** — start / pause / stop, mic-sensitivity aware; on stop it can auto-jump to the summary and generate it.
- **AI summary** — per-class summary + key points; one-tap homophone corrections ("misheard X → Y") that rewrite the transcript and learn the term.
- **Transcript full-text** — edit lines inline, tap a line to seek the audio, play back with a scrubber.
- **Courses & study** — course detail (grand summary, exam-point pie, mock paper, recording set), review flashcards / quiz.
- **Search** — full-text search across every class.
- **Schedule & syllabus** — drill-down timetable (year → month → day → course) and a reference-materials / syllabus view.
- **Voiceprints & tags** — name a speaker once and future recordings recognize the voice; tag and organize classes.
- **Account** — email-code registration, login, per-account data isolation, account deletion, changelog, and settings (AI default toggle, light/dark theme, mic sensitivity).
- **Unified back button** — tap to go back, long-press to return home.

## How it works

```
iPad app / phone browser (/m)  ──WSS / HTTPS──►  eeclass backend
  React 19 + Vite + TS + Tailwind                (aiohttp, :5901)
  · AudioWorklet 16 kHz capture                   ├─ ASR (sherpa-onnx / Alibaba Cloud)
  · streaming captions UI                         ├─ VAD + voiceprints
  · offline-friendly nav (context provider)       ├─ PostgreSQL (accounts / metadata)
  Capacitor  ──►  native iPad app                 └─ DeepSeek (summary / translation)
```

- **Client only** — this repo is the front-end. It talks to a running [eeclass backend](https://github.com/0xdtee/eeclass); recognition and AI live there.
- **Backend address** — set in `src/lib/api.ts`. The web `/m` build uses the current page origin (same origin as the backend, no CORS); the native app targets a fixed HTTPS backend URL.
- **iPad packaging** — the native wrapper is a thin Capacitor shell (`webDir = www`). Build the web assets here, copy them into the Capacitor project, `cap sync`, then build & install with Xcode.

## Requirements

- Node.js 18+
- A running [eeclass backend](https://github.com/0xdtee/eeclass) to connect to
- For the iPad app: macOS + Xcode + a Capacitor shell project

## Run (development)

```bash
npm install
npm run dev        # Vite dev server; talks to the backend set in src/lib/api.ts
```

## Build

```bash
# Web /m app (served by the backend at /m)
BASE_PATH=/ npm run build       # → out/
```

Package the native iPad app from the same output:

```bash
BASE_PATH=/ npm run build
cp -r out <your-capacitor-project>/www
cd <your-capacitor-project>
npx cap sync ios
# then build & install with Xcode (or xcodebuild + devicectl)
```

## Project layout

```
src/
  pages/        Screens (home, record, summary, session, courses, study, search,
                schedule, syllabus, voiceprints, tags, profile, login, register, …)
  hooks/        Data + live-caption hooks (useRecords, useLiveCaption, …)
  components/   Shared UI (layout, back button, calendar, …)
  lib/          api.ts (backend address + fetch/ws), i18n, changelog
index.html      Vite entry
```

## Security

- The client holds **no secrets** — no API keys; only the backend URL, which is public.
- The backend enforces auth (token / login), pbkdf2 password hashing, and **strict per-account data isolation**; this client only renders what the account is allowed to see.

## License

[MIT](LICENSE) © 2026 dtee
