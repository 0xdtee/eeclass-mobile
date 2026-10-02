import { useParams, useNavigate } from 'react-router-dom';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import BackButton from '@/components/feature/BackButton';
import { useLiveCaption } from '@/hooks/useLiveCaption';
import { useSessionDetail, markLine, autoHighlight, type TranscriptionLine } from '@/hooks/useRecords';
import { apiFetch, getServerUrl, getToken } from '@/lib/api';
import { downloadSubtitle, hasSubtitleTiming, type SubtitleFormat } from '@/lib/exportSubtitle';
import { saveBlob, safeFileName } from '@/lib/download';

type Kind = 'key' | 'define' | null;
const KIND_CLASS: Record<string, string> = {
  key: 'bg-yellow-200/70 rounded px-0.5',
  define: 'bg-green-200/70 rounded px-0.5',
};

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '00:00';
  const x = Math.floor(s);
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  const sec = x % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
};

interface PlayerHandle { seek: (seconds: number, play?: boolean) => void; }

/** Compact audio bar for the session page. Exposes seek() so tapping a line jumps the recording to it. */
const MiniPlayer = forwardRef<PlayerHandle, { src: string; onTime?: (t: number) => void; onUnavailable?: () => void }>(
  ({ src, onTime, onUnavailable }, ref) => {
    const el = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [cur, setCur] = useState(0);
    const [dur, setDur] = useState(0);

    useImperativeHandle(ref, () => ({
      seek(seconds, play = true) {
        const a = el.current;
        if (!a) return;
        a.currentTime = Math.max(0, seconds);
        if (play) void a.play().catch(() => undefined);
      },
    }));

    return (
      <div className="flex items-center gap-3 bg-background-100 rounded-full px-3 py-2">
        <audio
          ref={el}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDur(d); }}
          onTimeUpdate={(e) => { setCur(e.currentTarget.currentTime); onTime?.(e.currentTarget.currentTime); }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => onUnavailable?.()}
        />
        <button
          onClick={() => {
            const a = el.current;
            if (!a) return;
            if (a.paused) void a.play().catch(() => undefined);
            else a.pause();
          }}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-primary-500 text-background-50 flex-shrink-0 active:scale-95"
        >
          <i className={`${playing ? 'ri-pause-fill' : 'ri-play-fill'} text-lg`}></i>
        </button>
        <span className="text-[11px] font-mono text-foreground-500 w-10 text-right flex-shrink-0">{fmt(cur)}</span>
        <input
          type="range"
          min={0}
          max={dur || 0}
          step={0.1}
          value={Math.min(cur, dur || cur)}
          onChange={(e) => { const a = el.current; if (a) { const t = Number(e.target.value); a.currentTime = t; setCur(t); } }}
          className="flex-1 h-1 accent-primary-500"
        />
        <span className="text-[11px] font-mono text-foreground-400 w-10 flex-shrink-0">{fmt(dur)}</span>
      </div>
    );
  },
);
MiniPlayer.displayName = 'MiniPlayer';

export default function SessionDetailPage() {
  const { sid } = useParams<{ sid: string }>();
  const navigate = useNavigate();
  const live = useLiveCaption();
  const recordingThis = (live.running || live.starting) && !!sid && live.liveSid === sid;
  const recordingOther = (live.running || live.starting) && !recordingThis;
  const { detail, loading, error, refresh } = useSessionDetail(sid || null);

  const lines = detail?.transcription || [];
  const hasSummary = !!(detail && (detail.summary || (detail.key_points && detail.key_points.length)));

  const playerRef = useRef<PlayerHandle>(null);
  const [audioOk, setAudioOk] = useState(true);   // false once /api/audio 404s (no recording saved)
  const [curTime, setCurTime] = useState(0);

  // Highlights: optimistic local overrides on top of what the server returned
  const [kinds, setKinds] = useState<Record<number, Kind>>({});
  const [markFor, setMarkFor] = useState<number | null>(null);   // line whose highlight picker is open
  const [highlighting, setHighlighting] = useState(false);
  const [hlMsg, setHlMsg] = useState('');
  const kindOf = (l: TranscriptionLine): Kind => (l.line_id in kinds ? kinds[l.line_id] : l.kind ?? null);

  const setMark = async (lineId: number, kind: Kind) => {
    if (!sid) return;
    setMarkFor(null);
    setKinds((k) => ({ ...k, [lineId]: kind }));
    try {
      await markLine(sid, lineId, kind);
    } catch (e) {
      setKinds((k) => { const n = { ...k }; delete n[lineId]; return n; });
      setSaveError(e instanceof Error ? e.message : '标注失败');
    }
  };

  const runAutoHighlight = async () => {
    if (!sid || highlighting) return;
    setHighlighting(true);
    setHlMsg('');
    try {
      const r = await autoHighlight(sid);
      const n = r && typeof r.added === 'number' ? r.added : 0;
      setKinds({});
      await refresh();
      setHlMsg(n > 0 ? `已补标 ${n} 处(绿=定义,黄=重点)` : '没有找到可补标的定义/重点');
    } catch (e) {
      setHlMsg(e instanceof Error ? e.message : '标注失败');
    } finally {
      setHighlighting(false);
      setTimeout(() => setHlMsg(''), 5000);
    }
  };

  // Export: Word / PDF (highlights kept), plain text, or subtitles timed to the class audio
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const title = detail?.title || sid || '课堂转写';
  const canSubtitle = hasSubtitleTiming(lines);
  const runExport = async (fmt: 'txt' | SubtitleFormat | 'word' | 'pdf') => {
    setExportOpen(false);
    if (!lines.length || exporting) return;
    setExporting(true);
    try {
      if (fmt === 'txt') {
        const body = lines
          .map((l) => `[${l.ts}] ${l.speaker ? l.speaker + ': ' : ''}${l.text}${l.translation ? `\n    ${l.translation}` : ''}`)
          .join('\n');
        await saveBlob(new Blob([`﻿${title}\n\n${body}\n`], { type: 'text/plain;charset=utf-8' }), `${safeFileName(title)}.txt`);
      } else if (fmt === 'srt' || fmt === 'vtt') {
        await downloadSubtitle(lines, fmt, title);
      } else {
        const doc = {
          title,
          subtitle: [detail?.date, `${lines.length} 句`].filter(Boolean).join(' · '),
          summary: detail?.summary,
          keyPoints: detail?.key_points ?? [],
          lines: lines.map((l) => ({ ts: l.ts, speaker: l.speaker, text: l.text, kind: kindOf(l) })),
        };
        if (fmt === 'word') await (await import('@/lib/exportWord')).exportWord(doc);
        else await (await import('@/lib/exportPdf')).exportPdf(doc);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // Inline editing
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const audioUrl = sid ? `${getServerUrl()}/api/audio/${encodeURIComponent(sid)}?token=${encodeURIComponent(getToken())}` : '';
  const showPlayer = !!sid && audioOk;

  const seek = (start: number) => {
    if (showPlayer) playerRef.current?.seek(start);
  };

  const saveLine = async (lineId: number) => {
    if (!sid || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await apiFetch(`/api/transcript/${encodeURIComponent(sid)}/edit`, {
        method: 'POST',
        body: JSON.stringify({ line_id: lineId, text: draft }),
      });
      setEditingId(null);
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <BackButton />
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900 truncate">{detail?.title || '课时详情'}</h1>
        <div className="flex items-center gap-3 mt-1.5">
          {detail?.date && (
            <span className="text-xs text-foreground-400 flex items-center gap-1">
              <i className="ri-calendar-line"></i>{detail.date}
            </span>
          )}
          {lines.length > 0 && (
            <span className="text-xs text-foreground-400 flex items-center gap-1">
              <i className="ri-chat-1-line"></i>{lines.length} 句
            </span>
          )}
        </div>

        {/* Actions */}
        {sid && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => navigate(`/summary/${encodeURIComponent(sid)}`)}
              className="flex-1 md:flex-none md:px-5 py-2.5 bg-accent-500 text-background-50 rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-accent-600 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <i className="ri-magic-line"></i>
              {hasSummary ? '查看 AI 摘要' : '生成 AI 摘要'}
            </button>
            <button
              onClick={() => navigate(`/study?sid=${encodeURIComponent(sid)}`)}
              className="flex-1 md:flex-none md:px-5 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-background-200 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
            >
              <i className="ri-brain-line"></i>
              复习
            </button>
            {/* A class cut off mid-way (the app was killed in the background, the mic died) continues here,
                appended to what it already holds -- instead of 录音 making a second class of the same lesson. */}
            {!recordingOther && (
              <button
                onClick={() => navigate(recordingThis ? '/record'
                  : `/record?append=${encodeURIComponent(sid)}&title=${encodeURIComponent(detail?.title || '')}`)}
                className="flex-1 md:flex-none md:px-5 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs md:text-sm font-medium cursor-pointer hover:bg-red-100 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
              >
                <i className="ri-mic-line"></i>
                {recordingThis ? '回到录音页' : '继续录这节课'}
              </button>
            )}
          </div>
        )}

        {/* Secondary actions: AI highlighting + export */}
        {sid && lines.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => void runAutoHighlight()}
              disabled={highlighting}
              className="flex-1 md:flex-none md:px-5 py-2 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium whitespace-nowrap flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <i className={highlighting ? 'ri-loader-4-line animate-spin' : 'ri-mark-pen-line'}></i>
              {highlighting ? 'AI 标注中…' : '一键标注'}
            </button>
            <div className="relative flex-1 md:flex-none">
              <button
                onClick={() => setExportOpen((v) => !v)}
                disabled={exporting}
                className="w-full md:px-5 py-2 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium whitespace-nowrap flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <i className={exporting ? 'ri-loader-4-line animate-spin' : 'ri-download-2-line'}></i>
                {exporting ? '导出中…' : '导出'}
                <i className={`ri-arrow-${exportOpen ? 'up' : 'down'}-s-line`}></i>
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 z-20 w-52 bg-background-50 border border-background-200 rounded-xl shadow-lg p-1.5">
                    {([
                      { k: 'word', label: 'Word (.docx)', icon: 'ri-file-word-2-line', ok: true },
                      { k: 'pdf', label: 'PDF', icon: 'ri-file-pdf-2-line', ok: true },
                      { k: 'txt', label: '纯文本 (.txt)', icon: 'ri-file-text-line', ok: true },
                      { k: 'srt', label: '字幕 (.srt)', icon: 'ri-closed-captioning-line', ok: canSubtitle },
                      { k: 'vtt', label: '字幕 (.vtt)', icon: 'ri-closed-captioning-line', ok: canSubtitle },
                    ] as const).map((it) => (
                      <button
                        key={it.k}
                        onClick={() => void runExport(it.k)}
                        disabled={!it.ok}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm text-foreground-700 active:bg-background-100 disabled:opacity-40"
                      >
                        <i className={`${it.icon} text-foreground-400`}></i>{it.label}
                      </button>
                    ))}
                    <p className="px-2.5 pt-1 pb-1.5 text-[11px] text-foreground-400 leading-relaxed">
                      {canSubtitle ? '字幕按录音时间轴对齐,有译文时附在原文下一行' : '这节课没有时间戳,无法生成字幕'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {hlMsg && <p className="text-xs text-accent-600 mt-2">{hlMsg}</p>}
      </div>

      <div className="px-5 md:px-8 pb-8 max-w-5xl">
        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
            <p className="text-xs text-foreground-400 mt-1">请检查后端服务是否运行</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && lines.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-background-100 rounded-xl mb-3">
              <i className="ri-file-text-line text-foreground-300 text-xl"></i>
            </div>
            <p className="text-sm text-foreground-400">本节课暂无转写内容</p>
          </div>
        )}

        {/* Summary preview */}
        {!loading && !error && detail?.summary && (
          <div
            onClick={() => sid && navigate(`/summary/${encodeURIComponent(sid)}`)}
            className="mb-4 bg-accent-50/60 rounded-xl p-4 border border-accent-200 cursor-pointer hover:border-accent-300 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <i className="ri-magic-line text-accent-600"></i>
              <span className="text-xs font-semibold text-accent-700">AI 摘要</span>
              <i className="ri-arrow-right-s-line text-accent-500 ml-auto"></i>
            </div>
            <p className="text-xs text-foreground-600 leading-relaxed line-clamp-3">{detail.summary}</p>
          </div>
        )}

        {/* Transcript */}
        {lines.length > 0 && (
          <div className="bg-background-50 rounded-xl p-4 md:p-5 border border-background-200">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 flex items-center justify-center bg-accent-100 rounded-lg">
                  <i className="ri-file-text-line text-accent-600"></i>
                </div>
                <h3 className="text-sm font-semibold text-foreground-800">课堂转写</h3>
              </div>
              <span className="text-[11px] text-foreground-400 flex items-center gap-2">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-300"></span>重点</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-300"></span>定义</span>
                {showPlayer && <span className="hidden sm:flex items-center gap-1"><i className="ri-cursor-line"></i>点句子跳转录音</span>}
              </span>
            </div>

            {/* Audio bar (hidden if this session has no saved recording) */}
            {showPlayer && (
              <div className="mb-4">
                <MiniPlayer ref={playerRef} src={audioUrl} onTime={setCurTime} onUnavailable={() => setAudioOk(false)} />
              </div>
            )}

            {saveError && <p className="text-xs text-red-600 mb-2">{saveError}</p>}

            <div className="space-y-1">
              {lines.map((line) => {
                const active = showPlayer && (line.start ?? 0) <= curTime && curTime < (line.end ?? (line.start ?? 0) + 3);
                const editing = editingId === line.line_id;
                return (
                  <div
                    key={line.line_id}
                    className={`rounded-lg p-2 transition-colors ${active ? 'bg-primary-50' : 'hover:bg-background-100'}`}
                  >
                    <div className="flex gap-3">
                      <span className="text-[11px] text-foreground-400 font-mono whitespace-nowrap mt-0.5">{line.ts}</span>
                      <div className="min-w-0 flex-1">
                        {line.speaker && <span className="text-xs font-medium text-accent-600 mr-2">{line.speaker}</span>}
                        {editing ? (
                          <div className="mt-1">
                            <textarea
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              autoFocus
                              rows={Math.max(2, Math.ceil(draft.length / 22))}
                              className="w-full text-sm text-foreground-800 bg-background-50 border border-accent-300 rounded-lg px-2.5 py-2 leading-relaxed focus:outline-none focus:border-accent-500"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => void saveLine(line.line_id)}
                                disabled={saving}
                                className="text-xs px-3.5 py-1.5 rounded-full bg-accent-500 text-background-50 font-semibold active:scale-95 disabled:opacity-50 flex items-center gap-1"
                              >
                                {saving && <i className="ri-loader-4-line animate-spin"></i>}保存
                              </button>
                              <button
                                onClick={() => { setEditingId(null); setSaveError(''); }}
                                className="text-xs px-3.5 py-1.5 rounded-full bg-background-100 text-foreground-600 font-medium active:scale-95"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            {/* Tap text -> seek recording to this line */}
                            <span
                              onClick={() => seek(line.start ?? 0)}
                              className={`text-sm text-foreground-700 leading-relaxed ${KIND_CLASS[kindOf(line) ?? ''] ?? ''} ${showPlayer ? 'cursor-pointer' : ''}`}
                            >
                              {line.text}
                            </span>
                            <button
                              onClick={() => { setEditingId(line.line_id); setDraft(line.text); setSaveError(''); }}
                              className="ml-2 align-middle text-[11px] text-foreground-400 hover:text-accent-600 active:scale-95 inline-flex items-center gap-0.5"
                            >
                              <i className="ri-pencil-line"></i>修改
                            </button>
                            <button
                              onClick={() => setMarkFor(markFor === line.line_id ? null : line.line_id)}
                              className="ml-2 align-middle text-[11px] text-foreground-400 hover:text-accent-600 active:scale-95 inline-flex items-center gap-0.5"
                            >
                              <i className="ri-mark-pen-line"></i>标注
                            </button>
                            {markFor === line.line_id && (
                              <div className="flex gap-1.5 mt-1.5">
                                {([
                                  { k: 'key' as Kind, label: '重点', cls: 'bg-yellow-100 text-yellow-800' },
                                  { k: 'define' as Kind, label: '定义', cls: 'bg-green-100 text-green-800' },
                                  { k: null as Kind, label: '取消标注', cls: 'bg-background-100 text-foreground-500' },
                                ]).map((o) => (
                                  <button
                                    key={o.label}
                                    onClick={() => void setMark(line.line_id, o.k)}
                                    disabled={kindOf(line) === o.k}
                                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium active:scale-95 disabled:opacity-40 ${o.cls}`}
                                  >
                                    {o.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            {line.translation && (
                              <p className="mt-1 text-[13px] text-sky-700 flex items-start gap-1.5">
                                <i className="ri-translate-2 text-sky-400 mt-0.5"></i><span>{line.translation}</span>
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
