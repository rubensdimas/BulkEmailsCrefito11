import { useState, useCallback } from 'react';
import { uploadFile, UploadResponse } from '../services/api';

interface UseUploadOptions {
  onSuccess?: (result: UploadResponse) => void;
  onError?: (error: Error) => void;
}

interface UseUploadReturn {
  upload: (file: File) => Promise<UploadResponse | null>;
  isLoading: boolean;
  error: Error | null;
  result: UploadResponse | null;
  progress: number;
  reset: () => void;
}

export function useUpload(options?: UseUploadOptions): UseUploadReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [progress, setProgress] = useState(0);

  const upload = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setIsLoading(true);
      setError(null);
      setProgress(0);

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      try {
        const response = await uploadFile(file);
        
        clearInterval(progressInterval);
        setProgress(100);

        if (response.success) {
          setResult(response);
          options?.onSuccess?.(response);
          return response;
        } else {
          const err = new Error(response.message || 'Erro ao processar arquivo');
          setError(err);
          options?.onError?.(err);
          return null;
        }
      } catch (err) {
        clearInterval(progressInterval);
        const error = err instanceof Error ? err : new Error('Erro desconhecido');
        setError(error);
        options?.onError?.(error);
        return null;
      } finally {
        setIsLoading(false);
        setTimeout(() => setProgress(0), 500);
      }
    },
    [options]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setResult(null);
    setProgress(0);
  }, []);

  return {
    upload,
    isLoading,
    error,
    result,
    progress,
    reset,
  };
}

export default useUpload;