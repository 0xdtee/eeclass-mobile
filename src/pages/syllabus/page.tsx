import { useState, useEffect, useMemo } from 'react';
import BackButton from '@/components/feature/BackButton';
import { apiFetch, getServerUrl, getToken } from '@/lib/api';

interface CItem { course: string; title: string; source_page: string; kind: 'pdf' | 'page' }
interface School { id: string; name: string; items: CItem[] }
interface Syllabus {
  course: string;
  source?: string;
  overview?: string;
  credits_hint?: string;
  textbooks?: string[];
  chapters?: { title: string; topics?: string[]; exam_points?: string[] }[];
  key_formulas?: string[];
}

// Group a school's courses by subject (same buckets as the web reference page).
const CATS: { name: string; icon: string; kws: string[] }[] = [
  { name: '数学', icon: 'ri-functions', kws: ['数学', '代数', '概率', '统计', '离散'] },
  { name: '物理 / 力学', icon: 'ri-magic-line', kws: ['物理', '力学'] },
  { name: '计算机', icon: 'ri-code-s-slash-line', kws: ['计算机', '程序', '数据结构', 'C语言', '算法'] },
  { name: '化学', icon: 'ri-flask-line', kws: ['化学'] },
  { name: '语言', icon: 'ri-translate-2', kws: ['英语', '语文', '外语'] },
  { name: '思政 / 通识', icon: 'ri-government-line', kws: ['马克思', '毛泽东', '习近平', '思想', '历史', '近现代', '形势', '军事', '心理', '法治', '道德'] },
  { name: '工程 / 其他', icon: 'ri-tools-line', kws: [] },
];
function catOf(course: string): string {
  for (const c of CATS) if (c.kws.some((k) => course.includes(k))) return c.name;
  return '工程 / 其他';
}

export default function SyllabusPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [schoolId, setSchoolId] = useState('');

  const [openCourse, setOpenCourse] = useState<string | null>(null);
  const [detail, setDetail] = useState<Syllabus | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    apiFetch<{ schools: School[] }>('/api/syllabus/schools')
      .then((d) => {
        if (!alive) return;
        const list = d.schools || [];
        setSchools(list);
        if (list.length) setSchoolId(list[0].id);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '加载失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const school = useMemo(() => schools.find((s) => s.id === schoolId) || null, [schools, schoolId]);
  const grouped = useMemo(() => {
    const g = new Map<string, CItem[]>();
    CATS.forEach((c) => g.set(c.name, []));
    (school?.items || []).forEach((it) => g.get(catOf(it.course))!.push(it));
    return CATS.map((c) => ({ ...c, list: g.get(c.name) || [] })).filter((c) => c.list.length);
  }, [school]);

  // Switch school: collapse any open course.
  useEffect(() => { setOpenCourse(null); setDetail(null); }, [schoolId]);

  const open = async (course: string) => {
    if (openCourse === course) { setOpenCourse(null); setDetail(null); return; }
    setOpenCourse(course);
    setDetail(null);
    setDetailLoading(true);
    try {
      // parsed outline (may not exist for every catalog course — then we just show 「查看原文」)
      const d = await apiFetch<Syllabus>(`/api/syllabus/${encodeURIComponent(course)}`);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // Link to the original official document for a catalog item.
  const origUrl = (it: CItem): string => {
    const base = getServerUrl();
    const tok = encodeURIComponent(getToken());
    if (it.kind === 'page') {
      return it.source_page || `${base}/api/syllabus/page/${encodeURIComponent(schoolId)}/${encodeURIComponent(it.course)}?token=${tok}`;
    }
    return `${base}/api/syllabus/official/${encodeURIComponent(schoolId)}/${encodeURIComponent(it.course)}?token=${tok}`;
  };
  // Search the textbook on WeRead (微信读书) — a licensed domestic platform, direct-connect (no proxy). Query the title inside 《》 when present.
  const bookUrl = (t: string): string => {
    const q = (t.match(/《([^》]+)》/)?.[1]) || t;
    return `https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(q)}`;
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-3">
        <BackButton />
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">参考资料</h1>
        <p className="text-xs md:text-sm text-foreground-400 mt-1">按学校查看官方课程教学大纲</p>
      </div>

      {/* School selector */}
      {schools.length > 0 && (
        <div className="border-y border-background-200 bg-background-100/60">
          <div className="px-5 md:px-8 flex items-center gap-2 overflow-x-auto py-2.5">
            <span className="text-xs text-foreground-400 flex-shrink-0 mr-1"><i className="ri-school-line mr-1"></i>学校</span>
            {schools.map((s) => (
              <button
                key={s.id}
                onClick={() => setSchoolId(s.id)}
                className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap cursor-pointer transition-colors flex-shrink-0 ${schoolId === s.id ? 'bg-accent-500 text-background-50 font-semibold' : 'bg-background-50 text-foreground-600 border border-background-200'}`}
              >
                {s.name}<span className={`ml-1.5 text-[10px] ${schoolId === s.id ? 'text-background-50/70' : 'text-foreground-400'}`}>{s.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 md:px-8 py-4 pb-8 max-w-5xl">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <i className="ri-loader-4-line animate-spin text-accent-500 text-2xl"></i>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-12 h-12 flex items-center justify-center bg-red-50 rounded-xl mb-2">
              <i className="ri-error-warning-line text-red-400 text-xl"></i>
            </div>
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {!loading && !error && schools.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-secondary-100 rounded-2xl mb-4">
              <i className="ri-book-open-line text-secondary-600 text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-400">官方大纲整理中,请稍后再查看。</p>
          </div>
        )}

        {/* This school's courses, grouped by subject */}
        {!loading && !error && grouped.map((cat) => (
          <div key={cat.name} className="mb-5">
            <p className="text-xs font-semibold text-foreground-400 mb-1.5 flex items-center gap-1.5"><i className={cat.icon}></i>{cat.name}</p>
            <div className="space-y-2">
              {cat.list.map((it) => (
                <div key={it.course} className="bg-background-50 rounded-xl border border-background-200 overflow-hidden">
                  <button
                    onClick={() => open(it.course)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-background-100 transition-colors"
                  >
                    <div className="w-8 h-8 flex items-center justify-center bg-secondary-100 rounded-lg flex-shrink-0">
                      <i className="ri-book-read-line text-secondary-600"></i>
                    </div>
                    <span className="flex-1 text-sm font-medium text-foreground-800 truncate">{it.course}</span>
                    {it.kind === 'page' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 flex-shrink-0">网页</span>
                    )}
                    <i className={`ri-arrow-down-s-line text-foreground-300 transition-transform ${openCourse === it.course ? 'rotate-180' : ''}`}></i>
                  </button>

                  {openCourse === it.course && (
                    <div className="px-4 pb-4 border-t border-background-200 pt-3 space-y-3">
                      {/* always available: the original official document */}
                      <a
                        href={origUrl(it)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-2 bg-secondary-500 text-white rounded-lg text-xs font-semibold active:opacity-80"
                      >
                        <i className="ri-file-text-line"></i>{it.kind === 'page' ? '查看原文(官方网页)' : '查看原文(官方大纲 PDF)'}
                        <i className="ri-external-link-line opacity-80"></i>
                      </a>

                      {detailLoading && (
                        <div className="flex items-center gap-2 text-xs text-foreground-400 py-1">
                          <i className="ri-loader-4-line animate-spin"></i> 加载解析内容…
                        </div>
                      )}

                      {!detailLoading && detail && (
                        <>
                          {detail.overview && (
                            <p className="text-sm text-foreground-700 leading-relaxed whitespace-pre-wrap">{detail.overview}</p>
                          )}
                          {detail.credits_hint && (
                            <p className="text-xs text-foreground-400"><i className="ri-award-line mr-1"></i>{detail.credits_hint}</p>
                          )}
                          {detail.textbooks && detail.textbooks.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-foreground-600 mb-1">教材(点击微信读书查阅)</p>
                              <ul className="space-y-0.5">
                                {detail.textbooks.map((t, i) => (
                                  <li key={i} className="text-xs flex gap-1.5">
                                    <i className="ri-book-line text-secondary-500 mt-0.5"></i>
                                    <a href={bookUrl(t)} target="_blank" rel="noreferrer" className="text-secondary-600 underline decoration-dotted underline-offset-2 active:opacity-70">{t}</a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {detail.chapters && detail.chapters.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-foreground-600 mb-1.5">章节与考点</p>
                              <div className="space-y-2">
                                {detail.chapters.map((ch, i) => (
                                  <div key={i} className="bg-background-100 rounded-lg p-3">
                                    <p className="text-sm font-medium text-foreground-800">{i + 1}. {ch.title}</p>
                                    {ch.topics && ch.topics.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {ch.topics.map((t, j) => (
                                          <span key={j} className="text-[11px] px-1.5 py-0.5 rounded bg-background-50 text-foreground-500 border border-background-200">{t}</span>
                                        ))}
                                      </div>
                                    )}
                                    {ch.exam_points && ch.exam_points.length > 0 && (
                                      <ul className="mt-1.5 space-y-0.5">
                                        {ch.exam_points.map((p, j) => (
                                          <li key={j} className="text-[11px] text-accent-700 flex gap-1">
                                            <i className="ri-focus-3-line mt-0.5"></i><span>{p}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {detail.key_formulas && detail.key_formulas.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-foreground-600 mb-1">重要公式</p>
                              <ul className="space-y-0.5">
                                {detail.key_formulas.map((f, i) => (
                                  <li key={i} className="text-xs text-foreground-700 font-mono bg-background-100 rounded px-2 py-1">{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
