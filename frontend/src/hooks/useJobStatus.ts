import { useState, useEffect, useCallback, useRef } from 'react';
import { getJobStatus, JobStatus, JobStatusFilters } from '../services/api';

type VoidFn = () => void;

interface UseJobStatusOptions {
  jobId: string | null;
  pollInterval?: number; // in milliseconds, default 2000ms
  onComplete?: (status: JobStatus) => void;
  onError?: (error: Error) => void;
  enabled?: boolean;
  page?: number;
  filters?: JobStatusFilters;
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
    page = 1,
    filters,
  } = options;
  const recipientFilter = filters?.recipient;
  const statusFilter = filters?.status;

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const inFlightQueryKeysRef = useRef(new Set<string>());
  const completionNotifiedRef = useRef(false);
  const queryKey = JSON.stringify([jobId, enabled, page, recipientFilter, statusFilter]);
  const latestQueryKeyRef = useRef(queryKey);
  latestQueryKeyRef.current = queryKey;

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

  const fetchStatus = useCallback(async (throwOnError = false) => {
    if (!jobId || !enabled) return;
    if (inFlightQueryKeysRef.current.has(queryKey)) return;

    const requestSequence = ++requestSequenceRef.current;
    const requestQueryKey = queryKey;
    const isLatestRequest = () => (
      isMountedRef.current
      && requestSequence === requestSequenceRef.current
      && requestQueryKey === latestQueryKeyRef.current
    );

    inFlightQueryKeysRef.current.add(requestQueryKey);
    setIsLoading(true);
    setError(null);

    try {
      const result = await getJobStatus(jobId, page, {
        ...(recipientFilter ? { recipient: recipientFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });

      if (isLatestRequest()) {
        setStatus(result);

        if (result.status === 'completed' || result.status === 'failed') {
          if (!completionNotifiedRef.current) {
            completionNotifiedRef.current = true;
            onCompleteRef.current?.(result);
          }
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Erro ao buscar status');

      if (isLatestRequest()) {
        setError(error);
        onErrorRef.current?.(error);
      }
      if (throwOnError && isLatestRequest()) throw error;
    } finally {
      inFlightQueryKeysRef.current.delete(requestQueryKey);

      if (isLatestRequest()) {
        setIsLoading(false);
      }
    }
  }, [jobId, enabled, page, recipientFilter, statusFilter, queryKey]);

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

    startPollingRef.current();

    return () => {
      stopPollingRef.current();
    };
  }, [jobId, enabled, page, recipientFilter, statusFilter]);

  useEffect(() => {
    completionNotifiedRef.current = false;
  }, [jobId]);

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
    refresh: () => fetchStatus(true),
  };
}

export default useJobStatus;
