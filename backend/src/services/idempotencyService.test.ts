/**
 * Idempotency Service Tests
 */
import {
  generateUniqueHash,
  shouldSendEmail,
  wasEmailSent,
  generateTrackingId,
  parseTemplate,
  validateTemplateVariables,
  sanitizeHtmlContent,
} from './idempotencyService';

describe('idempotencyService', () => {
  describe('generateUniqueHash', () => {
    it('should generate consistent hash', () => {
      const hash1 = generateUniqueHash('job1', 'test@example.com', 'Subject', 'from@example.com');
      const hash2 = generateUniqueHash('job1', 'test@example.com', 'Subject', 'from@example.com');

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different emails', () => {
      const hash1 = generateUniqueHash('job1', 'test1@example.com', 'Subject', 'from@example.com');
      const hash2 = generateUniqueHash('job1', 'test2@example.com', 'Subject', 'from@example.com');

      expect(hash1).not.toBe(hash2);
    });

    it('should generate different hash for different subjects', () => {
      const hash1 = generateUniqueHash('job1', 'test@example.com', 'Subject1', 'from@example.com');
      const hash2 = generateUniqueHash('job1', 'test@example.com', 'Subject2', 'from@example.com');

      expect(hash1).not.toBe(hash2);
    });

    it('should normalize email case', () => {
      const hash1 = generateUniqueHash('job1', 'TEST@EXAMPLE.COM', 'Subject', 'from@example.com');
      const hash2 = generateUniqueHash('job1', 'test@example.com', 'Subject', 'from@example.com');

      expect(hash1).toBe(hash2);
    });

    it('should return 64-character hex string', () => {
      const hash = generateUniqueHash('job1', 'test@example.com', 'Subject', 'from@example.com');

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('shouldSendEmail', () => {
    it('should return true for undefined status', () => {
      expect(shouldSendEmail(undefined)).toBe(true);
    });

    it('should return true for failed status', () => {
      expect(shouldSendEmail('failed')).toBe(true);
    });

    it('should return true for bounced status', () => {
      expect(shouldSendEmail('bounced')).toBe(true);
    });

    it('should return false for sent status', () => {
      expect(shouldSendEmail('sent')).toBe(false);
    });
  });

  describe('wasEmailSent', () => {
    it('should return true for sent status', () => {
      expect(wasEmailSent('sent')).toBe(true);
    });

    it('should return false for other statuses', () => {
      expect(wasEmailSent('failed')).toBe(false);
      expect(wasEmailSent('pending')).toBe(false);
      expect(wasEmailSent(undefined)).toBe(false);
    });
  });

  describe('generateTrackingId', () => {
    it('should generate random tracking ID', () => {
      const id1 = generateTrackingId();
      const id2 = generateTrackingId();

      expect(id1).not.toBe(id2);
      expect(id1).toHaveLength(32);
    });
  });

  describe('parseTemplate', () => {
    it('should replace template variables', () => {
      const result = parseTemplate('Hello {{name}}!', { name: 'John' });
      expect(result).toBe('Hello John!');
    });

    it('should handle multiple variables', () => {
      const result = parseTemplate('Hello {{name}}, your order {{order}} is ready.', {
        name: 'John',
        order: '12345',
      });
      expect(result).toBe('Hello John, your order 12345 is ready.');
    });

    it('should handle missing variables', () => {
      const result = parseTemplate('Hello {{name}}!', {});
      expect(result).toBe('Hello {{name}}!');
    });

    it('should handle whitespace in variables', () => {
      const result = parseTemplate('Hello {{ name }}!', { name: 'John' });
      expect(result).toBe('Hello John!');
    });

    it('should be case insensitive', () => {
      const result = parseTemplate('Hello {{NAME}}!', { name: 'John' });
      expect(result).toBe('Hello John!');
    });
  });

  describe('validateTemplateVariables', () => {
    it('should return empty array when all variables provided', () => {
      const result = validateTemplateVariables('Hello {{name}}!', { name: 'John' });
      expect(result).toEqual([]);
    });

    it('should return missing variable names', () => {
      const result = validateTemplateVariables('Hello {{name}}!', {});
      expect(result).toEqual(['name']);
    });

    it('should handle multiple missing variables', () => {
      const result = validateTemplateVariables(
        'Hello {{name}}, your order {{order}} is ready.',
        {}
      );
      expect(result).toContain('name');
      expect(result).toContain('order');
    });
  });

  describe('sanitizeHtmlContent', () => {
    it('should remove script tags', () => {
      const result = sanitizeHtmlContent('<script>alert("xss")</script><p>Hello</p>');
      expect(result).not.toContain('<script');
    });

    it('should remove event handlers', () => {
      const result = sanitizeHtmlContent('<p onclick="alert(1)">Click</p>');
      expect(result).not.toContain('onclick');
    });

    it('should preserve safe content', () => {
      const result = sanitizeHtmlContent('<p>Hello <b>World</b></p>');
      expect(result).toContain('Hello');
      expect(result).toContain('World');
    });
  });
});