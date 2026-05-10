/**
 * Processors Tests - Error Classification
 */
import { 
  parseSmtpErrorCode, 
  classifyError,
} from './processors';

describe('processors', () => {
  describe('parseSmtpErrorCode', () => {
    it('should extract 4xx error codes', () => {
      expect(parseSmtpErrorCode('421 Service not ready')).toBe(421);
      expect(parseSmtpErrorCode('450 Mailbox busy')).toBe(450);
      expect(parseSmtpErrorCode('452 Insufficient storage')).toBe(452);
    });

    it('should extract 5xx error codes', () => {
      expect(parseSmtpErrorCode('550 User unknown')).toBe(550);
      expect(parseSmtpErrorCode('551 User not local')).toBe(551);
      expect(parseSmtpErrorCode('553 Mailbox name invalid')).toBe(553);
    });

    it('should extract code from complex error messages', () => {
      expect(parseSmtpErrorCode('SMTP error: 550 5.7.1 Access denied')).toBe(550);
      expect(parseSmtpErrorCode('Error: 421 Try again later')).toBe(421);
    });

    it('should return null for no code', () => {
      expect(parseSmtpErrorCode('Connection timeout')).toBeNull();
      expect(parseSmtpErrorCode('Unknown error')).toBeNull();
      expect(parseSmtpErrorCode('')).toBeNull();
    });
  });

  describe('classifyError', () => {
    it('should classify temporary errors (4xx)', () => {
      expect(classifyError('421 Service not ready')).toBe('temporary');
      expect(classifyError('450 Mailbox busy')).toBe('temporary');
      expect(classifyError('452 Insufficient storage')).toBe('temporary');
    });

    it('should classify permanent errors (5xx)', () => {
      const result = classifyError('550 User unknown');
      expect(result).toBe('permanent');
    });

    it('should classify unknown errors', () => {
      const result = classifyError('Connection failed');
      expect(result).toBe('unknown');
    });

    it('should default 4xx to temporary', () => {
      expect(classifyError('400 Bad request')).toBe('temporary');
    });

    it('should default 5xx to permanent', () => {
      expect(classifyError('500 Internal server error')).toBe('permanent');
    });
  });
});