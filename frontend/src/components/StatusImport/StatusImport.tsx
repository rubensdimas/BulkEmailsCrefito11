import { useRef, useState } from 'react';
import { importJobStatuses, type EmailStatusImportSummary } from '../../services/api';

interface StatusImportProps {
  jobId: string;
  onImported: () => Promise<void>;
}

const formatSummary = (summary: EmailStatusImportSummary): string => (
  `${summary.totalRows} linhas · ${summary.validRows} válidas · ${summary.updated} atualizadas · `
  + `${summary.unchanged} sem alteração · ${summary.notFound} não encontradas · `
  + `${summary.otherCampaign} de outras campanhas · ${summary.recipientMismatch} destinatários divergentes · `
  + `${summary.ignoredStale} eventos antigos · ${summary.duplicateRows} duplicadas · ${summary.invalidRows} inválidas`
);

export function StatusImport({ jobId, onImported }: StatusImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [summary, setSummary] = useState<EmailStatusImportSummary | null>(null);

  const handleImport = async () => {
    if (!file || isImporting) return;
    setIsImporting(true);
    setError(null);
    setRefreshWarning(null);
    setSummary(null);
    try {
      const response = await importJobStatuses(jobId, file);
      setSummary(response.summary);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      try {
        await onImported();
      } catch {
        setRefreshWarning('Os status foram importados, mas não foi possível atualizar o painel. Recarregue a página.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível importar o CSV');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="mt-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
      <h2 className="text-lg font-semibold text-gray-900">Importar status do Mailgrid</h2>
      <p className="mt-1 text-sm text-gray-600">
        Envie o CSV exportado pelo Mailgrid. Apenas mensagens já existentes nesta campanha serão atualizadas.
      </p>
      <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] || null);
            setError(null);
            setRefreshWarning(null);
            setSummary(null);
          }}
          disabled={isImporting}
          className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
        />
        <button
          type="button"
          onClick={handleImport}
          disabled={!file || isImporting}
          className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {isImporting ? 'Importando...' : 'Importar status'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="mt-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          Importação concluída: {formatSummary(summary)}.
          {summary.invalidRowNumbersTruncated && ' A lista de linhas inválidas foi limitada às 100 primeiras ocorrências.'}
        </div>
      )}
      {refreshWarning && <p className="mt-3 text-sm text-amber-700">{refreshWarning}</p>}
    </section>
  );
}

export default StatusImport;
