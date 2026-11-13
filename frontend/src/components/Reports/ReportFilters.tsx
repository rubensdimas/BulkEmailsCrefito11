import { useState, type FormEvent } from 'react';
import { MAILGRID_TIPO_STATUS, type MailgridTipoStatus } from '../../services/api';

export interface ReportFilterForm {
  from: string;
  to: string;
  recipient: string;
  sender: string;
  subject: string;
  deliveryHost: string;
  msgid: string;
  senderHost: string;
  tipoStatus: MailgridTipoStatus[];
}

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700';

const TEXT_FIELDS: Array<{ key: 'recipient' | 'sender' | 'subject' | 'deliveryHost' | 'msgid'; label: string; placeholder: string }> = [
  { key: 'recipient', label: 'Destinatário', placeholder: 'parte do e-mail' },
  { key: 'sender', label: 'Remetente', placeholder: 'parte do e-mail' },
  { key: 'subject', label: 'Assunto', placeholder: 'parte do assunto' },
  { key: 'deliveryHost', label: 'Domínio de destino', placeholder: 'ex.: gmail' },
  { key: 'msgid', label: 'msgid', placeholder: 'valor exato' },
];

export function ReportFilters({ initial, senderHosts, onApply, onReset, busy }: {
  initial: ReportFilterForm;
  senderHosts: string[];
  onApply: (filters: ReportFilterForm) => void;
  /** Returns fresh default filters (a new "last 7 days" window) after they were applied. */
  onReset: () => ReportFilterForm;
  busy: boolean;
}) {
  const [form, setForm] = useState<ReportFilterForm>(initial);
  const set = <K extends keyof ReportFilterForm>(key: K, value: ReportFilterForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleStatus = (status: MailgridTipoStatus, checked: boolean) => set('tipoStatus',
    MAILGRID_TIPO_STATUS.filter((value) => (value === status ? checked : form.tipoStatus.includes(value))));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(form);
  };

  return (
    <form onSubmit={submit} aria-label="Filtros do relatório" className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="report-from" className={labelClass}>Período de</label>
          <input id="report-from" type="datetime-local" required value={form.from} onChange={(event) => set('from', event.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="report-to" className={labelClass}>Período até</label>
          <input id="report-to" type="datetime-local" required value={form.to} onChange={(event) => set('to', event.target.value)} className={inputClass} />
        </div>
        {TEXT_FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={`report-${field.key}`} className={labelClass}>{field.label}</label>
            <input id={`report-${field.key}`} type="search" value={form[field.key]} placeholder={field.placeholder} maxLength={254}
              onChange={(event) => set(field.key, event.target.value)} className={inputClass} />
          </div>
        ))}
        <div>
          <label htmlFor="report-senderHost" className={labelClass}>Servidor de origem</label>
          <select id="report-senderHost" value={form.senderHost} onChange={(event) => set('senderHost', event.target.value)} className={inputClass}>
            <option value="">Todos</option>
            {senderHosts.map((host) => <option key={host} value={host}>{host}</option>)}
          </select>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <fieldset>
          <legend className={labelClass}>Resultado</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {MAILGRID_TIPO_STATUS.map((status) => (
              <label key={status} className="inline-flex min-h-[32px] items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.tipoStatus.includes(status)} onChange={(event) => toggleStatus(status, event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                {status}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => setForm(onReset())}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            Limpar filtros
          </button>
          <button type="submit" disabled={busy}
            className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            Filtrar
          </button>
        </div>
      </div>
    </form>
  );
}
