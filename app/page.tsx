'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, Building2, Check, ChevronDown, Clock3, Download, FileText, Pause, Play, Plus, Square, TimerReset } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { chooseDatabaseFile, downloadDatabaseCopy, getStoredHandle, type LocalFileHandle, writeDatabaseFile } from '@/lib/file-database';

type TimerStatus = 'idle' | 'running' | 'paused';
type Session = { id: string; client: string; project: string; task: string; notes: string; startedAt: number; endedAt: number; duration: number; dateKey: string };
type SavedState = { client: string; project: string; task: string; tasks: string[]; notes: string; status: TimerStatus; accumulated: number; startedAt: number | null; firstStartedAt: number | null; sessions: Session[] };
type WebMcpContext = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown }, options: { signal: AbortSignal }) => void | Promise<void> };

const STORAGE_KEY = 'focusdesk-time-tracker-v1';
const DEFAULT_TASK = 'Eagle Tech Corp Presentation to the C-Suite';
const defaults: SavedState = {
  client: 'Eagle Tech',
  project: "Defensa de Carlos Querales ante Eagle Tech, Juan José y CEO's",
  task: DEFAULT_TASK,
  tasks: [DEFAULT_TASK],
  notes: '',
  status: 'idle',
  accumulated: 0,
  startedAt: null,
  firstStartedAt: null,
  sessions: [],
};

function safeLoad(): SavedState {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    return {
      ...defaults,
      ...parsed,
      tasks: Array.isArray(parsed.tasks) && parsed.tasks.length ? parsed.tasks : defaults.tasks,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      status: ['idle', 'running', 'paused'].includes(parsed.status ?? '') ? (parsed.status as TimerStatus) : 'idle',
    };
  } catch { return defaults; }
}

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60].map((value) => String(value).padStart(2, '0')).join(':');
}

function dateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }

export default function Home() {
  const [state, setState] = useState<SavedState>(defaults);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [newTask, setNewTask] = useState('');
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [message, setMessage] = useState('Listo para comenzar');
  const [fileHandle, setFileHandle] = useState<LocalFileHandle | null>(null);
  const [fileStatus, setFileStatus] = useState<'checking' | 'linked' | 'not-linked' | 'saving' | 'error'>('checking');
  const stateRef = useRef(state);
  const nowRef = useRef(now);

  useEffect(() => {
    const saved = safeLoad();
    queueMicrotask(() => { setState(saved); setNow(Date.now()); setReady(true); });
  }, []);
  useEffect(() => {
    void getStoredHandle()
      .then((handle) => { setFileHandle(handle); setFileStatus(handle ? 'linked' : 'not-linked'); })
      .catch(() => setFileStatus('not-linked'));
  }, []);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { nowRef.current = now; }, [now]);
  useEffect(() => { if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }, [state, ready]);
  useEffect(() => {
    if (state.status !== 'running') return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [state.status]);

  const currentSeconds = state.accumulated + (state.status === 'running' && state.startedAt ? Math.floor((now - state.startedAt) / 1000) : 0);
  const todaySessions = useMemo(() => state.sessions.filter((session) => session.dateKey === dateKey()).sort((a, b) => b.endedAt - a.endedAt), [state.sessions]);
  const todayTotal = todaySessions.reduce((sum, session) => sum + session.duration, 0) + currentSeconds;
  const allTimeTotal = state.sessions.reduce((sum, session) => sum + session.duration, 0) + currentSeconds;
  const todayLabel = new Intl.DateTimeFormat('es-VE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const fieldsValid = state.client.trim() && state.project.trim() && state.task.trim();

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<WebMcpContext['registerTool']>[0]) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); } catch { /* WebMCP is optional. */ }
    };
    register({
      name: 'read_timer_status', title: 'Consultar timer',
      description: 'Consulta el estado y el tiempo transcurrido del timer visible.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => {
        const current = stateRef.current;
        const seconds = current.accumulated + (current.status === 'running' && current.startedAt ? Math.max(0, Math.floor((nowRef.current - current.startedAt) / 1000)) : 0);
        return { status: current.status, elapsed: formatTime(seconds), client: current.client, project: current.project, task: current.task };
      },
    });
    register({
      name: 'start_timer', title: 'Iniciar timer',
      description: 'Inicia o reanuda el timer configurado actualmente.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        const current = stateRef.current;
        if (!current.client.trim() || !current.project.trim() || !current.task.trim()) throw new Error('Faltan cliente, proyecto o tarea.');
        if (current.status === 'running') return { status: 'running', changed: false };
        const timestamp = Date.now();
        const next = { ...current, status: 'running' as const, startedAt: timestamp, firstStartedAt: current.firstStartedAt ?? timestamp };
        stateRef.current = next; setNow(timestamp); setState(next); setMessage(current.status === 'paused' ? 'Timer reanudado' : 'Sesión iniciada');
        return { status: 'running', changed: true };
      },
    });
    register({
      name: 'pause_timer', title: 'Pausar timer',
      description: 'Pausa el timer activo sin perder el tiempo registrado.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        const current = stateRef.current;
        if (current.status !== 'running' || !current.startedAt) throw new Error('El timer no está en curso.');
        const extra = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
        const next = { ...current, status: 'paused' as const, accumulated: current.accumulated + extra, startedAt: null };
        stateRef.current = next; setState(next); setMessage('Sesión en pausa; tu tiempo está guardado');
        return { status: 'paused', elapsed: formatTime(next.accumulated) };
      },
    });
    return () => lifecycle.abort();
  }, []);

  function play() {
    if (!fieldsValid) { setMessage('Completa cliente, proyecto y tarea antes de iniciar.'); return; }
    if (state.status === 'running') return;
    const timestamp = Date.now();
    setNow(timestamp);
    setState((current) => ({ ...current, status: 'running', startedAt: timestamp, firstStartedAt: current.firstStartedAt ?? timestamp }));
    setMessage(state.status === 'paused' ? 'Timer reanudado' : 'Sesión iniciada');
  }

  function pause() {
    if (state.status !== 'running' || !state.startedAt) return;
    const extra = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
    setState((current) => ({ ...current, status: 'paused', accumulated: current.accumulated + extra, startedAt: null }));
    setMessage('Sesión en pausa; tu tiempo está guardado');
  }

  async function persistSessions(sessions: Session[]) {
    setFileStatus('saving');
    try {
      let handle = fileHandle;
      if (!handle && window.showSaveFilePicker) handle = await chooseDatabaseFile();
      if (handle) {
        await writeDatabaseFile(handle, sessions);
        setFileHandle(handle);
        setFileStatus('linked');
        return `Guardado también en ${handle.name}`;
      }
      downloadDatabaseCopy(sessions);
      setFileStatus('not-linked');
      return 'Copia JSON descargada';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setFileStatus('not-linked');
        return 'Guardado en el navegador; archivo externo pendiente';
      }
      setFileStatus('error');
      return 'Guardado en el navegador; no se pudo actualizar el archivo';
    }
  }

  async function stop() {
    if (state.status === 'idle') return;
    const endedAt = Date.now();
    const extra = state.status === 'running' && state.startedAt ? Math.max(0, Math.floor((endedAt - state.startedAt) / 1000)) : 0;
    const duration = state.accumulated + extra;
    if (duration < 1) {
      setState((current) => ({ ...current, status: 'idle', accumulated: 0, startedAt: null, firstStartedAt: null }));
      setMessage('La sesión fue demasiado breve para registrarse');
      return;
    }
    const session: Session = { id: crypto.randomUUID(), client: state.client.trim(), project: state.project.trim(), task: state.task.trim(), notes: state.notes.trim(), startedAt: state.firstStartedAt ?? endedAt - duration * 1000, endedAt, duration, dateKey: dateKey(endedAt) };
    const sessions = [session, ...state.sessions];
    setState((current) => ({ ...current, status: 'idle', accumulated: 0, startedAt: null, firstStartedAt: null, notes: '', sessions }));
    const fileResult = await persistSessions(sessions);
    setMessage(`Sesión guardada: ${formatTime(duration)} · ${fileResult}`);
  }

  function addTask() {
    const cleaned = newTask.trim().slice(0, 120);
    if (!cleaned) { setMessage('Escribe un nombre para la nueva tarea.'); return; }
    const existing = state.tasks.find((task) => task.toLocaleLowerCase() === cleaned.toLocaleLowerCase());
    setState((current) => existing ? { ...current, task: existing } : { ...current, task: cleaned, tasks: [...current.tasks, cleaned] });
    setMessage(existing ? 'Esa tarea ya existía; quedó seleccionada.' : 'Nueva tarea creada y seleccionada');
    setNewTask(''); setTaskDialogOpen(false);
  }

  function exportCsv() {
    if (!state.sessions.length) { setMessage('Aún no hay sesiones terminadas para exportar.'); return; }
    const rows = [['Fecha', 'Cliente', 'Proyecto', 'Tarea', 'Inicio', 'Fin', 'Segundos', 'Duración', 'Notas'], ...state.sessions.map((session) => [session.dateKey, session.client, session.project, session.task, new Date(session.startedAt).toLocaleString('es-VE'), new Date(session.endedAt).toLocaleString('es-VE'), session.duration, formatTime(session.duration), session.notes])];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `registro-tiempo-${dateKey()}.csv`; anchor.click(); URL.revokeObjectURL(url);
    setMessage('Historial exportado');
  }

  if (!ready) return <main className="min-h-screen bg-[#071c26]" />;

  return (
    <main className="min-h-screen bg-[#f3f6f5] text-[#10262f]">
      <header className="border-b border-[#d8e2df] bg-white/90 px-5 py-4 backdrop-blur md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#0a7c68] text-white shadow-sm"><Clock3 className="size-5" aria-hidden="true" /></div>
            <div><p className="text-lg font-bold tracking-[-0.03em]">FocusDesk</p><p className="text-xs font-medium text-[#60757c]">Registro de tiempo local</p></div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={exportCsv} className="border-[#cfdbd8] bg-white"><Download className="size-4" /><span className="hidden sm:inline">Exportar</span></Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-10 lg:py-9">
        <section className="overflow-hidden rounded-[28px] bg-[#071c26] text-white shadow-[0_24px_70px_rgba(7,28,38,0.18)]">
          <div className="grid gap-8 p-6 sm:p-9 xl:grid-cols-[minmax(0,0.82fr)_minmax(340px,1.18fr)] xl:items-center xl:p-11">
            <div className="min-w-0">
              <div className="mb-7 flex items-center gap-2 text-sm font-semibold text-[#9bb4b6]"><span className={`size-2.5 rounded-full ${state.status === 'running' ? 'animate-pulse bg-[#35d8a9]' : state.status === 'paused' ? 'bg-[#f5bd55]' : 'bg-[#668088]'}`} />{state.status === 'running' ? 'En curso' : state.status === 'paused' ? 'En pausa' : 'Sin sesión activa'}</div>
              <p className="font-mono text-[clamp(3rem,10vw,6rem)] font-semibold leading-none tracking-[-0.08em] tabular-nums xl:text-[clamp(3.4rem,4.6vw,4.5rem)]" aria-live="off">{formatTime(currentSeconds)}</p>
              <div className="mt-3 grid grid-cols-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#769096]"><span>Horas</span><span className="text-center">Minutos</span><span className="text-right">Segundos</span></div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button onClick={play} disabled={state.status === 'running'} size="lg" className="h-13 rounded-full bg-[#35d8a9] px-7 font-bold text-[#06261f] hover:bg-[#5be5bd] disabled:opacity-40"><Play className="size-5 fill-current" /> {state.status === 'paused' ? 'Reanudar' : 'Iniciar'}</Button>
                <Button onClick={pause} disabled={state.status !== 'running'} size="lg" variant="outline" className="h-13 rounded-full border-white/20 bg-white/5 px-6 text-white hover:bg-white/10 hover:text-white disabled:opacity-30"><Pause className="size-5 fill-current" /> Pausar</Button>
                <Button onClick={stop} disabled={state.status === 'idle'} size="lg" variant="ghost" className="h-13 rounded-full px-5 text-[#d4e0e1] hover:bg-white/10 hover:text-white disabled:opacity-30"><Square className="size-4 fill-current" /> Finalizar</Button>
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.055] p-5 sm:p-6">
              <div className="grid gap-5">
                <div><Label htmlFor="client" className="mb-2 flex items-center gap-2 text-sm text-[#9bb4b6]"><Building2 className="size-4" /> Cliente</Label><Input id="client" maxLength={80} value={state.client} disabled={state.status !== 'idle'} onChange={(event) => setState((current) => ({ ...current, client: event.target.value }))} className="h-11 border-white/10 bg-[#0d2a35] text-base text-white disabled:opacity-70" /></div>
                <div><Label htmlFor="project" className="mb-2 flex items-center gap-2 text-sm text-[#9bb4b6]"><BriefcaseBusiness className="size-4" /> Proyecto</Label><Input id="project" maxLength={140} value={state.project} disabled={state.status !== 'idle'} onChange={(event) => setState((current) => ({ ...current, project: event.target.value }))} className="h-11 border-white/10 bg-[#0d2a35] text-base text-white disabled:opacity-70" /></div>
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="task" className="flex items-center gap-2 text-sm text-[#9bb4b6]"><Check className="size-4" /> Tarea</Label><Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}><DialogTrigger render={<Button disabled={state.status !== 'idle'} variant="ghost" size="sm" className="h-7 px-2 text-[#54dcb5] hover:bg-white/10 hover:text-[#73e8c7]" />}><Plus className="size-4" /> Nueva</DialogTrigger><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Crear una nueva tarea</DialogTitle></DialogHeader><div className="grid gap-3 pt-2"><Label htmlFor="new-task">Nombre de la tarea</Label><Input id="new-task" maxLength={120} value={newTask} onChange={(event) => setNewTask(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addTask()} placeholder="Ej. Revisar documentos del caso" /><Button onClick={addTask} className="mt-2 bg-[#0a7c68] hover:bg-[#086754]">Crear y seleccionar</Button></div></DialogContent></Dialog></div>
                  <div className="relative"><select id="task" value={state.task} disabled={state.status !== 'idle'} onChange={(event) => setState((current) => ({ ...current, task: event.target.value }))} className="h-11 w-full appearance-none rounded-md border border-white/10 bg-[#0d2a35] px-3 pr-10 text-base text-white outline-none focus:ring-2 focus:ring-[#35d8a9]/50 disabled:opacity-70">{state.tasks.map((task) => <option key={task} value={task}>{task}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4 text-[#8ba3a8]" /></div>
                </div>
                <div><Label htmlFor="notes" className="mb-2 flex items-center gap-2 text-sm text-[#9bb4b6]"><FileText className="size-4" /> Nota de la sesión <span className="font-normal text-[#647f85]">(opcional)</span></Label><Textarea id="notes" maxLength={500} value={state.notes} onChange={(event) => setState((current) => ({ ...current, notes: event.target.value }))} placeholder="¿En qué estás trabajando?" className="min-h-20 resize-none border-white/10 bg-[#0d2a35] text-base text-white placeholder:text-[#607a80]" /></div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-white/10 bg-black/10 px-6 py-4 text-sm sm:px-11"><p aria-live="polite" className="flex items-center gap-2 text-[#b8cacc]"><span className={`size-1.5 rounded-full ${fileStatus === 'error' ? 'bg-[#ef767a]' : 'bg-[#35d8a9]'}`} />{message}</p><p className="hidden text-[#789198] sm:block">{fileStatus === 'linked' ? 'Respaldo: navegador + archivo local' : 'Guardado automático en este navegador'}</p></div>
        </section>

        <aside className="grid content-start gap-5">
          <section className="rounded-[24px] border border-[#dce5e2] bg-white p-6 shadow-[0_14px_40px_rgba(30,61,68,0.07)]">
            <p className="mb-4 text-sm font-semibold capitalize text-[#60757c]">{todayLabel}</p>
            <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-[#eaf7f3] p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#438173]">Hoy</p><p className="mt-2 font-mono text-2xl font-semibold tracking-[-0.06em] text-[#0a6b59]">{formatTime(todayTotal)}</p></div><div className="rounded-2xl bg-[#eef2f4] p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#62767d]">Total</p><p className="mt-2 font-mono text-2xl font-semibold tracking-[-0.06em] text-[#29434c]">{formatTime(allTimeTotal)}</p></div></div>
          </section>
          <section className="rounded-[24px] border border-[#dce5e2] bg-white p-6 shadow-[0_14px_40px_rgba(30,61,68,0.07)]">
            <div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold tracking-[-0.02em]">Sesiones de hoy</h2><p className="text-sm text-[#6d8086]">{todaySessions.length} {todaySessions.length === 1 ? 'registro' : 'registros'} finalizados</p></div><div className="grid size-9 place-items-center rounded-xl bg-[#f0f4f3] text-[#4e6870]"><TimerReset className="size-4" /></div></div>
            {todaySessions.length === 0 ? <div className="rounded-2xl border border-dashed border-[#cddbd7] bg-[#f8faf9] px-4 py-8 text-center"><Clock3 className="mx-auto mb-3 size-5 text-[#8ba09b]" /><p className="text-sm font-semibold text-[#4c6268]">Tu primer registro aparecerá aquí</p><p className="mt-1 text-xs text-[#829398]">Inicia el timer y pulsa Finalizar al terminar.</p></div> : <div className="max-h-[338px] space-y-3 overflow-auto pr-1">{todaySessions.map((session) => <article key={session.id} className="rounded-2xl border border-[#e1e8e6] p-4"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-bold text-[#263e46]">{session.task}</p><p className="mt-1 text-xs text-[#718489]">{new Date(session.startedAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}–{new Date(session.endedAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</p></div><span className="shrink-0 rounded-full bg-[#eaf7f3] px-2.5 py-1 font-mono text-xs font-bold text-[#0a6b59]">{formatTime(session.duration)}</span></div>{session.notes && <p className="mt-3 line-clamp-2 text-xs leading-5 text-[#687b81]">{session.notes}</p>}</article>)}</div>}
          </section>
        </aside>
      </div>
    </main>
  );
}
