export type StoredSession = {
  id: string;
  client: string;
  project: string;
  task: string;
  notes: string;
  startedAt: number;
  endedAt: number;
  duration: number;
  dateKey: string;
};

export type LocalFileHandle = {
  name: string;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  queryPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<LocalFileHandle>;
  }
}

const DB_NAME = 'focusdesk-file-links';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'tracking-database';

function openHandleStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredHandle() {
  const database = await openHandleStore();
  return new Promise<LocalFileHandle | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve((request.result as LocalFileHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function rememberHandle(handle: LocalFileHandle) {
  const database = await openHandleStore();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

export async function chooseDatabaseFile() {
  if (!window.showSaveFilePicker) return null;
  const handle = await window.showSaveFilePicker({
    suggestedName: 'focusdesk-registro.json',
    types: [{ description: 'Base de datos FocusDesk', accept: { 'application/json': ['.json'] } }],
  });
  await rememberHandle(handle);
  return handle;
}

function databaseContents(sessions: StoredSession[]) {
  const byProject = sessions.reduce<Record<string, { client: string; seconds: number; sessions: number }>>((summary, session) => {
    const key = `${session.client} — ${session.project}`;
    const current = summary[key] ?? { client: session.client, seconds: 0, sessions: 0 };
    current.seconds += session.duration;
    current.sessions += 1;
    summary[key] = current;
    return summary;
  }, {});
  return JSON.stringify({
    format: 'FocusDesk Time Tracking Database',
    version: 1,
    updatedAt: new Date().toISOString(),
    totalsByProject: byProject,
    sessions,
  }, null, 2);
}

export async function writeDatabaseFile(handle: LocalFileHandle, sessions: StoredSession[]) {
  let permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('permission-denied');
  const writable = await handle.createWritable();
  await writable.write(databaseContents(sessions));
  await writable.close();
}

export function downloadDatabaseCopy(sessions: StoredSession[]) {
  const url = URL.createObjectURL(new Blob([databaseContents(sessions)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'focusdesk-registro.json';
  anchor.click();
  URL.revokeObjectURL(url);
}
