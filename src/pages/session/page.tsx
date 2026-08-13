import { useParams, useNavigate } from 'react-router-dom';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import BackButton from '@/components/feature/BackButton';
import { useSessionDetail } from '@/hooks/useRecords';
import { apiFetch, getServerUrl, getToken } from '@/lib/api';

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
  const { detail, loading, error, refresh } = useSessionDetail(sid || null);

  const lines = detail?.transcription || [];
  const hasSummary = !!(detail && (detail.summary || (detail.key_points && detail.key_points.length)));

  const playerRef = useRef<PlayerHandle>(null);
  const [audioOk, setAudioOk] = useState(true);   // false once /api/audio 404s (no recording saved)
  const [curTime, setCurTime] = useState(0);

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
          </div>
        )}
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
              {showPlayer && (
                <span className="text-[11px] text-foreground-400 flex items-center gap-1">
                  <i className="ri-cursor-line"></i>点句子跳转录音
                </span>
              )}
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
                              className={`text-sm text-foreground-700 leading-relaxed ${showPlayer ? 'cursor-pointer' : ''}`}
                            >
                              {line.text}
                            </span>
                            <button
                              onClick={() => { setEditingId(line.line_id); setDraft(line.text); setSaveError(''); }}
                              className="ml-2 align-middle text-[11px] text-foreground-400 hover:text-accent-600 active:scale-95 inline-flex items-center gap-0.5"
                            >
                              <i className="ri-pencil-line"></i>修改
                            </button>
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
