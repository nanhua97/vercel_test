type UserRole = 'agent' | 'client';

export type UserRecord = {
  id: number;
  name: string;
  role: UserRole;
};

export type DailyLogRecord = {
  id: number;
  user_id: number;
  date: string;
  breakfast_img?: string | null;
  lunch_img?: string | null;
  dinner_img?: string | null;
  sleep_start?: string | null;
  sleep_end?: string | null;
  water_cups?: number | null;
  coffee?: number | boolean;
  notes?: string | null;
};

export type ReportRecord = {
  id: number;
  client_name: string;
  client_phone: string;
  diagnosis: string;
  content: string;
  created_at: string;
};

const DEFAULT_USERS: UserRecord[] = [
  { id: 1, name: 'CS Agent Amy', role: 'agent' },
  { id: 2, name: 'Client John Doe', role: 'client' },
];

const KEYS = {
  users: 'tcm:users',
  reports: 'tcm:reports',
  reportSeq: 'tcm:counter:report',
  logSeq: 'tcm:counter:log',
};

const kvUrl = process.env.KV_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN;
const hasKv = Boolean(kvUrl && kvToken);

const memoryStore = {
  users: [...DEFAULT_USERS],
  logsByUser: new Map<number, DailyLogRecord[]>(),
  reports: [] as ReportRecord[],
  reportSeq: 0,
  logSeq: 0,
};

function normalizeUserId(userId: number | string): number {
  const parsed = Number(userId);
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid user_id.');
  }
  return parsed;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function kvCommand<T = any>(...command: Array<string | number | boolean>): Promise<T> {
  if (!hasKv) {
    throw new Error('KV is not configured.');
  }

  const res = await fetch(kvUrl!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kvToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KV request failed (${res.status}): ${text}`);
  }

  const payload = (await res.json()) as { result: T; error?: string };
  if (payload.error) {
    throw new Error(`KV error: ${payload.error}`);
  }

  return payload.result;
}

async function kvGetJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await kvCommand<string | null>('GET', key);
  if (!raw) {
    return fallback;
  }
  return safeJsonParse<T>(raw, fallback);
}

async function kvSetJson(key: string, value: unknown): Promise<void> {
  await kvCommand('SET', key, JSON.stringify(value));
}

async function ensureSeedData(): Promise<void> {
  if (!hasKv) {
    return;
  }

  const existing = await kvCommand<string | null>('GET', KEYS.users);
  if (!existing) {
    await kvSetJson(KEYS.users, DEFAULT_USERS);
  }
}

export async function getClients(): Promise<UserRecord[]> {
  if (!hasKv) {
    return memoryStore.users.filter((u) => u.role === 'client');
  }

  await ensureSeedData();
  const users = await kvGetJson<UserRecord[]>(KEYS.users, DEFAULT_USERS);
  return users.filter((u) => u.role === 'client');
}

export async function getLogsForUser(userId: number | string): Promise<DailyLogRecord[]> {
  const normalizedUserId = normalizeUserId(userId);

  if (!hasKv) {
    const logs = memoryStore.logsByUser.get(normalizedUserId) || [];
    return [...logs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }

  const rows = await kvCommand<string[]>('LRANGE', `tcm:logs:${normalizedUserId}`, 0, -1);
  const logs = (rows || []).map((raw) => safeJsonParse<DailyLogRecord>(raw, {} as DailyLogRecord));
  return logs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

export async function saveLog(input: Omit<DailyLogRecord, 'id'>): Promise<{ success: true }> {
  const normalizedUserId = normalizeUserId(input.user_id);

  const entry: DailyLogRecord = {
    ...input,
    id: 0,
    user_id: normalizedUserId,
    coffee: input.coffee ? 1 : 0,
  };

  if (!hasKv) {
    entry.id = ++memoryStore.logSeq;
    const current = memoryStore.logsByUser.get(normalizedUserId) || [];
    current.unshift(entry);
    memoryStore.logsByUser.set(normalizedUserId, current);
    return { success: true };
  }

  entry.id = await kvCommand<number>('INCR', KEYS.logSeq);
  await kvCommand('LPUSH', `tcm:logs:${normalizedUserId}`, JSON.stringify(entry));
  return { success: true };
}

export async function getReports(): Promise<ReportRecord[]> {
  if (!hasKv) {
    return [...memoryStore.reports].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const rows = await kvCommand<string[]>('LRANGE', KEYS.reports, 0, -1);
  const reports = (rows || []).map((raw) => safeJsonParse<ReportRecord>(raw, {} as ReportRecord));
  return reports.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export async function saveReport(input: {
  client_name: string;
  client_phone: string;
  diagnosis: string;
  content: unknown;
}): Promise<{ success: true; id: number }> {
  const record: ReportRecord = {
    id: 0,
    client_name: input.client_name || 'Anonymous',
    client_phone: input.client_phone || 'N/A',
    diagnosis: input.diagnosis || 'N/A',
    content: typeof input.content === 'string' ? input.content : JSON.stringify(input.content || {}),
    created_at: new Date().toISOString(),
  };

  if (!hasKv) {
    record.id = ++memoryStore.reportSeq;
    memoryStore.reports.unshift(record);
    return { success: true, id: record.id };
  }

  record.id = await kvCommand<number>('INCR', KEYS.reportSeq);
  await kvCommand('LPUSH', KEYS.reports, JSON.stringify(record));
  return { success: true, id: record.id };
}

export function isPersistentStoreEnabled(): boolean {
  return hasKv;
}
