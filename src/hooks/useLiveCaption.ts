/**
 * Real-time classroom caption hook — phone/tablet (ported from the working desktop implementation).
 * Browser mic → downsample to 16k mono Int16 → push to backend as binary WebSocket frames;
 * the backend pushes each transcribed sentence back via WebSocket text messages.
 * Server URL/token come from @/lib/api (same-origin deployments automatically use the current origin).
 */
import { useCallback, useEffect, useRef, useState, createContext, useContext, createElement } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getServerUrl, getToken, clearToken, apiFetch } from '@/lib/api';
import { getMicGain, setMicGain, MIC_GAIN_MAX } from '@/lib/settings';

export { getServerUrl, getToken };

const CID_KEY = 'eeclass_cid';
/** Client identifier: on reconnect the backend uses it to recover the same session (no lost transcription). Stored locally and kept permanently. */
export function getCid(): string {
  if (typeof window === 'undefined') return '';
  let c = localStorage.getItem(CID_KEY);
  if (!c) {
    c = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(CID_KEY, c);
  }
  return c;
}

export interface CaptionLine {
  id: number;
  ts: string;
  start: number;
  end: number;
  speaker: string;
  speaker_id: number;
  text: string;
  kind: 'key' | 'define' | null;
  new_para: boolean;
  aiFixed?: boolean;
  translation?: string;
}

export interface SpeakerStat {
  id: number;
  name: string;
  seconds: number;
  utterances: number;
}

export interface LiveStatus {
  elapsed: number;
  level: number;
  backlog: number;
  rtf: number;
  lines: number;
  speakers: SpeakerStat[];
  dir?: string;
}

export interface AiSummary {
  summary: string;
  key_points: string[];
  formulas?: string[];
  exam_hints?: string[];
  questions?: string[];
  corrections?: string[];
}

export interface StartOptions {
  title?: string | null;
  /** Date (yyyy-mm-dd) of the timetable lesson this recording belongs to, when started from the schedule */
  forDate?: string | null;
  sensitivity?: 'std' | 'high' | 'max';
  model?: 'sensevoice' | 'paraformer' | 'stream' | 'aliyun' | 'aliyun_wu' | 'aliyun_multi';
  aiCorrect?: boolean;
  smartSeg?: boolean;
  /** Live translation: source (原文) and target (译文) language codes; off when equal */
  translateFrom?: string;
  translateTo?: string;
  subjects?: string[];
  appendSid?: string | null;
}

const SENS: Record<string, { threshold: number; exit_threshold: number; min_speech_ms: number }> = {
  std: { threshold: 0.5, exit_threshold: 0.35, min_speech_ms: 250 },
  high: { threshold: 0.35, exit_threshold: 0.22, min_speech_ms: 180 },
  max: { threshold: 0.3, exit_threshold: 0.2, min_speech_ms: 150 },
};

/** Highest pickup gain offered. Safe to sit at because of the limiter + soft clip in the capture chain. */
export const MAX_GAIN = MIC_GAIN_MAX;

/**
 * Saturate instead of clip. Below 0.7 the sample is untouched; above it the curve bends smoothly
 * toward ±1. Hard clipping squares off the waveform and the recognizer hears distortion, which is
 * why simply raising the gain used to stop helping past ~6×.
 */
export function softClip(x: number): number {
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  return Math.sign(x) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
}

/** A few milliseconds of silence, looped to hold an active media session while recording. */
const SILENT_LOOP =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQQAAAAAAAAA';

const EMPTY_STATUS: LiveStatus = { elapsed: 0, level: 0, backlog: 0, rtf: 0, lines: 0, speakers: [] };
const TARGET_SR = 16000;

// AudioWorklet capture processor: downsamples to 16k mono Int16 on the realtime audio thread and posts
// ~64ms chunks to the main thread. On iOS this avoids the dropped buffers + latency that ScriptProcessor
// (main-thread, throttled under UI load) suffers from. Built once as a Blob module URL.
let _captureWorkletUrl: string | null = null;
export function captureWorkletUrl(): string {
  if (_captureWorkletUrl) return _captureWorkletUrl;
  const code = `
class DsCapture extends AudioWorkletProcessor {
  constructor(o){ super(); const p=(o&&o.processorOptions)||{}; this.ratio=sampleRate/(p.targetSr||16000); this.frac=0; this.buf=[]; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if(!ch) return true;
    let pos=this.frac;
    for(; pos<ch.length; pos+=this.ratio){
      const i0=Math.floor(pos), f=pos-i0;
      const nx=(i0+1<ch.length)?ch[i0+1]:ch[i0];
      let s=ch[i0]*(1-f)+nx*f; const a=s<0?-s:s;
      if(a>0.7) s=(s<0?-1:1)*(0.7+0.3*Math.tanh((a-0.7)/0.3));   // soft clip, same curve as softClip()
      this.buf.push(s*32767);
    }
    this.frac=pos-ch.length;                 // carry the fractional read position into the next block
    if(this.buf.length>=1024){
      const pcm=new Int16Array(this.buf); this.buf.length=0;
      this.port.postMessage(pcm.buffer,[pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('ds-capture', DsCapture);
`;
  _captureWorkletUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  return _captureWorkletUrl;
}

function wsOrigin(): string {
  return getServerUrl().replace(/^http/, 'ws');
}

function useLiveCaptionState(enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [lines, setLines] = useState<CaptionLine[]>([]);
  const [partial, setPartial] = useState('');
  const [status, setStatus] = useState<LiveStatus>(EMPTY_STATUS);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [lastDir, setLastDir] = useState('');
  const [liveSid, setLiveSid] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [deepseekReady, setDeepseekReady] = useState(false);
  // Pickup gain, adjustable live while recording (the slider moves the running gain node).
  const [gain, setGainState] = useState<number>(() => getMicGain());
  const gainRef = useRef(gain);
  const gainNodeRef = useRef<GainNode | null>(null);
  const setGain = useCallback((v: number) => {
    setMicGain(v);
    const g = getMicGain();
    gainRef.current = g;
    setGainState(g);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = g;
  }, []);
  // Phones/tablets suspend the AudioContext when the page goes to the background or the screen locks:
  // the socket stays open, so the UI would claim it is still recording while no audio is captured at all.
  // Track when audio last actually flowed and surface a stall.
  const lastAudioRef = useRef(0);
  const [audioStalled, setAudioStalled] = useState(false);
  // A silent looping track: while it plays the OS treats this page as an active media session, which keeps
  // it alive in the background far longer. It cannot defeat iOS's rule that only native apps capture audio
  // with the screen locked, but it covers app-switching.
  const keepAliveRef = useRef<HTMLAudioElement | null>(null);
  const startKeepAlive = useCallback(() => {
    if (keepAliveRef.current) return;
    try {
      const a = new Audio(SILENT_LOOP);
      a.loop = true;
      a.volume = 0.001;          // not 0: some browsers treat a muted element as "not playing"
      (a as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      void a.play().catch(() => {});
      keepAliveRef.current = a;
      const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
      if (ms && 'MediaMetadata' in window) {
        ms.metadata = new MediaMetadata({ title: '课堂录音进行中', artist: 'eeclass' });
        ms.playbackState = 'playing';
      }
    } catch { /* keep-alive is best effort */ }
  }, []);
  const stopKeepAlive = useCallback(() => {
    const a = keepAliveRef.current;
    keepAliveRef.current = null;
    try { a?.pause(); } catch { /* ignore */ }
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (ms) ms.playbackState = 'none';
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioNode } | null>(null);
  const recordingRef = useRef(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  // control commands issued before the socket finished connecting (e.g. a fast tap on record):
  // queue them and flush on open, so 'start' is never silently dropped.
  const pendingRef = useRef<Record<string, unknown>[]>([]);
  // the class this start continues (append), so 'started' knows to bring back what it already holds
  const appendRef = useRef<string | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else pendingRef.current.push(msg);
  }, []);

  /* ---------- Microphone capture ---------- */
  const stopMic = useCallback(() => {
    const m = micRef.current;
    if (!m) return;
    try { m.node.disconnect(); } catch { /* ignore */ }
    try { m.stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void m.ctx.close(); } catch { /* ignore */ }
    micRef.current = null;
    gainNodeRef.current = null;
    setMicActive(false);
  }, []);

  const startMic = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器无法使用麦克风。请通过 https 打开页面以获取麦克风权限。');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      // autoGainControl ON: essential for lifting quiet/distant/loudspeaker audio to an audible level -- with
      // it off, external playback was too quiet and NOTHING transcribed. (It does flatten speaker cues a bit,
      // which is a diarization trade-off, but recognition is the primary function.) NS/echo stay OFF.
      // All browser audio processing OFF (same as the WEB build, where speaker diarization works). AGC/NS
      // adaptively flatten the loudness/spectral cues the voiceprint model needs, which is why the iPad
      // couldn't tell speakers apart while the web could. We lift the level with a fixed LINEAR gain below,
      // which boosts quiet audio for recognition WITHOUT flattening the per-speaker dynamics.
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: TARGET_SR });
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* iOS gesture-gate */ } }
    const src = ctx.createMediaStreamSource(stream);
    // Anti-alias low-pass just below the 16k Nyquist: if iOS ignores the 16k context request and runs at
    // 48k, our decimation would otherwise fold >8k content back as noise and hurt recognition.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7600;
    src.connect(lp);
    // Pickup gain -> limiter -> makeup. The limiter is what makes high gain usable: it rounds off the peaks
    // instead of letting them square off against the ±1 ceiling, so a distant lecturer can be lifted without
    // turning the loud parts to mush. The gain node is live-adjustable from the recording screen.
    gainRef.current = getMicGain();          // pick up a change made in 我的 → 拾音灵敏度 since the last start
    setGainState(gainRef.current);
    const gainNode = ctx.createGain();
    gainNode.gain.value = gainRef.current;
    gainNodeRef.current = gainNode;
    lp.connect(gainNode);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -24;
    limiter.knee.value = 24;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    // DynamicsCompressorNode only ever attenuates, so without makeup the chain would end up quieter. These
    // numbers were swept against the real node in a browser (desktop eeclass): the loudest combination that
    // still leaves ~0% of samples flat-topped at near, medium and far speaking distance.
    const makeup = ctx.createGain();
    makeup.gain.value = 2;
    gainNode.connect(limiter);
    limiter.connect(makeup);
    const send = (buf: ArrayBuffer) => {
      lastAudioRef.current = Date.now();
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf);
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;

    let node: AudioNode;
    try {
      // Preferred: AudioWorklet (realtime thread) — no dropped audio / added latency on iOS.
      await ctx.audioWorklet.addModule(captureWorkletUrl());
      const wnode = new AudioWorkletNode(ctx, 'ds-capture', { processorOptions: { targetSr: TARGET_SR } });
      wnode.port.onmessage = (e) => send(e.data as ArrayBuffer);
      node = wnode;
    } catch {
      // Fallback: ScriptProcessor (older WebViews without AudioWorklet).
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      const ratio = ctx.sampleRate / TARGET_SR;
      sp.onaudioprocess = (e) => {
        lastAudioRef.current = Date.now();
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const outLen = Math.floor(input.length / ratio);
        const pcm = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const pos = i * ratio;
          const i0 = Math.floor(pos);
          const frac = pos - i0;
          const s = input[i0] * (1 - frac) + (input[i0 + 1] ?? input[i0]) * frac;
          pcm[i] = softClip(s) * 32767;
        }
        send(pcm.buffer);
      };
      node = sp;
    }
    makeup.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    micRef.current = { ctx, stream, node };
    lastAudioRef.current = Date.now();
    setAudioStalled(false);
    setMicActive(true);
  }, []);

  /* ---------- Keep screen awake (prevent lock-screen interruption) ---------- */
  const requestWakeLock = useCallback(async () => {
    try {
      const nav = navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      if (nav.wakeLock && document.visibilityState === 'visible' && !wakeLockRef.current) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch { /* ignore */ }
  }, []);
  const releaseWakeLock = useCallback(() => {
    try { void wakeLockRef.current?.release(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  }, []);

  /** Bring back what a class already holds (after the app was relaunched mid-recording, or when continuing a
   *  class): fetch its transcript and merge it with whatever lines arrived meanwhile, deduped by id. */
  const loadExisting = useCallback(async (sid: string) => {
    if (!sid) return;
    try {
      const t = await apiFetch<{ lines: Record<string, unknown>[] }>(`/api/transcript/${encodeURIComponent(sid)}`);
      const old = (t.lines || []).map((l) => ({
        id: l.id as number, ts: (l.ts as string) || '', start: (l.start as number) || 0, end: (l.end as number) || 0,
        speaker: (l.speaker as string) || '', speaker_id: (l.speaker_id as number) ?? 0, text: (l.text as string) || '',
        kind: (l.kind as 'key' | 'define' | null) ?? null, new_para: !!l.new_para,
        translation: (l.translation as string) || undefined,
      }) as CaptionLine);
      setLines((prev) => {
        const byId = new Map<number, CaptionLine>();
        [...old, ...prev].forEach((l) => byId.set(l.id, l));
        return [...byId.values()].sort((a, b) => a.id - b.id);
      });
    } catch { /* the live lines still show; the class page has the full transcript */ }
  }, []);

  /* ---------- WebSocket ---------- */
  const connect = useCallback(() => {
    if (!aliveRef.current) return;
    const token = getToken();
    // No token yet (login / registration). Connecting anonymously only makes the server count failed
    // authentications and eventually lock this address out of signing up, so wait for a token instead.
    if (!token) {
      retryRef.current = setTimeout(connect, 2000);
      return;
    }
    const params = new URLSearchParams();
    params.set('token', token);
    params.set('cid', getCid());
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsOrigin() + '/ws?' + params.toString());
    } catch {
      retryRef.current = setTimeout(connect, 3000);
      return;
    }
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setConnected(true);
      setAuthFailed(false);
      setError('');
      // flush any commands (a fast 'start') queued while the socket was still connecting
      const q = pendingRef.current; pendingRef.current = [];
      q.forEach((m) => { try { ws.send(JSON.stringify(m)); } catch { /* ignore */ } });
      fetch(getServerUrl() + '/health').then((r) => r.json())
        .then((j) => setDeepseekReady(!!j.deepseek)).catch(() => undefined);
    };
    ws.onclose = (ev) => {
      setConnected(false); setRunning(false); setStarting(false);
      pendingRef.current = [];   // drop queued commands so a stale 'start' can't fire after a reconnect
      stopMic();
      if (!ev.wasClean && ev.code === 1006 && getToken() === '') { setAuthFailed(true); clearToken(); }
      if (aliveRef.current) retryRef.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => setError('无法连接字幕服务。请确认后端已启动、使用 https 访问且证书已受信任。');

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let m: Record<string, unknown> & { type?: string };
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'hello':
          if (m.resumed) {
            // The app came back (often relaunched by iOS) while its class was still recording on the server.
            setRunning(true); setStarting(false);
            if (m.sid) { setLiveSid(m.sid as string); void loadExisting(m.sid as string); }
            recordingRef.current = true;
            // iOS often refuses the mic until the user taps: say so instead of claiming it resumed, and offer
            // 「重新接上麦克风」 -- the old silence let the class record nothing until the server ended it.
            startMic()
              .then(() => setNotice('已恢复录制'))
              .catch(() => setNotice('麦克风没能自动接上(系统要求点一下),请点「重新接上麦克风」继续录这节课'));
          } else {
            setRunning(!!m.running);
          }
          break;
        case 'started':
          recordingRef.current = true;
          setRunning(true); setStarting(false); setPaused(false);
          setLines([]); setPartial('');
          setLastDir((m.dir as string) || '');
          setLiveSid((m.sid as string) || '');
          setNotice(appendRef.current ? '接着这节课继续录音' : '已开始录制');
          if (appendRef.current && m.sid) void loadExisting(m.sid as string);
          appendRef.current = null;
          break;
        case 'stopped':
          recordingRef.current = false;
          setRunning(false); setPaused(false); setPartial(''); setLines([]);
          stopMic();
          setLastDir((m.dir as string) || '');
          setLiveSid((m.sid as string) || '');
          setNotice(`已保存 ${(m.meta as { lines?: number })?.lines ?? 0} 句`);
          break;
        case 'line':
          setPartial('');
          setLines((prev) => [...prev, m as unknown as CaptionLine]);
          break;
        case 'line_update':
          setLines((prev) => prev.map((l) => l.id === m.id ? {
            ...l,
            ...(m.text != null ? { text: m.text as string, aiFixed: true } : {}),
            ...(m.kind !== undefined ? { kind: m.kind as 'key' | 'define' | null } : {}),
          } : l));
          break;
        case 'line_translation':
          setLines((prev) => prev.map((l) => l.id === m.id ? { ...l, translation: m.text as string } : l));
          break;
        case 'partial':
          setPartial((m.text as string) || '');
          break;
        case 'status':
          setRunning(!!m.running); setPaused(!!m.paused);
          if (m.running) {
            setStatus({
              elapsed: (m.elapsed as number) ?? 0,
              level: (m.level as number) ?? 0,
              backlog: (m.backlog as number) ?? 0,
              rtf: (m.rtf as number) ?? 0,
              lines: (m.lines as number) ?? 0,
              speakers: (m.speakers as SpeakerStat[]) ?? [],
              dir: m.dir as string,
            });
          }
          break;
        case 'renamed':
          setLines((prev) => prev.map((l) => l.speaker === m.old ? { ...l, speaker: m.name as string } : l));
          setNotice(`「${m.old}」已改为「${m.name}」`);
          break;
        case 'notice': setNotice((m.msg as string) || ''); break;
        case 'error': setError((m.msg as string) || ''); setStarting(false); stopMic(); break;
      }
    };
  }, [stopMic, startMic, loadExisting]);

  useEffect(() => {
    if (!enabled) return;                 // only hold the socket/mic open while signed in
    aliveRef.current = true;
    connect();
    return () => {
      aliveRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      stopMic();
      wsRef.current?.close();
    };
  }, [enabled, connect, stopMic]);

  useEffect(() => {
    if (running) { void requestWakeLock(); startKeepAlive(); }
    else { releaseWakeLock(); stopKeepAlive(); }
  }, [running, requestWakeLock, releaseWakeLock, startKeepAlive, stopKeepAlive]);
  // Going to the background releases the wake lock; re-request it on return while still recording, and
  // resume the AudioContext the system suspended while we were away.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || !recordingRef.current) return;
      void requestWakeLock();
      const mic = micRef.current;
      if (mic && mic.ctx.state !== 'running') {
        void mic.ctx.resume().then(() => { lastAudioRef.current = Date.now(); }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [requestWakeLock]);

  // Watch that audio is actually flowing. Phones suspend capture in the background even though the socket
  // stays open, which would otherwise look exactly like a healthy recording. A tab left in the background
  // long enough has its mic track ended outright; once the page is visible again, reopen the mic.
  useEffect(() => {
    if (!running) { setAudioStalled(false); return; }
    let reopening = false;
    const id = window.setInterval(() => {
      const mic = micRef.current;
      if (!mic) return;
      const gap = Date.now() - lastAudioRef.current;
      const suspended = mic.ctx.state !== 'running';
      if (suspended) void mic.ctx.resume().catch(() => {});
      setAudioStalled(gap > 4000 || suspended);
      const dead = mic.stream.getAudioTracks().every((tr) => tr.readyState === 'ended' || !tr.enabled);
      if (!reopening && document.visibilityState === 'visible' && (dead || gap > 15000)) {
        reopening = true;
        stopMic();
        startMic()
          .then(() => setNotice('麦克风已断开,已自动重新接上'))
          .catch(() => setNotice('麦克风已断开,且无法自动恢复,请点「重新接上麦克风」'))
          .finally(() => { reopening = false; });
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [running, startMic, stopMic]);

  const start = useCallback(async (opts: StartOptions = {}) => {
    setStarting(true); setError(''); setLines([]); setPartial('');
    appendRef.current = opts.appendSid || null;
    try {
      await startMic();
    } catch (e) {
      setStarting(false); setError(e instanceof Error ? e.message : String(e)); return;
    }
    const model = opts.model ?? 'aliyun';
    // Map the picked model to a backend: cloud Mandarin/English, cloud dialects, cloud multilingual (Gummy), or a local model.
    const backend =
      model === 'stream' ? 'zipformer'
      : model === 'aliyun' ? 'aliyun_paraformer'
      : model === 'aliyun_wu' ? 'aliyun_funasr'
      : model === 'aliyun_multi' ? 'aliyun_gummy'
      : model;
    send({
      cmd: 'start',
      title: opts.title ?? null,
      device: 'browser',
      loopback: false,
      to_word: false,
      vad: SENS[opts.sensitivity ?? 'high'],
      backend,
      streaming: model === 'stream',
      ai_correct: !!opts.aiCorrect,
      smart_seg: opts.smartSeg !== false,
      translate_from: opts.translateFrom ?? 'zh',   // live translation source (原文)
      translate_to: opts.translateTo ?? 'zh',       // live translation target (译文); off when equal
      subjects: opts.subjects ?? [],
      append_sid: opts.appendSid ?? null,
      for_date: opts.forDate || null,   // started from a timetable lesson -> file it under that lesson's day
    });
  }, [send, startMic]);

  const stop = useCallback(() => {
    recordingRef.current = false;
    send({ cmd: 'stop' });
    stopMic();
  }, [send, stopMic]);

  const setPausedCmd = useCallback((v: boolean) => send({ cmd: 'pause', value: v }), [send]);
  const mark = useCallback(() => send({ cmd: 'mark' }), [send]);
  const rename = useCallback((id: number, name: string) => send({ cmd: 'rename', id, name }), [send]);

  const summarize = useCallback(
    async (title?: string, which?: { ts: string; speaker: string; text: string }[], sid?: string,
           mat?: { fileIds?: string[]; auto?: boolean }): Promise<AiSummary> => {
      const r = await fetch(getServerUrl() + '/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
        body: JSON.stringify({
          title, lines: which ?? lines, dir: lastDir || undefined, sid: sid || liveSid || undefined,
          // class material: explicit picks (manual mode) or auto-match against the class file library
          file_ids: mat?.fileIds && mat.fileIds.length ? mat.fileIds : undefined,
          auto: mat?.auto || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
      return j as AiSummary;
    },
    [lines, lastDir, liveSid]
  );

  // Reopen the mic from a tap (iOS only grants it on a user gesture). Keeps recording the same class --
  // the old advice was to end and start again, which is exactly what split one class into two.
  const reopenMic = useCallback(() => {
    stopMic();
    startMic()
      .then(() => setNotice('麦克风已重新接上,继续录这节课'))
      .catch((e) => setNotice('麦克风还是打不开:' + (e instanceof Error ? e.message : String(e))));
  }, [startMic, stopMic]);
  // Recording, but no mic open: nothing is being captured (the stall watcher only sees an OPEN mic).
  const micLost = running && !paused && !starting && !micActive;

  return {
    connected, authFailed, running, paused, starting, micActive, deepseekReady,
    lines, partial, status, notice, error, lastDir, liveSid, audioStalled, gain, setGain,
    start, stop, setPaused: setPausedCmd, mark, rename, summarize, micLost, reopenMic,
  };
}

// The live session lives in ONE provider mounted above the router outlet, so navigating between
// pages (and back to the record screen) keeps the mic, socket and transcript alive — the record
// page just reads this shared state instead of owning its own per-mount instance.
export type LiveCaption = ReturnType<typeof useLiveCaptionState>;
const LiveCaptionCtx = createContext<LiveCaption | null>(null);

export function LiveCaptionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const value = useLiveCaptionState(isAuthenticated);
  return createElement(LiveCaptionCtx.Provider, { value }, children);
}

export function useLiveCaption(): LiveCaption {
  const ctx = useContext(LiveCaptionCtx);
  if (!ctx) throw new Error('useLiveCaption 必须在 LiveCaptionProvider 内使用');
  return ctx;
}
