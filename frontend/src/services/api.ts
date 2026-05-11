import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
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

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  from_address: string;
  from_name: string;
}

export interface ConfigResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

// ============= API Functions =============

// Get SMTP configuration
export const getSmtpConfig = async (): Promise<ConfigResponse<SmtpConfig>> => {
  const response = await api.get<ConfigResponse<SmtpConfig>>('/config/smtp');
  return response.data;
};

// Update SMTP configuration
export const updateSmtpConfig = async (config: SmtpConfig): Promise<ConfigResponse<null>> => {
  const response = await api.post<ConfigResponse<null>>('/config/smtp', config);
  return response.data;
};

// Test SMTP configuration
export const testSmtpConfig = async (config: SmtpConfig, to: string): Promise<ConfigResponse<null>> => {
  const response = await api.post<ConfigResponse<null>>('/config/smtp/test', { config, to });
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
export const getJobStatus = async (jobId: string): Promise<JobStatus> => {
  const response = await api.get<JobStatus>(`/status/${jobId}`);
  return response.data;
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

// ============= Export =============

export default api;
export { api };