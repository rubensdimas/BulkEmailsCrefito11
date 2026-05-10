// ============= Type Definitions =============

export interface UploadResult {
  validEmails: string[];
  invalidCount: number;
  totalCount: number;
}

export interface SendEmailData {
  emails: string[];
  subject: string;
  /** HTML body content (from QuillEditor) */
  body: string;
}

export interface JobStatusData {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  processing: number;
  waiting: number;
  progress?: number;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  timestamp?: string;
}

export interface UploadError {
  message: string;
  code?: string;
}

export interface SendError {
  message: string;
  code?: string;
}

export interface StatusError {
  message: string;
  code?: string;
}

// ============= API Response Types =============

export interface UploadResponse {
  success: boolean;
  message: string;
  data?: UploadResult;
}

export interface SendResponse {
  success: boolean;
  message: string;
  data?: {
    jobId: string;
    totalEmails: number;
  };
}

export interface StatusResponse {
  success: boolean;
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  processing: number;
  waiting: number;
  progress?: number;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  timestamp?: string;
}