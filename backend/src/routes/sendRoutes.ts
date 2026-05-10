/**
 * Send Routes
 * POST /api/send - Create email jobs in queue
 */
import { Router } from 'express';
import { sendEmails } from '../controllers/sendController';

const router = Router();

/**
 * POST /api/send
 * Create email jobs in queue
 * 
 * Body:
 *   - emails: string[] (required) - List of email addresses
 *   - subject: string (required) - Email subject
 *   - html: string (required if text not provided) - HTML body
 *   - text: string (required if html not provided) - Plain text body
 *   - from?: string - Sender email (optional)
 *   - replyTo?: string - Reply-to email
 *   - templateId?: string - Template identifier
 *   - variables?: Record<string, unknown> - Template variables
 *   - campaignId?: string - Campaign ID (auto-generated if not provided)
 *   - priority?: number - Job priority (1 = highest, default 2)
 * 
 * Response:
 *   - jobId: string - Campaign/job identifier
 *   - totalEmails: number - Total emails in request
 *   - validEmails: number - Valid email count
 *   - invalidEmails: number - Invalid email count
 *   - message: string - Status message
 */
router.post('/', sendEmails);

export default router;