/**
 * Meeting translator (phone / tablet): live multilingual captions for in-person meetings.
 *
 * Pick up to 3 meeting languages; whichever one is spoken, the others appear as captions in real time
 * (cloud Gummy model on the backend's /ws_meeting, re-translated by the AI once each sentence settles).
 * Stopping generates meeting minutes (summary / points / decisions / to-dos), and every meeting is kept in
 * the account's history — shared with the desktop eeclass meeting page.
 *
 * Isolated from class recording: it has its own socket and mic pipeline, so it refuses to start while a
 * class is being recorded (both would fight over the microphone).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import BackButton from '@/components/feature/BackButton';
import { getServerUrl, getToken, apiFetch } from '@/lib/api';
import { useLiveCaption, captureWorkletUrl, MAX_GAIN, softClip } from '@/hooks/useLiveCaption';
import type { PdfDoc } from '@/lib/exportPdf';
import {
  type MeetingSession, type MeetingMinutes, loadLocal, upsertLocal, removeLocal, syncOnLoad, saveServer, deleteServer,
} from './history';

interface Turn {
  id: number;
  original: string;
  src: string;                          // detected source language code
  translations: Record<string, string>; // lang code -> translated text (filled in as they arrive)
}

// The languages the backend's Gummy model recognizes
const LANGS: { code: string; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'ru', label: '俄语' },
];
const SHORT: Record<string, string> = { zh: '中', en: '英', ja: '日', ko: '韩', fr: '法', de: '德', es: '西', it: '意', ru: '俄', xx: '外' };
const chip = (code: string) => SHORT[code] || code.toUpperCase();
const langLabel = (code: string) => LANGS.find((l) => l.code === code)?.label || code;

const LANGS_KEY = 'meeting_langs';
const GAIN_KEY = 'meeting_gain';
const FONT_KEY = 'meeting_fontscale';
const MAX_LANGS = 3;   // each selected language runs its own realtime stream server-side
const TARGET_SR = 16000;

const readNum = (k: string, d: number) => { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } };

export default function MeetingPage() {
  const live = useLiveCaption();
  const classRecording = live.running || live.starting;

  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [partial, setPartial] = useState<Turn | null>(null);
  const [error, setError] = useState('');
  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [minutesLoading, setMinutesLoading] = useState(false);
  const [minutesLang, setMinutesLang] = useState('');
  const [showMinutes, setShowMinutes] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<MeetingSession[]>(() => loadLocal());
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [gain, setGain] = useState<number>(() => Math.min(MAX_GAIN, readNum(GAIN_KEY, MAX_GAIN)));
  const [fontScale, setFontScale] = useState<number>(() => Math.max(60, Math.min(250, readNum(FONT_KEY, 100))));
  const [langs, setLangs] = useState<string[]>(() => {
    try {
      const a = JSON.parse(localStorage.getItem(LANGS_KEY) || 'null');
      if (Array.isArray(a) && a.length) return a;
    } catch { /* ignore */ }
    return ['zh', 'en'];
  });

  const wsRef = useRef<WebSocket | null>(null);
  const aliveRef = useRef(true);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioNode } | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelBarRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const sessionIdRef = useRef<string | null>(null);   // the meeting being recorded / viewed
  const createdRef = useRef(0);
  const startingRef = useRef(false);                  // guard against double-start before state updates

  useEffect(() => { turnsRef.current = turns; }, [turns]);
  useEffect(() => { try { localStorage.setItem(LANGS_KEY, JSON.stringify(langs)); } catch { /* ignore */ } }, [langs]);
  useEffect(() => { try { localStorage.setItem(FONT_KEY, String(fontScale)); } catch { /* ignore */ } }, [fontScale]);
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = gain;
    try { localStorage.setItem(GAIN_KEY, String(gain)); } catch { /* ignore */ }
  }, [gain]);

  /* ---------- WebSocket ---------- */
  const connect = useCallback(() => {
    if (!aliveRef.current) return;
    const token = getToken();
    if (!token) { setTimeout(connect, 2000); return; }
    let ws: WebSocket;
    try {
      ws = new WebSocket(getServerUrl().replace(/^http/, 'ws') + '/ws_meeting?token=' + encodeURIComponent(token));
    } catch {
      setTimeout(connect, 3000);
      return;
    }
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { setConnected(true); setError(''); };
    ws.onclose = () => {
      setConnected(false);
      setRunning(false);
      setStarting(false);
      startingRef.current = false;
      if (aliveRef.current) setTimeout(connect, 3000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: Record<string, unknown> & { type?: string };
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'started': startingRef.current = false; setRunning(true); setStarting(false); break;
        case 'stopped': startingRef.current = false; setRunning(false); setPartial(null); break;
        case 'partial':
          setPartial({
            id: -1,
            original: (m.original as string) || '',
            src: (m.src as string) || '',
            translations: (m.translations as Record<string, string>) || {},
          });
          break;
        case 'line':
          setPartial(null);
          setTurns((prev) => [...prev, {
            id: (m.id as number) ?? Date.now(),
            original: (m.original as string) || '',
            src: (m.src as string) || '',
            translations: (m.translations as Record<string, string>) || {},
          }]);
          break;
        case 'line_update': {
          // a translation into one language arrived for a line already on screen
          const uid = m.id as number;
          const lang = (m.lang as string) || '';
          const text = (m.translation as string) || '';
          setTurns((prev) => prev.map((l) => (l.id === uid ? { ...l, translations: { ...l.translations, [lang]: text } } : l)));
          break;
        }
        case 'line_correct': {
          // the AI re-translated the finished sentence: swap in the steadier, aligned version
          const cid = m.id as number;
          const ctr = (m.translations as Record<string, string>) || {};
          const csrc = (m.src as string) || '';
          setTurns((prev) => prev.map((l) => (l.id === cid ? {
            ...l,
            src: csrc || l.src,
            original: csrc && ctr[csrc] ? ctr[csrc] : l.original,
            translations: { ...l.translations, ...ctr },
          } : l)));
          break;
        }
        case 'error': setError((m.msg as string) || ''); setStarting(false); startingRef.current = false; break;
      }
    };
  }, []);

  /* ---------- Microphone -> gain -> limiter -> 16k Int16 -> WS ---------- */
  const stopMeter = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (levelBarRef.current) levelBarRef.current.style.width = '0%';
  }, []);

  const stopMic = useCallback(() => {
    stopMeter();
    const m = micRef.current;
    if (!m) return;
    try { m.node.disconnect(); } catch { /* ignore */ }
    try { m.stream.getTracks().forEach((tk) => tk.stop()); } catch { /* ignore */ }
    try { void m.ctx.close(); } catch { /* ignore */ }
    micRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
  }, [stopMeter]);

  useEffect(() => {
    aliveRef.current = true;
    connect();
    void syncOnLoad().then(setHistory).catch(() => setHistory(loadLocal()));
    const onFs = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      aliveRef.current = false;
      document.removeEventListener('fullscreenchange', onFs);
      stopMic();
      try { wsRef.current?.close(); } catch { /* ignore */ }
    };
  }, [connect, stopMic]);

  // Keep the newest caption in view
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, partial, fontScale]);

  const runMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const pct = Math.min(100, Math.round((Math.sqrt(sum / buf.length) / 0.3) * 100));
      if (levelBarRef.current) levelBarRef.current.style.width = pct + '%';
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const startMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用麦克风。请通过 https 打开页面。');
    stopMic();   // two live pipelines would double the audio the recognizer hears
    // Far-field pickup: browser DSP off (it swallows distant, quiet speech); we boost with our own gain.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: TARGET_SR });
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* ignore */ } }
    const src = ctx.createMediaStreamSource(stream);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7600;
    const gainNode = ctx.createGain();
    gainNode.gain.value = gain;
    gainNodeRef.current = gainNode;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -24;
    limiter.knee.value = 24;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    const makeup = ctx.createGain();
    makeup.gain.value = 2;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    src.connect(lp); lp.connect(gainNode); gainNode.connect(limiter); limiter.connect(makeup); makeup.connect(analyser);

    const send = (buf: ArrayBuffer) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
    };
    let node: AudioNode;
    try {
      await ctx.audioWorklet.addModule(captureWorkletUrl());
      const wnode = new AudioWorkletNode(ctx, 'ds-capture', { processorOptions: { targetSr: TARGET_SR } });
      wnode.port.onmessage = (e) => send(e.data as ArrayBuffer);
      node = wnode;
    } catch {
      const sp = ctx.createScriptProcessor(2048, 1, 1);
      const ratio = ctx.sampleRate / TARGET_SR;
      sp.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const outLen = Math.floor(input.length / ratio);
        const pcm = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const pos = i * ratio;
          const i0 = Math.floor(pos);
          const frac = pos - i0;
          pcm[i] = softClip(input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac) * 32767;
        }
        send(pcm.buffer);
      };
      node = sp;
    }
    makeup.connect(node);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    micRef.current = { ctx, stream, node };
    runMeter();
  }, [gain, runMeter, stopMic]);

  /* ---------- History ---------- */
  const persistSession = useCallback((data: Turn[], mins: MeetingMinutes | null) => {
    if (!data.length || !sessionIdRef.current) return;
    const created = createdRef.current || Date.now();
    const title = mins?.title || data.find((d) => d.original)?.original.slice(0, 30) || `会议 ${new Date(created).toLocaleString()}`;
    const session: MeetingSession = { id: sessionIdRef.current, created, title, turns: data, minutes: mins };
    const localMerged = upsertLocal(session);
    setHistory(localMerged);
    saveServer([session]).then(setHistory).catch(() => undefined);
  }, []);

  /* ---------- Minutes ---------- */
  const fetchMinutes = useCallback((data: Turn[], lang: string) =>
    apiFetch<MeetingMinutes>('/api/meeting/minutes', { method: 'POST', body: JSON.stringify({ turns: data, lang }) }), []);

  const generateMinutes = useCallback(async (langArg?: string) => {
    const data = turnsRef.current;
    if (!data.length) return;
    const lang = langArg || minutesLang || (langs.includes('zh') ? 'zh' : langs[0]) || 'zh';
    setMinutesLang(lang);
    setShowMinutes(true);
    setMinutesLoading(true);
    setMinutes(null);
    setError('');
    let result: MeetingMinutes | null = null;
    try {
      result = await fetchMinutes(data, lang);
      setMinutes(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setShowMinutes(false);
    } finally {
      setMinutesLoading(false);
      persistSession(data, result);
    }
  }, [minutesLang, langs, fetchMinutes, persistSession]);

  const exportMinutesPdf = useCallback(async () => {
    if (!minutes) return;
    setExporting(true);
    try {
      const doc: PdfDoc = {
        title: `${minutes.title || '会议纪要'}（${chip(minutesLang || 'zh')}）`,
        subtitle: new Date(createdRef.current || Date.now()).toLocaleString(),
        summary: minutes.summary || undefined,
        keyPoints: [
          ...(minutes.points || []),
          ...(minutes.decisions || []).map((d) => `【决定事项】${d}`),
          ...(minutes.todos || []).map((td) => `【待办事项】${td.task}${td.owner ? `（${td.owner}）` : ''}`),
        ],
      };
      await (await import('@/lib/exportPdf')).exportPdf(doc);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, [minutes, minutesLang]);

  const copyMinutes = useCallback(() => {
    if (!minutes) return;
    const L: string[] = [];
    if (minutes.title) L.push(minutes.title, '');
    if (minutes.summary) L.push(minutes.summary, '');
    if (minutes.points?.length) { L.push('讨论要点'); minutes.points.forEach((p) => L.push('· ' + p)); L.push(''); }
    if (minutes.decisions?.length) { L.push('决定事项'); minutes.decisions.forEach((d) => L.push('· ' + d)); L.push(''); }
    if (minutes.todos?.length) { L.push('待办事项'); minutes.todos.forEach((td) => L.push('· ' + td.task + (td.owner ? `（${td.owner}）` : ''))); }
    void navigator.clipboard?.writeText(L.join('\n').trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [minutes]);

  /* ---------- Start / stop ---------- */
  // continueSession: append to the meeting on screen (same history entry) instead of starting a new one
  const start = useCallback(async (continueSession = false) => {
    if (startingRef.current || running) return;
    if (classRecording) { setError('课堂录音进行中,请先结束录音再开始会议翻译'); return; }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { setError('连接尚未就绪,请稍候重试'); return; }
    startingRef.current = true;
    setError('');
    setStarting(true);
    setPartial(null);
    if (!(continueSession && sessionIdRef.current)) {
      setTurns([]);
      setMinutes(null);
      sessionIdRef.current = 'm' + Date.now();
      createdRef.current = Date.now();
    }
    try {
      await startMic();
    } catch (e) {
      startingRef.current = false;
      setStarting(false);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      ws.send(JSON.stringify({ cmd: 'start', langs }));
    } catch {
      startingRef.current = false;
      setStarting(false);
      stopMic();
      setError('连接已断开,请重试');
    }
  }, [running, classRecording, startMic, stopMic, langs]);

  const stop = useCallback(() => {
    try { wsRef.current?.send(JSON.stringify({ cmd: 'stop' })); } catch { /* ignore */ }
    stopMic();
    setRunning(false);
    if (!sessionIdRef.current) { sessionIdRef.current = 'm' + Date.now(); createdRef.current = Date.now(); }
    // let the last finished sentence arrive, then write the minutes and save
    window.setTimeout(() => { void generateMinutes(); }, 900);
  }, [stopMic, generateMinutes]);

  const clear = () => { setTurns([]); setPartial(null); setMinutes(null); sessionIdRef.current = null; };

  const openSession = (s: MeetingSession) => {
    setTurns((s.turns || []).map((tn) => ({
      id: tn.id,
      original: tn.original,
      src: tn.src || '',
      translations: tn.translations || (tn.tgt && tn.translation ? { [tn.tgt]: tn.translation } : {}),
    })));
    setPartial(null);
    setMinutes(s.minutes || null);
    sessionIdRef.current = s.id;
    createdRef.current = s.created;
    setShowHistory(false);
  };

  const deleteSession = (s: MeetingSession) => {
    if (!window.confirm(`删除「${s.title || '未命名会议'}」?`)) return;
    removeLocal(s.id);
    deleteServer(s.id).catch(() => undefined);
    setHistory((prev) => prev.filter((x) => x.id !== s.id));
    if (sessionIdRef.current === s.id) sessionIdRef.current = null;
  };

  const toggleLang = (code: string) => setLangs((prev) => {
    if (prev.includes(code)) return prev.length > 1 ? prev.filter((c) => c !== code) : prev;   // keep ≥1
    return prev.length >= MAX_LANGS ? prev : [...prev, code];
  });

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  };
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  // One caption block: the spoken original, then a line per other meeting language
  const Caption = ({ turn, partialLine }: { turn: Turn; partialLine?: boolean }) => (
    <div className={`py-3 border-b border-background-200/70 ${partialLine ? 'opacity-90' : ''}`}>
      <div className="flex items-center gap-2 mb-1">
        {turn.src && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-background-200 text-foreground-500">{chip(turn.src)}</span>}
        {partialLine && <span className="text-[11px] text-accent-500 flex items-center gap-1"><i className="ri-loader-4-line animate-spin"></i>实时</span>}
      </div>
      <p className="leading-snug text-foreground-500">{turn.original}</p>
      {langs.filter((code) => turn.translations?.[code]).map((code) => (
        <p key={code} className="leading-snug font-semibold text-foreground-900 mt-1 flex items-baseline gap-2">
          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-accent-100 text-accent-600 self-center flex-shrink-0">{chip(code)}</span>
          <span>{turn.translations[code]}</span>
        </p>
      ))}
    </div>
  );

  return (
    <div ref={rootRef} className="page-fill flex flex-col bg-background-100">
      {/* Header */}
      <div className="flex-shrink-0 bg-background-50 border-b border-background-200 px-4 md:px-6 pt-3 pb-2">
        {!isFull && <BackButton />}
        <div className="flex items-center gap-2">
          <h1 className="text-base md:text-lg font-bold text-foreground-900 flex items-center gap-1.5">
            <i className="ri-translate-2 text-accent-600"></i>会议翻译
          </h1>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-foreground-300'}`} title={connected ? '已连接' : '连接中'}></span>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setShowHistory(true)} className="h-8 px-2.5 rounded-lg bg-background-100 text-foreground-500 text-xs flex items-center gap-1" aria-label="历史记录">
              <i className="ri-history-line"></i>{history.length > 0 && <span className="tabular-nums">{history.length}</span>}
            </button>
            {(minutes || minutesLoading) && !running && (
              <button onClick={() => setShowMinutes(true)} className="h-8 px-2.5 rounded-lg bg-accent-100 text-accent-600 text-xs font-medium flex items-center gap-1">
                <i className={minutesLoading ? 'ri-loader-4-line animate-spin' : 'ri-file-list-3-line'}></i>纪要
              </button>
            )}
            <button onClick={() => setShowSettings((v) => !v)} className={`h-8 w-8 rounded-lg flex items-center justify-center ${showSettings ? 'bg-accent-100 text-accent-600' : 'bg-background-100 text-foreground-500'}`} aria-label="设置">
              <i className="ri-equalizer-line"></i>
            </button>
            {canFullscreen && (
              <button onClick={toggleFull} className="h-8 w-8 rounded-lg bg-background-100 text-foreground-500 flex items-center justify-center" aria-label="全屏投影">
                <i className={isFull ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'}></i>
              </button>
            )}
          </div>
        </div>

        {/* Meeting languages (fixed while running) */}
        <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {LANGS.map((l) => {
            const on = langs.includes(l.code);
            const full = !on && langs.length >= MAX_LANGS;
            return (
              <button
                key={l.code}
                onClick={() => toggleLang(l.code)}
                disabled={running || starting || full}
                className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap flex-shrink-0 border ${on ? 'bg-accent-500 text-background-50 border-accent-500 font-medium' : 'bg-background-50 text-foreground-600 border-background-200'} disabled:opacity-40`}
              >
                {l.label}
              </button>
            );
          })}
        </div>

        {showSettings && (
          <div className="mt-2 space-y-2 text-xs text-foreground-500">
            <label className="flex items-center gap-2">
              <span className="w-14 flex-shrink-0">收音增益</span>
              <input type="range" min={1} max={MAX_GAIN} step={0.5} value={gain} onChange={(e) => setGain(Number(e.target.value))} className="flex-1 accent-accent-500" />
              <span className="w-10 text-right font-mono">{gain.toFixed(1)}×</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="w-14 flex-shrink-0">音量</span>
              <div className="flex-1 h-2 rounded-full bg-background-200 overflow-hidden">
                <div ref={levelBarRef} className="h-full bg-green-500 transition-[width] duration-75" style={{ width: '0%' }}></div>
              </div>
              <span className="w-10"></span>
            </div>
            <label className="flex items-center gap-2">
              <span className="w-14 flex-shrink-0">字号</span>
              <input type="range" min={60} max={250} step={10} value={fontScale} onChange={(e) => setFontScale(Number(e.target.value))} className="flex-1 accent-accent-500" />
              <span className="w-10 text-right font-mono">{fontScale}%</span>
            </label>
          </div>
        )}
      </div>

      {(error || classRecording) && (
        <div className="flex-shrink-0 text-xs text-red-600 bg-red-50 border-b border-red-200 px-4 py-2">
          {error || '课堂录音进行中 —— 结束录音后才能开始会议翻译'}
        </div>
      )}

      {/* Captions */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-2">
        {turns.length === 0 && !partial ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-foreground-300 px-6">
            <i className="ri-mic-line text-5xl mb-3"></i>
            <p className="text-base text-foreground-400">勾选参会语言,点下方「开始」后说话</p>
            <p className="text-xs mt-2 leading-relaxed">说其中任意一种语言,其余勾选的语言会实时作为字幕出现(最多 3 种)。结束后自动生成会议纪要。</p>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl" style={{ fontSize: `calc(1.15rem * ${fontScale / 100})` }}>
            {turns.map((turn) => <Caption key={turn.id} turn={turn} />)}
            {partial && <Caption turn={partial} partialLine />}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-background-50 border-t border-background-200">
        {running ? (
          <button onClick={stop} className="flex-1 h-11 rounded-xl bg-red-500 text-white font-semibold text-sm flex items-center justify-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm bg-white"></span>结束并生成纪要
          </button>
        ) : starting ? (
          <button disabled className="flex-1 h-11 rounded-xl bg-accent-500 text-background-50 font-semibold text-sm flex items-center justify-center gap-2 opacity-60">
            <i className="ri-loader-4-line animate-spin"></i>正在启动…
          </button>
        ) : turns.length > 0 ? (
          <>
            <button onClick={() => void start(true)} disabled={!connected || classRecording} className="flex-1 h-11 rounded-xl bg-accent-500 text-background-50 font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50">
              <i className="ri-mic-line"></i>继续录音
            </button>
            <button onClick={clear} className="flex-1 h-11 rounded-xl bg-background-100 text-foreground-700 font-medium text-sm flex items-center justify-center gap-1.5">
              <i className="ri-add-line"></i>新会议
            </button>
          </>
        ) : (
          <button onClick={() => void start(false)} disabled={!connected || classRecording} className="flex-1 h-11 rounded-xl bg-accent-500 text-background-50 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50">
            <i className="ri-mic-line"></i>开始
          </button>
        )}
      </div>

      {/* Minutes */}
      {showMinutes && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-end md:items-center justify-center" onClick={() => setShowMinutes(false)}>
          <div className="bg-background-50 w-full md:max-w-2xl rounded-t-2xl md:rounded-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-background-200">
              <i className="ri-file-list-3-line text-accent-500"></i>
              <h3 className="text-sm font-semibold text-foreground-900">会议纪要</h3>
              <div className="ml-auto flex items-center gap-1.5">
                {minutes && (
                  <>
                    <button onClick={copyMinutes} className="h-8 px-2.5 rounded-lg bg-background-100 text-foreground-600 text-xs flex items-center gap-1">
                      <i className={copied ? 'ri-check-line text-green-600' : 'ri-file-copy-line'}></i>{copied ? '已复制' : '复制'}
                    </button>
                    <button onClick={() => void exportMinutesPdf()} disabled={exporting} className="h-8 px-2.5 rounded-lg bg-background-100 text-foreground-600 text-xs flex items-center gap-1 disabled:opacity-50">
                      <i className={exporting ? 'ri-loader-4-line animate-spin' : 'ri-file-pdf-2-line'}></i>PDF
                    </button>
                    <button onClick={() => void generateMinutes()} disabled={minutesLoading} className="h-8 w-8 rounded-lg bg-background-100 text-foreground-600 flex items-center justify-center disabled:opacity-50" aria-label="重新生成">
                      <i className="ri-refresh-line"></i>
                    </button>
                  </>
                )}
                <button onClick={() => setShowMinutes(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400">
                  <i className="ri-close-line text-lg"></i>
                </button>
              </div>
            </div>
            {/* view the minutes in any meeting language */}
            <div className="flex items-center gap-1.5 px-5 py-2 border-b border-background-100 flex-wrap">
              <span className="text-xs text-foreground-400 mr-1">语言</span>
              {langs.map((code) => (
                <button
                  key={code}
                  onClick={() => void generateMinutes(code)}
                  disabled={minutesLoading}
                  className={`h-7 px-2.5 rounded-lg text-xs font-medium disabled:opacity-50 ${minutesLang === code ? 'bg-accent-500 text-background-50' : 'bg-background-100 text-foreground-600'}`}
                >
                  {langLabel(code)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {minutesLoading && (
                <div className="py-10 flex flex-col items-center text-foreground-400">
                  <i className="ri-loader-4-line animate-spin text-3xl mb-3 text-accent-500"></i>
                  <p className="text-sm">正在生成会议纪要…</p>
                </div>
              )}
              {!minutesLoading && minutes && (
                <div className="space-y-5">
                  {minutes.title && <h4 className="text-lg font-bold text-foreground-900">{minutes.title}</h4>}
                  {minutes.summary && <p className="text-sm text-foreground-600 leading-relaxed">{minutes.summary}</p>}
                  {([
                    { items: minutes.points, label: '讨论要点', icon: 'ri-discuss-line text-accent-500' },
                    { items: minutes.decisions, label: '决定事项', icon: 'ri-check-double-line text-green-500' },
                  ]).filter((sec) => sec.items?.length).map((sec) => (
                    <section key={sec.label}>
                      <div className="text-xs font-bold text-foreground-500 mb-2 flex items-center gap-1.5"><i className={sec.icon}></i>{sec.label}</div>
                      <ul className="space-y-1.5">
                        {sec.items.map((p, i) => (
                          <li key={i} className="text-sm text-foreground-700 leading-relaxed flex gap-2"><span className="text-accent-400">·</span><span>{p}</span></li>
                        ))}
                      </ul>
                    </section>
                  ))}
                  {minutes.todos?.length > 0 && (
                    <section>
                      <div className="text-xs font-bold text-foreground-500 mb-2 flex items-center gap-1.5"><i className="ri-task-line text-accent-500"></i>待办事项</div>
                      <ul className="space-y-1.5">
                        {minutes.todos.map((td, i) => (
                          <li key={i} className="text-sm text-foreground-700 leading-relaxed flex gap-2 items-start">
                            <span className="text-accent-400">☐</span>
                            <span>{td.task}{td.owner && <span className="ml-2 text-xs text-accent-600 bg-accent-100 rounded px-1.5 py-0.5">{td.owner}</span>}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {!minutes.summary && !minutes.points?.length && !minutes.decisions?.length && !minutes.todos?.length && (
                    <p className="text-sm text-foreground-400">这段会议内容较少,未能整理出要点。</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-end md:items-center justify-center" onClick={() => setShowHistory(false)}>
          <div className="bg-background-50 w-full md:max-w-lg rounded-t-2xl md:rounded-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-background-200">
              <i className="ri-history-line text-accent-500"></i>
              <h3 className="text-sm font-semibold text-foreground-900">历史记录</h3>
              <span className="text-xs text-foreground-400">与电脑端同步</span>
              <button onClick={() => setShowHistory(false)} className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400">
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {history.length === 0 ? (
                <div className="py-12 text-center text-foreground-300 text-sm"><i className="ri-inbox-line text-3xl block mb-2"></i>还没有会议记录</div>
              ) : (
                <ul className="divide-y divide-background-100">
                  {history.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-2.5 px-2">
                      <button onClick={() => openSession(s)} disabled={running} className="flex-1 min-w-0 text-left disabled:opacity-50">
                        <p className="text-sm font-medium text-foreground-900 truncate">{s.title || '未命名会议'}</p>
                        <p className="text-xs text-foreground-400 mt-0.5">
                          {new Date(s.created).toLocaleString()} · {s.turns?.length || 0} 句{s.minutes ? ' · 含纪要' : ''}
                        </p>
                      </button>
                      <button onClick={() => deleteSession(s)} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-foreground-300 active:text-red-500" aria-label="删除">
                        <i className="ri-delete-bin-line"></i>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
