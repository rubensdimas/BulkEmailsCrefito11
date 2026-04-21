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

// ============= API Functions =============

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

// ============= Export =============

export default api;
export { api };