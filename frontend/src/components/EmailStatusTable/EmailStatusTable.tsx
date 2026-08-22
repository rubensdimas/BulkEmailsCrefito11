import type { EmailDeliveryItem, EmailDeliveryStatus, StatusPagination } from '../../services/api';

interface EmailStatusTableProps {
  emails: EmailDeliveryItem[];
  pagination?: StatusPagination;
  onPageChange: (page: number) => void;
  hasActiveFilters?: boolean;
}

const STATUS_STYLES: Record<EmailDeliveryStatus, { label: string; className: string }> = {
  pending: { label: 'Pendente', className: 'bg-gray-100 text-gray-700' },
  processing: { label: 'Processando', className: 'bg-yellow-100 text-yellow-800' },
  sent: { label: 'Enviado', className: 'bg-blue-100 text-blue-800' },
  delivered: { label: 'Entregue', className: 'bg-green-100 text-green-800' },
  soft_bounce: { label: 'Soft bounce', className: 'bg-orange-100 text-orange-800' },
  hard_bounce: { label: 'Hard bounce', className: 'bg-red-100 text-red-800' },
  failed: { label: 'Falha no envio', className: 'bg-red-100 text-red-800' },
  bounced: { label: 'Bounce', className: 'bg-red-100 text-red-800' },
};

export function EmailStatusTable({
  emails,
  pagination,
  onPageChange,
  hasActiveFilters = false,
}: EmailStatusTableProps) {
  const currentPage = pagination?.page || 1;
  const totalPages = pagination?.totalPages || 0;

  return (
    <section className="mt-6 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Destinatários</h2>
        <p className="text-sm text-gray-500 mt-1">
          {pagination?.total || 0} {hasActiveFilters ? 'endereços encontrados' : 'endereços'} — 100 itens por página
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">ID da mensagem</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Destinatário</th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {emails.map((email, index) => {
              const status = STATUS_STYLES[email.status];
              return (
                <tr key={`${email.messageId || email.recipient}-${index}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700 whitespace-nowrap">
                    {email.messageId || '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 whitespace-nowrap">{email.recipient}</td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${status.className}`}>
                      {status.label}
                    </span>
                    {email.statusMessage && (
                      <p className="mt-1 max-w-xl text-xs text-gray-500 break-words">{email.statusMessage}</p>
                    )}
                  </td>
                </tr>
              );
            })}
            {emails.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-10 text-center text-sm text-gray-500">
                  {hasActiveFilters
                    ? 'Nenhum destinatário corresponde aos filtros.'
                    : 'Nenhum destinatário nesta página.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm text-gray-600">
          Página {currentPage} de {Math.max(totalPages, 1)}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={totalPages === 0 || currentPage >= totalPages}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
          >
            Próxima
          </button>
        </div>
      </div>
    </section>
  );
}

export default EmailStatusTable;
