import { useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import StatusPanel from '../components/StatusPanel/StatusPanel';
import { useJobStatus } from '../hooks/useJobStatus';
import type { JobStatus } from '../services/api';

export function StatusPage() {
  const { jobId } = useParams<{ jobId: string }>();

  // Stable callbacks — won't trigger hook dependency cascades
  const handleComplete = useCallback((result: JobStatus) => {
    console.log('Job completed:', result);
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error('Error fetching status:', err);
  }, []);

  const {
    status,
    isLoading,
    error,
    isPolling,
    stopPolling,
    refresh,
  } = useJobStatus({
    jobId: jobId || null,
    pollInterval: 2000,
    onComplete: handleComplete,
    onError: handleError,
  });

  if (!jobId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Job não encontrado</h2>
          <p className="text-gray-600 mb-6">ID do job não fornecido</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Voltar para início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Status do Envio</h1>
              <p className="text-gray-600 mt-1">Acompanhe o progresso do envio de emails</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Status Panel */}
        <StatusPanel
          status={status}
          isLoading={isLoading}
          isPolling={isPolling}
          error={error}
          onRefresh={refresh}
          onStopPolling={stopPolling}
        />

        {/* Completion message */}
        {status && (status.status === 'completed' || status.status === 'failed') && (
          <div className="mt-6 text-center">
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${
              status.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {status.status === 'completed' ? (
                <>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">Envio concluído com sucesso!</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">O envio encontrou problemas</span>
                </>
              )}
            </div>
            
            <Link
              to="/"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Enviar novos emails
            </Link>
          </div>
        )}

        {/* Help text */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>A página atualiza automaticamente a cada 2 segundos</p>
          <p className="mt-1">
            Precisa de ajuda?{' '}
            <a href="#" className="text-primary-600 hover:underline">Contate o suporte</a>
          </p>
        </div>
      </main>
    </div>
  );
}

export default StatusPage;