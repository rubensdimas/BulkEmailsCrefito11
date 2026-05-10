import { useState, useCallback, useRef, useEffect } from 'react';
import { sendEmails, SendEmailResponse } from '../services/api';

const REQUEST_TIMEOUT_MS = 30000; // 30 seconds timeout

interface UseEmailSubmitOptions {
  onSuccess?: (response: SendEmailResponse) => void;
  onError?: (error: Error) => void;
}

interface UseEmailSubmitReturn {
  submit: (emails: string[], subject: string, body: string) => Promise<SendEmailResponse | null>;
  isLoading: boolean;
  error: Error | null;
  response: SendEmailResponse | null;
  reset: () => void;
}

export function useEmailSubmit(options?: UseEmailSubmitOptions): UseEmailSubmitReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [response, setResponse] = useState<SendEmailResponse | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const submit = useCallback(
    async (emails: string[], subject: string, body: string): Promise<SendEmailResponse | null> => {
      if (emails.length === 0) {
        const err = new Error('Nenhum email para enviar');
        setError(err);
        options?.onError?.(err);
        return null;
      }

      // Cancel previous request if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      try {
        // Create promise that rejects on timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutRef.current = setTimeout(() => {
            const err = new Error('Tempo limite excedido (30s)');
            reject(err);
          }, REQUEST_TIMEOUT_MS);
        });

        // Race between API call and timeout
        const result = await Promise.race([
          sendEmails({ emails, subject, html: body }),
          timeoutPromise,
        ]);

        // Clear timeout on success
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        if (result.success) {
          setResponse(result);
          options?.onSuccess?.(result);
          return result;
        } else {
          const err = new Error(result.message || 'Erro ao enviar emails');
          setError(err);
          options?.onError?.(err);
          return null;
        }
      } catch (err) {
        // Clear timeout on error
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }

        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') {
          const abortErr = new Error('Requisição cancelada');
          setError(abortErr);
          return null;
        }

        const error = err instanceof Error ? err : new Error('Erro desconhecido');
        setError(error);
        options?.onError?.(error);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [options]
  );

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setResponse(null);
  }, []);

  return {
    submit,
    isLoading,
    error,
    response,
    reset,
  };
}

export default useEmailSubmit;