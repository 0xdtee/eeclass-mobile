/**
 * Meeting-history storage for the meeting translator (same format and endpoints as the desktop eeclass,
 * so a meeting recorded on the phone shows up on the computer and vice versa).
 *
 * Always kept in this device's localStorage; when signed in it is also saved under the account on the
 * server, and any local-only meetings are uploaded into the account on load.
 */
import { apiFetch } from '@/lib/api';

export interface MeetingTurn {
  id: number;
  original: string;
  src: string;
  translations?: Record<string, string>;   // lang code -> translated text
  // Legacy pre-multilingual fields, still read when showing old saved history:
  translation?: string;
  tgt?: string;
}

export interface MeetingMinutes {
  title: string;
  summary: string;
  points: string[];
  decisions: string[];
  todos: { task: string; owner?: string }[];
}

export interface MeetingSession {
  id: string;
  created: number;          // epoch ms
  title: string;
  turns: MeetingTurn[];
  minutes: MeetingMinutes | null;
}

const LS_KEY = 'meeting_history';
const CAP = 300;

export function loadLocal(): MeetingSession[] {
  try {
    const a = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function writeLocal(sessions: MeetingSession[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(0, CAP)));
  } catch {
    /* ignore quota errors */
  }
}

function mergeById(...lists: MeetingSession[][]): MeetingSession[] {
  const byId = new Map<string, MeetingSession>();
  for (const list of lists) for (const s of list) if (s && s.id && !byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => (b.created || 0) - (a.created || 0));
}

/** Insert/replace one session (earlier lists win on id), persist, return the new list. */
export function upsertLocal(session: MeetingSession): MeetingSession[] {
  const merged = mergeById([session], loadLocal());
  writeLocal(merged);
  return merged;
}

export function removeLocal(id: string): MeetingSession[] {
  const merged = loadLocal().filter((s) => s.id !== id);
  writeLocal(merged);
  return merged;
}

export function fetchServer(): Promise<MeetingSession[]> {
  return apiFetch<{ sessions: MeetingSession[] }>('/api/meeting/history').then((j) => j.sessions || []);
}

export function saveServer(sessions: MeetingSession[]): Promise<MeetingSession[]> {
  return apiFetch<{ sessions: MeetingSession[] }>('/api/meeting/history', {
    method: 'POST',
    body: JSON.stringify({ sessions }),
  }).then((j) => j.sessions || []);
}

export function deleteServer(id: string): Promise<void> {
  return apiFetch('/api/meeting/history/' + encodeURIComponent(id), { method: 'DELETE' }).then(() => undefined);
}

/** Pull the account's history and inherit any local-only meetings into it. */
export async function syncOnLoad(): Promise<MeetingSession[]> {
  const local = loadLocal();
  const server = await fetchServer();
  const serverIds = new Set(server.map((s) => s.id));
  const localOnly = local.filter((s) => !serverIds.has(s.id));
  return localOnly.length ? await saveServer(localOnly) : server;
}
