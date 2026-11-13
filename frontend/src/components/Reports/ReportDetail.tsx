import { useEffect, useRef } from 'react';
import type { MailgridReportEntry } from '../../services/api';
import { formatSaoPaulo } from '../../utils/saoPauloTime';

const FIELDS: Array<{ label: string; value: (entry: MailgridReportEntry) => string | null }> = [
  { label: 'Data/hora do evento', value: (entry) => formatSaoPaulo(entry.event_at) },
  { label: 'Data/hora do envio', value: (entry) => formatSaoPaulo(entry.sent_at) },
  { label: 'Resultado', value: (entry) => entry.tipo_status || null },
  { label: 'Status', value: (entry) => entry.status },
  { label: 'Remetente', value: (entry) => entry.email_de },
  { label: 'Destinatário', value: (entry) => entry.email_para },
  { label: 'Assunto', value: (entry) => entry.assunto },
  { label: 'Sender', value: (entry) => entry.sender },
  { label: 'Servidor de origem', value: (entry) => entry.sender_host },
  { label: 'IP de origem', value: (entry) => entry.sender_ip },
  { label: 'Servidor de destino', value: (entry) => entry.delivery_host },
  { label: 'IP de destino', value: (entry) => entry.delivery_ip },
  { label: 'Tamanho', value: (entry) => entry.size },
  { label: 'msgid', value: (entry) => entry.msgid },
  { label: 'Message-ID', value: (entry) => entry.message_id },
  { label: 'Coletado em', value: (entry) => formatSaoPaulo(entry.collected_at) },
];

/** Native modal dialog: the browser traps focus, closes on Escape and restores focus to the trigger. */
export function ReportDetail({ entry, onClose }: { entry: MailgridReportEntry | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (entry && !element.open) element.showModal();
    if (!entry && element.open) element.close();
  }, [entry]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="report-detail-title"
      className="w-[calc(100%-2rem)] max-w-2xl rounded-xl p-0 shadow-xl backdrop:bg-gray-900/50">
      {entry && (
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id="report-detail-title" className="text-lg font-semibold text-gray-900">Detalhes do envio</h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Fechar"
              className="-m-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
          {entry.erro && (
            <section aria-labelledby="report-detail-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 id="report-detail-error" className="text-sm font-semibold text-red-900">Mensagem de erro</h3>
              <p className="mt-1 whitespace-pre-line font-mono text-xs leading-relaxed text-red-900 [overflow-wrap:anywhere]">{entry.erro.replace(/\\n/g, '\n')}</p>
            </section>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
            {FIELDS.map((field) => (
              <div key={field.label} className="contents">
                <dt className="font-medium text-gray-500">{field.label}</dt>
                <dd className="text-gray-900 [overflow-wrap:anywhere]">{field.value(entry) || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </dialog>
  );
}
