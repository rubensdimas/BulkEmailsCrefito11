/**
 * Email Extractor Tests
 */
import { findEmailColumn, extractEmails, getColumns } from './emailExtractor';

describe('emailExtractor', () => {
  describe('findEmailColumn', () => {
    it('should find email column', () => {
      const headers = ['name', 'email', 'phone'];
      expect(findEmailColumn(headers)).toBe(1);
    });

    it('should find e-mail column', () => {
      const headers = ['name', 'e-mail', 'phone'];
      expect(findEmailColumn(headers)).toBe(1);
    });

    it('should find mail column', () => {
      const headers = ['name', 'mail', 'phone'];
      expect(findEmailColumn(headers)).toBe(1);
    });

    it('should find endereco_email column', () => {
      const headers = ['name', 'endereco_email', 'phone'];
      expect(findEmailColumn(headers)).toBe(1);
    });

    it('should find email_address column', () => {
      const headers = ['name', 'email_address', 'phone'];
      expect(findEmailColumn(headers)).toBe(1);
    });

    it('should return -1 if no email column found', () => {
      const headers = ['name', 'phone', 'address'];
      expect(findEmailColumn(headers)).toBe(-1);
    });

    it('should handle empty array', () => {
      expect(findEmailColumn([])).toBe(-1);
    });
  });

  describe('extractEmails', () => {
    it('should extract emails from detected column', () => {
      const data = [
        { name: 'John', email: 'john@example.com' },
        { name: 'Jane', email: 'jane@example.com' },
      ];
      const headers = ['name', 'email'];

      const result = extractEmails(data, headers);
      expect(result).toEqual(['john@example.com', 'jane@example.com']);
    });

    it('should use first column as fallback', () => {
      const data = [
        { first: 'john@example.com' },
        { first: 'jane@example.com' },
      ];
      const headers = ['first', 'last'];

      const result = extractEmails(data, headers);
      expect(result).toEqual(['john@example.com', 'jane@example.com']);
    });

    it('should filter out null/undefined values', () => {
      const data = [
        { email: 'valid@example.com' },
        { email: null },
        { email: undefined },
        { email: '' },
      ];
      const headers = ['email'];

      const result = extractEmails(data, headers);
      expect(result).toEqual(['valid@example.com']);
    });

    it('should return empty array for empty data', () => {
      const result = extractEmails([], ['email']);
      expect(result).toEqual([]);
    });
  });

  describe('getColumns', () => {
    it('should return column names', () => {
      const data = [{ name: 'John', email: 'john@example.com' }];
      expect(getColumns(data)).toEqual(['name', 'email']);
    });

    it('should return empty array for empty data', () => {
      expect(getColumns([])).toEqual([]);
    });
  });
});