import { useEffect, useState } from 'react';
import { AppHeader } from '../components/Layout/AppHeader';
import { ReportDetail } from '../components/Reports/ReportDetail';
import { ReportFilters, type ReportFilterForm } from '../components/Reports/ReportFilters';
import {
  apiErrorMessage,
  getReportSenderHosts,
  reportExportUrl,
  searchReports,
  type MailgridReportEntry,
  type ReportFilters as ApiReportFilters,
  type ReportPage,
} from '../services/api';
import { formatSaoPaulo, fromSaoPauloInput, toSaoPauloInput } from '../utils/saoPauloTime';

const CSV_MAX_ROWS = 100_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const initialFilters = (): ReportFilterForm => {
  const now = new Date();
  return {
    from: toSaoPauloInput(new Date(now.getTime() - 7 * DAY_MS)), to: toSaoPauloInput(now),
    recipient: '', sender: '', subject: '', deliveryHost: '', msgid: '', senderHost: '', tipoStatus: [],
  };
};

const toApiFilters = (form: ReportFilterForm): ApiReportFilters => ({
  from: fromSaoPauloInput(form.from), to: fromSaoPauloInput(form.to, true),
  recipient: form.recipient.trim(), sender: form.sender.trim(), subject: form.subject.trim(),
  deliveryHost: form.deliveryHost.trim(), msgid: form.msgid.trim(), senderHost: form.senderHost, tipoStatus: form.tipoStatus,
});

const RESULT_STYLE: Record<string, string> = {
  Aceita: 'bg-green-50 text-green-800 ring-green-600/20',
  'Soft Bounce': 'bg-amber-50 text-amber-800 ring-amber-600/20',
  'Hard Bounce': 'bg-red-50 text-red-800 ring-red-600/20',
};

export default function ReportsPage() {
  const [initial] = useState(initialFilters);
  const [filters, setFilters] = useState<ApiReportFilters>(() => toApiFilters(initial));
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ReportPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [senderHosts, setSenderHosts] = useState<string[]>([]);
  const [selected, setSelected] = useState<MailgridReportEntry | null>(null);

  useEffect(() => { getReportSenderHosts().then(setSenderHosts).catch(() => undefined); }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    searchReports(filters, page)
      .then((value) => { if (active) setResult(value); })
      .catch((reason) => { if (active) setError(apiErrorMessage(reason, 'Não foi possível consultar o relatório.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, page]);

  const apply = (form: ReportFilterForm) => { setFilters(toApiFilters(form)); setPage(1); };
  const reset = (): ReportFilterForm => { const defaults = initialFilters(); apply(defaults); return defaults; };
  const pagination = result?.pagination;
  const tooManyRows = (pagination?.total ?? 0) > CSV_MAX_ROWS;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Relatórios</h1>
          <p className="mt-1 text-sm text-gray-600">Envios registrados pelo servidor SMTP Mailgrid, inclusive os feitos por outros sistemas. Horários de Brasília.</p>
        </div>

        <ReportFilters initial={initial} senderHosts={senderHosts} onApply={apply} onReset={reset} busy={loading} />

        <section aria-labelledby="report-results-title" className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-6">
            <h2 id="report-results-title" className="text-base font-semibold text-gray-900">
              Resultados {pagination && <span className="font-normal tabular-nums text-gray-500">({pagination.total.toLocaleString('pt-BR')})</span>}
            </h2>
            {tooManyRows
              ? <p className="text-sm text-amber-800">A exportação é limitada a 100.000 linhas. Refine os filtros.</p>
              : <a href={reportExportUrl(filters)} download
                className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>
                Exportar CSV
              </a>}
          </div>

          {error && <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

          <div className="overflow-x-auto" aria-busy={loading}>
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-4 py-3">Data/hora</th>
                  <th scope="col" className="px-4 py-3">Remetente</th>
                  <th scope="col" className="px-4 py-3">Destinatário</th>
                  <th scope="col" className="px-4 py-3">Assunto</th>
                  <th scope="col" className="px-4 py-3">Resultado</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3">Servidor de origem</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-gray-100 ${loading ? 'opacity-60' : ''}`}>
                {!loading && result?.data.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">Nenhum envio encontrado para os filtros escolhidos.</td></tr>
                )}
                {result?.data.map((entry) => (
                  <tr key={entry.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setSelected(entry)}>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-700">{formatSaoPaulo(entry.event_at)}</td>
                    <td className="max-w-[14rem] px-4 py-2.5 text-gray-700 [overflow-wrap:anywhere]">{entry.email_de ?? '—'}</td>
                    <td className="max-w-[14rem] px-4 py-2.5 text-gray-900 [overflow-wrap:anywhere]">{entry.email_para}</td>
                    <td className="max-w-[20rem] px-4 py-2.5 text-gray-700 [overflow-wrap:anywhere]">{entry.assunto ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RESULT_STYLE[entry.tipo_status] ?? 'bg-gray-50 text-gray-700 ring-gray-500/20'}`}>
                        {entry.tipo_status || '—'}
                      </span>
                      {entry.erro && <p title={entry.erro.replace(/\\n/g, '\n')} className="mt-1 max-w-[16rem] truncate text-xs text-gray-600">{entry.erro}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{entry.sender_host ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={(event) => { event.stopPropagation(); setSelected(entry); }}
                        aria-label={`Ver detalhes do envio para ${entry.email_para}`}
                        className="rounded-md px-2 py-1 text-sm font-medium text-primary-700 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.pages > 1 && (
            <nav aria-label="Paginação" className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 sm:px-6">
              <button type="button" onClick={() => setPage(page - 1)} disabled={loading || page <= 1}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50">
                Anterior
              </button>
              <p className="text-sm tabular-nums text-gray-600" aria-live="polite">Página {pagination.page} de {pagination.pages}</p>
              <button type="button" onClick={() => setPage(page + 1)} disabled={loading || page >= pagination.pages}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50">
                Próxima
              </button>
            </nav>
          )}
        </section>
      </main>
      <ReportDetail entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
