import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error: AxiosError) => {
    console.error('[API] Request error:', error.message);
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data as { message?: string };
      console.error(`[API] Error ${status}:`, data.message || error.message);
    } else if (error.request) {
      console.error('[API] No response received:', error.message);
    } else {
      console.error('[API] Request setup error:', error.message);
    }
    return Promise.reject(error);
  }
);

// ============= Types =============

export interface UploadResponse {
  success: boolean;
  message?: string;
  data?: {
    fileName: string;
    totalRows: number;
    headers: string[];
    emailColumnDetected: string;
    totalEmails: number;
    validEmails: number;
    invalidEmails: number;
  };
  emails?: {
    valid: string[];
    invalid: { email: string; error: string }[];
  };
  error?: string;
}

export interface SendEmailRequest {
  emails: string[];
  subject: string;
  html?: string;
  text?: string;
}

export interface SendEmailResponse {
  success: boolean;
  message: string;
  jobId?: string;
  campaignId?: string;
  totalEmails?: number;
  validEmails?: number;
  invalidEmails?: number;
  timestamp?: string;
}

export interface JobStatus {
  jobId: string;
  campaignId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  processing: number;
  waiting: number;
  progress?: number;
  timestamp?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  emails?: EmailDeliveryItem[];
  pagination?: StatusPagination;
}

export type EmailDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'soft_bounce'
  | 'hard_bounce'
  | 'failed'
  | 'bounced';

export type EmailStatusFilterValue = Extract<
  EmailDeliveryStatus,
  'pending' | 'sent' | 'delivered' | 'soft_bounce' | 'hard_bounce'
>;

export interface JobStatusFilters {
  recipient?: string;
  status?: EmailStatusFilterValue;
}

export interface EmailDeliveryItem {
  messageId: string | null;
  recipient: string;
  status: EmailDeliveryStatus;
  statusMessage: string | null;
  sentAt: string | null;
  eventAt: string | null;
}

export interface StatusPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface EmailStatusImportSummary {
  totalRows: number;
  validRows: number;
  updated: number;
  unchanged: number;
  ignoredStale: number;
  notFound: number;
  otherCampaign: number;
  recipientMismatch: number;
  duplicateRows: number;
  invalidRows: number;
  invalidRowNumbers: number[];
  invalidRowNumbersTruncated: boolean;
}

export interface Job {
  id: string;
  campaign_id: string;
  subject: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'critical';
  total_recipients: number;
  valid_recipients: number;
  invalid_recipients: number;
  completed_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    pages: number;
  };
}

export interface MailgridConfig {
  host: string;
  user: string;
  pass: string;
  from_address: string;
  from_name: string;
  webhook_token: string;
  webhook_token_configured?: boolean;
}

export interface ConfigResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface AuthUser {
  sub: string;
  name?: string;
  email?: string;
}

// ============= API Functions =============

// Get Mailgrid configuration
export const getMailgridConfig = async (signal?: AbortSignal): Promise<ConfigResponse<MailgridConfig>> => {
  const response = await api.get<ConfigResponse<MailgridConfig>>('/config/mailgrid', { signal });
  return response.data;
};

// Update Mailgrid configuration
export const updateMailgridConfig = async (config: MailgridConfig): Promise<ConfigResponse<null>> => {
  const response = await api.post<ConfigResponse<null>>('/config/mailgrid', config);
  return response.data;
};

// Test Mailgrid configuration
export const testMailgridConfig = async (config: MailgridConfig, to: string): Promise<ConfigResponse<null>> => {
  const response = await api.post<ConfigResponse<null>>('/config/mailgrid/test', { config, to });
  return response.data;
};

// Upload XLSX file
export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<UploadResponse>('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
};

// Send emails
export const sendEmails = async (data: SendEmailRequest): Promise<SendEmailResponse> => {
  const response = await api.post<SendEmailResponse>('/send', data);
  return response.data;
};

// Get job status
export const getJobStatus = async (
  jobId: string,
  page: number = 1,
  filters: JobStatusFilters = {},
): Promise<JobStatus> => {
  const response = await api.get<JobStatus>(`/status/${jobId}`, {
    params: { page, ...filters },
  });
  return response.data;
};

export const importJobStatuses = async (
  jobId: string,
  file: File,
): Promise<{ success: boolean; jobId: string; campaignId: string; summary: EmailStatusImportSummary }> => {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const response = await api.post(`/status/${jobId}/import`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data as { error?: string; message?: string } | undefined;
      throw new Error(payload?.error || payload?.message || 'Não foi possível importar o CSV');
    }
    throw error;
  }
};

// Get jobs list with pagination and filters
export const getJobs = async (params?: { limit?: number; offset?: number; status?: string }): Promise<PaginatedResponse<Job>> => {
  const response = await api.get<PaginatedResponse<Job>>('/jobs', { params });
  return response.data;
};

// Delete job
export const deleteJob = async (jobId: string): Promise<{ success: boolean; message: string }> => {
  const response = await api.delete<{ success: boolean; message: string }>(`/jobs/${jobId}`);
  return response.data;
};

export const getCurrentUser = async (): Promise<AuthUser> => {
  const response = await api.get<ConfigResponse<AuthUser>>('/auth/me');
  return response.data.data;
};

export const logout = async (): Promise<{ logoutUrl: string | null }> => {
  const response = await api.post<{ success: boolean; logoutUrl: string | null }>('/auth/logout');
  return { logoutUrl: response.data.logoutUrl };
};

// ============= Export =============

export default api;
export { api };
