import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api';
import { useSessions, type SessionRecord } from '@/hooks/useRecords';

interface ScheduleEvent {
  name: string;
  date: string;   // YYYY-MM-DD
  start: string;  // HH:MM
  end: string;
  location: string;
  room: string;
  teacher?: string;   // read off the timetable
  credits?: string;   // e.g. "5.0"
}

// 高数第1课 / 高数(2) -> 高数
const baseName = (t: string) =>
  (t || '').replace(/\s*第\s*\d+\s*[课讲节]\s*$/, '').replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '').trim();

/** The recording of this lesson, if one exists: same day, and the full title or else the course name matches
 *  (a course meeting twice in one day must open the right one, so the exact title wins). */
function findRecording(ev: ScheduleEvent, sessions: SessionRecord[]): SessionRecord | undefined {
  const sameDay = sessions.filter((r) => r.date === ev.date);
  const base = baseName(ev.name);
  return sameDay.find((r) => r.title === ev.name) || sameDay.find((r) => baseName(r.title) === base);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

export default function SchedulePage() {
  const navigate = useNavigate();
  const { sessions, refresh } = useSessions();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch<{ events: ScheduleEvent[] }>('/api/schedule')
      .then((d) => { if (alive) setEvents(d.events || []); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : '加载失败'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Group by date and sort
  const grouped = useMemo(() => {
    const byDate = new Map<string, ScheduleEvent[]>();
    for (const ev of events) {
      const arr = byDate.get(ev.date) || [];
      arr.push(ev);
      byDate.set(ev.date, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, evs]) => ({ date, evs: evs.sort((a, b) => a.start.localeCompare(b.start)) }));
  }, [events]);

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Decide on a freshly fetched list: a class recorded meanwhile on another device would otherwise look
  // unrecorded here, and tapping it would start a second recording of the same lesson.
  const openLesson = async (ev: ScheduleEvent) => {
    const fresh = await refresh();
    const rec = findRecording(ev, fresh.length ? fresh : sessions);
    if (rec) navigate(`/session/${encodeURIComponent(rec.sid)}`);
    else navigate(`/record?title=${encodeURIComponent(ev.name)}&for_date=${encodeURIComponent(ev.date)}`);
  };

  return (
    <div className="min-h-full bg-background-50">
      {/* Header */}
      <div className="px-5 md:px-8 pt-6 md:pt-8 pb-4">
        <h1 className="text-lg md:text-2xl font-bold text-foreground-900">课表</h1>
        <p className="text-xs md:text-sm text-foreground-400 mt-1">已导入的课程安排</p>
      </div>

      <div className="px-5 md:px-8 pb-8 max-w-5xl">
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

        {!loading && !error && grouped.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <div className="w-16 h-16 flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
              <i className="ri-calendar-line text-accent-600 text-2xl"></i>
            </div>
            <p className="text-sm text-foreground-400 max-w-xs leading-relaxed">
              还没有课表。请在网页版导入课表截图或教务系统课表后，这里即可查看。
            </p>
          </div>
        )}

        <div className="space-y-5">
          {grouped.map(({ date, evs }) => (
            <div key={date}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${date === today ? 'text-accent-600' : 'text-foreground-800'}`}>
                  {date}
                </span>
                <span className="text-xs text-foreground-400">{weekdayOf(date)}</span>
                {date === today && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">今天</span>
                )}
              </div>
              <div className="space-y-2">
                {evs.map((ev, i) => (
                  <div key={i} className="bg-background-50 rounded-xl p-4 border border-background-200 flex items-center gap-3">
                    <div className="text-center flex-shrink-0 w-14">
                      <p className="text-sm font-semibold text-foreground-800 font-mono">{ev.start}</p>
                      <p className="text-[11px] text-foreground-400 font-mono">{ev.end}</p>
                    </div>
                    <div className="w-px self-stretch bg-background-200"></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground-800 truncate">
                        {ev.name}
                        {ev.credits && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 align-middle">{ev.credits} 学分</span>}
                      </p>
                      {(ev.location || ev.room) && (
                        <p className="text-xs text-foreground-400 mt-0.5 flex items-center gap-1 truncate">
                          <i className="ri-map-pin-line"></i>
                          {[ev.location, ev.room].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {ev.teacher && (
                        <p className="text-xs text-foreground-400 mt-0.5 flex items-center gap-1 truncate">
                          <i className="ri-user-line"></i>{ev.teacher}
                        </p>
                      )}
                    </div>
                    {(() => {
                      const rec = findRecording(ev, sessions);
                      if (rec) {
                        return (
                          <button onClick={() => void openLesson(ev)} className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-background-100 text-foreground-600 rounded-full text-xs font-medium">
                            <i className="ri-file-text-line"></i>查看
                          </button>
                        );
                      }
                      if (date < today) return null;
                      return (
                        <button onClick={() => void openLesson(ev)} className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 bg-accent-500 text-background-50 rounded-full text-xs font-semibold">
                          <i className="ri-mic-line"></i>录这节
                        </button>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
