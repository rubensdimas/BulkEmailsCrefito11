import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  apiErrorMessage,
  getMailgridReportSettings,
  listMailgridReportRuns,
  runMailgridReportNow,
  startMailgridBackfill,
  updateMailgridReportSettings,
  MAILGRID_REPORT_INTERVALS,
  type MailgridReportMode,
  type MailgridReportRun,
  type MailgridReportSettings,
  type MailgridTokenState,
} from '../../services/api';
import { formatSaoPaulo } from '../../utils/saoPauloTime';

const TOKEN_LABEL: Record<MailgridTokenState, { text: string; className: string }> = {
  configured: { text: 'Configurado', className: 'bg-green-50 text-green-800 ring-green-600/20' },
  not_configured: { text: 'Não configurado', className: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
  auth_failed: { text: 'Falha de autenticação na última execução', className: 'bg-red-50 text-red-800 ring-red-600/20' },
};
const RUN_TYPE: Record<MailgridReportRun['type'], string> = { scheduled: 'Agendada', manual: 'Manual', backfill: 'Carga inicial' };
const RUN_STATUS: Record<MailgridReportRun['status'], { text: string; className: string }> = {
  running: { text: 'Em andamento', className: 'bg-blue-50 text-blue-800 ring-blue-600/20' },
  success: { text: 'Sucesso', className: 'bg-green-50 text-green-800 ring-green-600/20' },
  failed: { text: 'Falhou', className: 'bg-red-50 text-red-800 ring-red-600/20' },
};
// Each mode suggests its own lookback: a daily run covers two days, a frequent one a couple of hours.
const DEFAULT_WINDOW: Record<MailgridReportMode, number> = { daily: 48, interval: 2 };
const BACKFILL_CONFIRMATION = 'Isso vai buscar os últimos 90 dias na API Mailgrid em 13 blocos. Continuar?';

const badge = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';
const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500';
const primaryButton = 'inline-flex min-h-[40px] items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const duration = (run: MailgridReportRun): string => {
  if (!run.finished_at) return '—';
  const seconds = Math.max(0, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
};

type Feedback = { type: 'success' | 'error'; text: string } | null;

export default function SettingsMailgridReportsPage() {
  const [settings, setSettings] = useState<MailgridReportSettings>({ enabled: true, mode: 'daily', time: '03:00', intervalMinutes: 5, windowHours: 48 });
  const [hideEmptyScheduled, setHideEmptyScheduled] = useState(true);
  const [tokenState, setTokenState] = useState<MailgridTokenState | null>(null);
  const [runs, setRuns] = useState<MailgridReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'run' | 'backfill' | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadRuns = useCallback(async () => {
    try { setRuns(await listMailgridReportRuns(hideEmptyScheduled)); } catch { /* history is secondary; the form stays usable */ }
  }, [hideEmptyScheduled]);

  useEffect(() => {
    let active = true;
    getMailgridReportSettings()
      .then(({ tokenState: state, ...value }) => { if (active) { setSettings(value); setTokenState(state); } })
      .catch((error) => { if (active) setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível carregar a configuração.') }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const changeMode = (mode: MailgridReportMode) => setSettings({ ...settings, mode, windowHours: DEFAULT_WINDOW[mode] });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy('save'); setFeedback(null);
    try {
      const { tokenState: state, ...value } = await updateMailgridReportSettings(settings);
      setSettings(value); setTokenState(state);
      setFeedback({ type: 'success', text: 'Configuração salva.' });
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível salvar a configuração.') });
    } finally { setBusy(null); }
  };

  const runNow = async () => {
    setBusy('run'); setFeedback(null);
    try {
      await runMailgridReportNow();
      setFeedback({ type: 'success', text: 'Execução enviada para a fila. Atualize o histórico em alguns segundos.' });
      await loadRuns();
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível iniciar a execução.') });
    } finally { setBusy(null); }
  };

  const backfill = async () => {
    if (!window.confirm(BACKFILL_CONFIRMATION)) return;
    setBusy('backfill'); setFeedback(null);
    try {
      const { blocks } = await startMailgridBackfill();
      setFeedback({ type: 'success', text: `Carga inicial enfileirada em ${blocks} blocos.` });
      await loadRuns();
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível iniciar a carga inicial.') });
    } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex justify-center py-12" role="status" aria-label="Carregando"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Relatórios Mailgrid</h2>
        <p className="mt-1 text-sm text-gray-600">Coleta diária do relatório de envios da API Mailgrid, guardada além dos 90 dias de retenção da API.</p>
      </div>

      {feedback && (
        <div role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 text-sm ${feedback.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {feedback.text}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm" aria-labelledby="mailgrid-token-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="mailgrid-token-title" className="text-base font-semibold text-gray-900">Token da API</h3>
            <p className="mt-1 text-sm text-gray-600">Lido da variável de ambiente <code className="rounded bg-gray-100 px-1">TOKEN_AUTH_MAILGRID</code>. O valor nunca é exibido.</p>
          </div>
          {tokenState && <span className={`${badge} ${TOKEN_LABEL[tokenState].className}`}>{TOKEN_LABEL[tokenState].text}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm" aria-labelledby="mailgrid-schedule-title">
        <h3 id="mailgrid-schedule-title" className="text-base font-semibold text-gray-900">Rotina automática</h3>
        <form onSubmit={save} className="mt-4 space-y-4">
          <label className="flex items-center gap-3 text-sm font-medium text-gray-700">
            <input type="checkbox" checked={settings.enabled}
              onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
              className="h-5 w-5 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            Rotina ativa
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="mailgrid-mode" className="mb-1 block text-sm font-medium text-gray-700">Frequência</label>
              <select id="mailgrid-mode" value={settings.mode} onChange={(event) => changeMode(event.target.value as MailgridReportMode)} className={inputClass}>
                <option value="daily">Diária</option>
                <option value="interval">A cada N minutos</option>
              </select>
            </div>
            {settings.mode === 'daily' ? (
              <div>
                <label htmlFor="mailgrid-time" className="mb-1 block text-sm font-medium text-gray-700">Horário diário</label>
                <input id="mailgrid-time" type="time" required value={settings.time}
                  onChange={(event) => setSettings({ ...settings, time: event.target.value })} className={inputClass} aria-describedby="mailgrid-time-help" />
                <p id="mailgrid-time-help" className="mt-1 text-xs text-gray-500">Horário de Brasília.</p>
              </div>
            ) : (
              <div>
                <label htmlFor="mailgrid-interval" className="mb-1 block text-sm font-medium text-gray-700">Intervalo</label>
                <select id="mailgrid-interval" value={settings.intervalMinutes} aria-describedby="mailgrid-interval-help"
                  onChange={(event) => setSettings({ ...settings, intervalMinutes: Number(event.target.value) })} className={inputClass}>
                  {MAILGRID_REPORT_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
                </select>
                <p id="mailgrid-interval-help" className="mt-1 text-xs text-gray-500">Execuções em horários fixos (:00, :05…).</p>
              </div>
            )}
            <div>
              <label htmlFor="mailgrid-window" className="mb-1 block text-sm font-medium text-gray-700">Janela de busca (horas)</label>
              <input id="mailgrid-window" type="number" min={1} max={168} step={1} required value={settings.windowHours}
                onChange={(event) => setSettings({ ...settings, windowHours: Number(event.target.value) })} className={inputClass} aria-describedby="mailgrid-window-help" />
              <p id="mailgrid-window-help" className="mt-1 text-xs text-gray-500">De 1 a 168. A sobreposição entre dias não duplica registros.</p>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className={primaryButton} disabled={busy !== null}>{busy === 'save' ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm" aria-labelledby="mailgrid-actions-title">
        <h3 id="mailgrid-actions-title" className="text-base font-semibold text-gray-900">Execuções</h3>
        <p className="mt-1 text-sm text-gray-600">Execuções agendadas com sucesso e mais antigas que 30 dias são apagadas automaticamente. "Executar agora" busca a janela configurada. A carga inicial busca os últimos 90 dias, uma única vez por vez.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={secondaryButton} onClick={runNow} disabled={busy !== null}>{busy === 'run' ? 'Enviando…' : 'Executar agora'}</button>
          <button type="button" className={secondaryButton} onClick={backfill} disabled={busy !== null}>{busy === 'backfill' ? 'Enviando…' : 'Carga inicial (90 dias)'}</button>
          <button type="button" className={secondaryButton} onClick={() => void loadRuns()} disabled={busy !== null}>Atualizar histórico</button>
        </div>

        <label className="mt-6 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={hideEmptyScheduled} onChange={(event) => setHideEmptyScheduled(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          Ocultar execuções agendadas sem novidade
        </label>
        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <caption className="sr-only">Últimas 50 execuções</caption>
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">Início</th>
                <th scope="col" className="px-4 py-3">Tipo</th>
                <th scope="col" className="px-4 py-3">Janela</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Buscados</th>
                <th scope="col" className="px-4 py-3 text-right">Inseridos</th>
                <th scope="col" className="px-4 py-3 text-right">Ignorados</th>
                <th scope="col" className="px-4 py-3">Duração</th>
                <th scope="col" className="px-4 py-3">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {runs.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Nenhuma execução registrada ainda.</td></tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-700">{formatSaoPaulo(run.started_at)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{RUN_TYPE[run.type]}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">{formatSaoPaulo(run.window_start)} – {formatSaoPaulo(run.window_end)}</td>
                  <td className="px-4 py-3"><span className={`${badge} ${RUN_STATUS[run.status].className}`}>{RUN_STATUS[run.status].text}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{run.fetched}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{run.inserted}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{run.skipped}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">{duration(run)}</td>
                  <td className="max-w-xs px-4 py-3 text-gray-600 [overflow-wrap:anywhere]">{run.error_message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
