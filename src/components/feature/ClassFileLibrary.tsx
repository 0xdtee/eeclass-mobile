/**
 * Class file library: per-account course material (syllabus, slides, handouts, notes...).
 *
 * Two modes:
 *   'manage' — plain library management (upload / open / delete).
 *   'pick'   — before writing a summary (manual material mode): tick the files the AI should combine
 *              with this lesson, or skip.
 *
 * Text-bearing files are indexed server-side into a knowledge base the AI reads when summarizing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, getServerUrl, getToken } from '@/lib/api';

export interface ClassFile {
  id: string;
  name: string;
  ext: string;
  size?: number;
  created?: number;
}

const iconFor = (ext: string) => {
  const e = (ext || '').toLowerCase();
  if (['.pdf'].includes(e)) return 'ri-file-pdf-2-line';
  if (['.doc', '.docx'].includes(e)) return 'ri-file-word-2-line';
  if (['.ppt', '.pptx', '.key', '.odp'].includes(e)) return 'ri-slideshow-2-line';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) return 'ri-image-line';
  if (['.mp4', '.mov', '.mkv', '.avi'].includes(e)) return 'ri-film-line';
  return 'ri-file-text-line';
};
/** Only these carry text the AI can read into the knowledge base (mirrors the backend's class_files.INDEXABLE). */
const READABLE = ['.txt', '.md', '.markdown', '.csv', '.log', '.json', '.pdf', '.docx', '.pptx'];

const classFileUrl = (id: string) =>
  `${getServerUrl()}/api/class/files/${encodeURIComponent(id)}?token=${encodeURIComponent(getToken())}`;

interface Props {
  mode?: 'manage' | 'pick';
  /** pick mode: 'ended' right after a recording, 'regen' when re-running a past class's summary */
  reason?: 'ended' | 'regen';
  onClose: () => void;
  /** pick mode: continue with the ticked files (empty array = skip and summarize without material) */
  onConfirm?: (fileIds: string[]) => void;
}

export default function ClassFileLibrary({ mode = 'manage', reason = 'ended', onClose, onConfirm }: Props) {
  const picking = mode === 'pick';
  const [files, setFiles] = useState<ClassFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [sync, setSync] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setFiles((await apiFetch<{ files: ClassFile[] }>('/api/class/files')).files || []); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(async (list: FileList | null) => {
    const picked = list ? Array.from(list) : [];
    if (!picked.length) return;
    setUploading(true);
    setErr('');
    try {
      for (const file of picked) {
        const fd = new FormData();
        if (sync) fd.append('sync', '1');
        fd.append('file', file);
        await apiFetch('/api/class/files', { method: 'POST', body: fd });
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }, [load, sync]);

  const del = useCallback(async (f: ClassFile) => {
    if (!window.confirm(`删除「${f.name}」?`)) return;
    try {
      await apiFetch('/api/class/files/' + encodeURIComponent(f.id), { method: 'DELETE' });
      setFiles((p) => p.filter((x) => x.id !== f.id));
      setChecked((p) => p.filter((x) => x !== f.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败');
    }
  }, []);

  const openFile = (f: ClassFile) => window.open(classFileUrl(f.id), '_blank');
  const toggle = (id: string) => setChecked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end md:items-center justify-center" onClick={onClose}>
      <div
        className="bg-background-50 w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl max-h-[85vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-background-200">
          <div className="flex items-center gap-2">
            <i className="ri-folder-3-line text-accent-500"></i>
            <h3 className="text-sm font-semibold text-foreground-900 flex-1 min-w-0 truncate">
              {picking
                ? (reason === 'regen' ? '重新整理摘要:要结合哪些资料?' : '这节课要结合资料整理吗?')
                : '课堂文件库'}
            </h3>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="h-8 px-3 rounded-full bg-accent-500 text-background-50 text-xs font-semibold flex items-center gap-1 disabled:opacity-50 flex-shrink-0"
            >
              <i className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-add-line'}></i>新增
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 flex-shrink-0">
              <i className="ri-close-line text-lg"></i>
            </button>
          </div>
          <p className="text-[11px] text-foreground-400 mt-1.5 leading-relaxed">
            {picking
              ? (reason === 'regen'
                  ? '勾选资料后重新生成:AI 会结合资料校正术语、补全老师让自学的部分;也可以不选直接重新生成。'
                  : '勾选与这节课相关的资料,AI 会结合资料和转写内容整理摘要;也可以直接跳过。')
              : '上传课件、讲义、大纲等资料。AI 会读取其中的文字,整理摘要时用来校正术语、补全知识点。'}
          </p>
          <label className="mt-2 inline-flex items-center gap-2 text-[11px] text-foreground-500">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} className="accent-accent-500 w-3.5 h-3.5" />
            新增时同步到会议文件库(默认不同步)
          </label>
        </div>

        {err && <div className="px-5 py-2 text-xs text-red-600">{err}</div>}

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-10 text-center text-foreground-300"><i className="ri-loader-4-line animate-spin text-2xl"></i></div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-foreground-300 text-sm">
              <i className="ri-inbox-line text-3xl block mb-2"></i>还没有资料,点「新增」上传
            </div>
          ) : (
            <ul className="space-y-1">
              {files.map((f) => {
                const readable = READABLE.includes((f.ext || '').toLowerCase());
                const on = checked.includes(f.id);
                return (
                  <li
                    key={f.id}
                    onClick={() => (picking ? (readable ? toggle(f.id) : undefined) : openFile(f))}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${picking && on ? 'bg-accent-100' : 'active:bg-background-100'}`}
                  >
                    {picking && (
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!readable}
                        onChange={() => toggle(f.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="accent-accent-500 w-4 h-4 flex-shrink-0 disabled:opacity-30"
                      />
                    )}
                    <i className={`${iconFor(f.ext)} text-lg text-accent-500 flex-shrink-0`}></i>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground-900 truncate">{f.name}</p>
                      <p className="text-xs text-foreground-400">
                        {f.size ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : ''}
                        {!readable && <span className="ml-1.5 text-foreground-300">(无文字,AI 读不了)</span>}
                      </p>
                    </div>
                    {picking && (
                      <button onClick={(e) => { e.stopPropagation(); openFile(f); }} className="text-xs text-accent-600 font-medium px-2 flex-shrink-0">
                        打开
                      </button>
                    )}
                    {!picking && (
                      <button
                        onClick={(e) => { e.stopPropagation(); void del(f); }}
                        className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-lg text-foreground-300 active:text-red-500"
                        aria-label="删除"
                      >
                        <i className="ri-delete-bin-line"></i>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {picking && (
          <div className="px-4 py-3 border-t border-background-200 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => onConfirm?.([])}
              className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-xl text-sm font-medium"
            >
              {reason === 'regen' ? '不结合资料' : '跳过'}
            </button>
            <button
              onClick={() => onConfirm?.(checked)}
              disabled={checked.length === 0}
              className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-xl text-sm font-semibold disabled:opacity-40"
            >
              结合 {checked.length} 份资料
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
