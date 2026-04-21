import { useState, useEffect, useCallback, useRef } from 'react';
import { getJobStatus, JobStatus } from '../services/api';

type VoidFn = () => void;

interface UseJobStatusOptions {
  jobId: string | null;
  pollInterval?: number; // in milliseconds, default 2000ms
  onComplete?: (status: JobStatus) => void;
  onError?: (error: Error) => void;
  enabled?: boolean;
}

interface UseJobStatusReturn {
  status: JobStatus | null;
  isLoading: boolean;
  error: Error | null;
  isPolling: boolean;
  startPolling: () => void;
  stopPolling: () => void;
  refresh: () => Promise<void>;
}

export function useJobStatus(options: UseJobStatusOptions): UseJobStatusReturn {
  const {
    jobId,
    pollInterval = 2000,
    onComplete,
    onError,
    enabled = true,
  } = options;

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);

  // Stable refs for callbacks to avoid dependency churn
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  onCompleteRef.current = onComplete;
  onErrorRef.current = onError;

  const stopPolling = useCallback(() => {
    setIsPolling(false);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!jobId || !enabled) return;
    if (isFetchingRef.current) return;

    isFetchingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await getJobStatus(jobId);

      if (isMountedRef.current) {
        setStatus(result);

        if (result.status === 'completed' || result.status === 'failed') {
          stopPolling();
          localStorage.removeItem('last_bulk_email_job_id');
          onCompleteRef.current?.(result);
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Erro ao buscar status');

      if (isMountedRef.current) {
        setError(error);
        onErrorRef.current?.(error);
      }
    } finally {
      isFetchingRef.current = false;

      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [jobId, enabled, stopPolling]);

  const startPolling = useCallback(() => {
    if (!jobId || !enabled || intervalRef.current) return;

    setIsPolling(true);

    // primeira execução imediata
    fetchStatus();

    intervalRef.current = setInterval(() => {
      fetchStatus();
    }, pollInterval);
  }, [jobId, enabled, pollInterval, fetchStatus]);

  // Only re-run when jobId or enabled actually change (primitive values)
  // startPolling/stopPolling are called via refs to avoid dependency churn
  const startPollingRef = useRef<VoidFn>(startPolling);
  const stopPollingRef = useRef<VoidFn>(stopPolling);
  startPollingRef.current = startPolling;
  stopPollingRef.current = stopPolling;

  useEffect(() => {
    if (!jobId || !enabled) return;

    localStorage.setItem('last_bulk_email_job_id', jobId);

    startPollingRef.current();

    return () => {
      stopPollingRef.current();
    };
  }, [jobId, enabled]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  return {
    status,
    isLoading,
    error,
    isPolling,
    startPolling,
    stopPolling,
    refresh: fetchStatus,
  };
}

export default useJobStatus;