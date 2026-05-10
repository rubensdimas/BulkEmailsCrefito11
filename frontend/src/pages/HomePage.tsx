import { useState, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import FileUpload from '../components/FileUpload/FileUpload';
import EmailForm from '../components/EmailForm/EmailForm';
import { useUpload } from '../hooks/useUpload';
import { useEmailSubmit } from '../hooks/useEmailSubmit';
import { getJobStatus } from '../services/api';

export function HomePage() {
  const navigate = useNavigate();
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validEmails, setValidEmails] = useState<string[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);

  // Check for existing job in progress after refresh
  useEffect(() => {
    const lastJobId = localStorage.getItem('last_bulk_email_job_id');
    if (lastJobId) {
      // Check if job is still active
      getJobStatus(lastJobId).then(status => {
        if (status && (status.status === 'processing' || status.status === 'pending')) {
          navigate(`/status/${lastJobId}`);
        }
      }).catch(() => {
        // If error (e.g. 404), clean up localStorage
        localStorage.removeItem('last_bulk_email_job_id');
      });
    }
  }, [navigate]);
  
  const { upload, isLoading: isUploading, error: uploadError, progress } = useUpload({
    onSuccess: (response) => {
      const validEmailsList = response.emails?.valid || [];
      const invalidCountVal = response.emails?.invalid?.length || 0;
      setValidEmails(validEmailsList);
      setInvalidCount(invalidCountVal);
    },
  });

  const { submit, isLoading: isSending, error: sendError } = useEmailSubmit({
    onSuccess: (response) => {
      if (response.jobId) {
        navigate(`/status/${response.jobId}`);
      }
    },
  });

  const handleFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    await upload(file);
  }, [upload]);

  const handleEmailSubmit = useCallback(
    async (subject: string, body: string) => {
      if (validEmails.length > 0) {
        await submit(validEmails, subject, body);
      }
    },
    [validEmails, submit]
  );

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    setValidEmails([]);
    setInvalidCount(0);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">BulkMail Pro</h1>
            <p className="text-gray-600 mt-1">Envio de emails em massa via planilha XLSX</p>
          </div>
          <div>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Error Alert */}
        {(uploadError || sendError) && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-red-700">
                {uploadError?.message || sendError?.message || 'Erro desconhecido'}
              </p>
            </div>
          </div>
        )}

        {/* File Upload Section */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">1. Carregar Arquivo</h2>
            {selectedFile && (
              <button
                onClick={handleReset}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Limpar arquivo
              </button>
            )}
          </div>
          
          <FileUpload
            onFileSelect={handleFileSelect}
            disabled={isUploading}
          />

          {/* Upload Progress */}
          {isUploading && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-gray-500 mb-1">
                <span>Processando arquivo...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Email Preview Section */}
        {validEmails.length > 0 && (
          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Emails Encontrados ({validEmails.length})
            </h2>
            
            {/* Stats */}
            <div className="flex gap-4 mb-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-lg">
                <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm font-medium text-green-700">{validEmails.length} válidos</span>
              </div>
              {invalidCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 rounded-lg">
                  <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="text-sm font-medium text-red-700">{invalidCount} inválidos</span>
                </div>
              )}
            </div>

            {/* Email List Preview (first 10) */}
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-gray-600 font-medium">#</th>
                    <th className="px-4 py-2 text-left text-gray-600 font-medium">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {validEmails.slice(0, 10).map((email, index) => (
                    <tr key={index} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-gray-500">{index + 1}</td>
                      <td className="px-4 py-2 text-gray-900 font-mono text-xs">{email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validEmails.length > 10 && (
                <div className="px-4 py-2 bg-gray-50 text-center text-sm text-gray-500">
                  ... e mais {validEmails.length - 10} emails
                </div>
              )}
            </div>
          </section>
        )}

        {/* Email Form Section */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">2. Configurar Email</h2>
          
          <EmailForm
            onSubmit={handleEmailSubmit}
            disabled={validEmails.length === 0}
            isLoading={isSending}
            emailCount={validEmails.length}
          />
        </section>
      </main>
    </div>
  );
}

export default HomePage;