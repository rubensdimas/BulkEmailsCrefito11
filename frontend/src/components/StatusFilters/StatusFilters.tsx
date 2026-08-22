import { FormEvent, useEffect, useState } from 'react';
import type { EmailStatusFilterValue, JobStatusFilters } from '../../services/api';

interface StatusFiltersProps {
  appliedFilters: JobStatusFilters;
  onApply: (filters: JobStatusFilters) => void;
}

const STATUS_OPTIONS: Array<{ value: EmailStatusFilterValue; label: string }> = [
  { value: 'pending', label: 'Pendente' },
  { value: 'sent', label: 'Enviado' },
  { value: 'soft_bounce', label: 'Soft bounce' },
  { value: 'hard_bounce', label: 'Hard bounce' },
  { value: 'delivered', label: 'Entregue' },
];

export function StatusFilters({ appliedFilters, onApply }: StatusFiltersProps) {
  const [recipient, setRecipient] = useState(appliedFilters.recipient || '');
  const [status, setStatus] = useState<EmailStatusFilterValue | ''>(appliedFilters.status || '');

  useEffect(() => {
    setRecipient(appliedFilters.recipient || '');
    setStatus(appliedFilters.status || '');
  }, [appliedFilters.recipient, appliedFilters.status]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedRecipient = recipient.trim().toLowerCase();
    onApply({
      ...(normalizedRecipient ? { recipient: normalizedRecipient } : {}),
      ...(status ? { status } : {}),
    });
  };

  const handleClear = () => {
    setRecipient('');
    setStatus('');
    onApply({});
  };

  return (
    <section
      aria-labelledby="status-filters-title"
      className="mt-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6"
    >
      <h2 id="status-filters-title" className="text-lg font-semibold text-gray-900">
        Filtros de destinatários
      </h2>
      <p className="mt-1 text-sm text-gray-600">
        Localize um endereço exato ou filtre os registros pelo status de entrega.
      </p>

      <form noValidate onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_auto] md:items-end">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700">Endereço de e-mail</span>
          <input
            type="email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="destinatario@exemplo.com"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-gray-700">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as EmailStatusFilterValue | '')}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-2 sm:flex-row md:justify-end">
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200"
          >
            Limpar
          </button>
        </div>
      </form>
    </section>
  );
}

export default StatusFilters;
