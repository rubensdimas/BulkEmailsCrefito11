import clsx from 'clsx';
import { JobStatus } from '../../services/api';

interface StatusPanelProps {
  status: JobStatus | null;
  isLoading?: boolean;
  isPolling?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  onStopPolling?: () => void;
}

export function StatusPanel({
  status,
  isLoading = false,
  isPolling = false,
  error = null,
  onRefresh,
  onStopPolling,
}: StatusPanelProps) {
  // Calculate progress percentage
  const progressPercent = status && status.progress !== undefined
    ? status.progress
    : status && status.total > 0
      ? Math.round(((status.completed + status.failed) / status.total) * 100)
      : 0;

  // Status color mapping
  const getStatusColor = (jobStatus: string | undefined) => {
    switch (jobStatus) {
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'processing':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusText = (jobStatus: string | undefined) => {
    switch (jobStatus) {
      case 'completed':
        return 'Concluído';
      case 'failed':
        return 'Falhou';
      case 'processing':
        return 'Processando';
      default:
        return 'Pendente';
    }
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="font-medium text-red-800">Erro ao buscar status</h3>
            <p className="text-sm text-red-600">{error.message}</p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!status && isLoading) {
    return (
      <div className="p-8 text-center">
        <svg className="animate-spin h-10 w-10 text-primary-500 mx-auto" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="mt-4 text-gray-600">Carregando status...</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="p-6 bg-gray-50 border border-gray-200 rounded-xl text-center">
        <svg className="w-12 h-12 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="mt-4 text-gray-600">Nenhum job encontrado</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Status do Envio</h2>
            <p className="text-sm text-gray-500 mt-1">ID: {status.jobId}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx('px-3 py-1 rounded-full text-sm font-medium', getStatusColor(status.status), 'text-white')}>
              {getStatusText(status.status)}
            </span>
            {isPolling && (
              <span className="flex items-center gap-1 text-sm text-gray-500">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Atualizando
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-6 py-4 bg-gray-50">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Progresso</span>
          <span className="font-medium text-gray-900">{progressPercent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={clsx('h-3 rounded-full transition-all duration-500', getStatusColor(status.status))}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          {status.completed} de {status.total} emails processados
        </p>
      </div>

      {/* Stats */}
      <div className="p-6 grid grid-cols-3 gap-4">
        <div className="text-center p-4 bg-green-50 rounded-lg">
          <p className="text-2xl font-bold text-green-600">{status.completed}</p>
          <p className="text-sm text-green-700">Enviados</p>
        </div>
        <div className="text-center p-4 bg-red-50 rounded-lg">
          <p className="text-2xl font-bold text-red-600">{status.failed}</p>
          <p className="text-sm text-red-700">Falharam</p>
        </div>
        <div className="text-center p-4 bg-gray-100 rounded-lg">
          <p className="text-2xl font-bold text-gray-600">{status.waiting}</p>
          <p className="text-sm text-gray-600">Pendentes</p>
        </div>
      </div>

      {/* Timestamps */}
      <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
        <div className="flex justify-between text-sm">
          <div>
            <span className="text-gray-500">Iniciado: </span>
            <span className="text-gray-700">{formatDate(status.createdAt)}</span>
          </div>
          <div>
            <span className="text-gray-500">Atualizado: </span>
            <span className="text-gray-700">{formatDate(status.updatedAt)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
        {isPolling ? (
          <button
            onClick={onStopPolling}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
          >
            Parar atualizações
          </button>
        ) : (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="px-4 py-2 bg-primary-100 hover:bg-primary-200 text-primary-700 rounded-lg transition-colors disabled:opacity-50"
          >
            Atualizar
          </button>
        )}
      </div>
    </div>
  );
}

export default StatusPanel;