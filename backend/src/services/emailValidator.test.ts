/**
 * Email Validator Tests
 */
import {
  isValidEmail,
  validateEmails,
  validateAndDeduplicate,
} from "./emailValidator";

describe("emailValidator", () => {
  describe("isValidEmail", () => {
    it("should return true for valid email", () => {
      expect(isValidEmail("test@example.com")).toBe(true);
      expect(isValidEmail("user.name@domain.org")).toBe(true);
      expect(isValidEmail("user+tag@example.com")).toBe(true);
    });

    it("should return false for invalid email", () => {
      expect(isValidEmail("test@exemplo")).toBe(false);
      expect(isValidEmail("teste")).toBe(false);
      expect(isValidEmail("@exemplo.com")).toBe(false);
      expect(isValidEmail("test @exemplo.com")).toBe(false);
      expect(isValidEmail("")).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
    });

    it("should handle email with subdomain", () => {
      expect(isValidEmail("user@sub.domain.com")).toBe(true);
      expect(isValidEmail("user@a.b.c.d.example.com")).toBe(false);
    });

    it("should trim whitespace", () => {
      expect(isValidEmail("  test@example.com  ")).toBe(true);
    });
  });

  describe("validateEmails", () => {
    it("should validate array of emails", () => {
      const result = validateEmails([
        "valid@example.com",
        "invalid",
        "another@example.org",
      ]);

      expect(result.valid).toContain("valid@example.com");
      expect(result.valid).toContain("another@example.org");
      expect(result.invalid.length).toBe(1);
      expect(result.invalid[0].email).toBe("invalid");
    });

    it("should convert to lowercase", () => {
      const result = validateEmails(["Test@Example.COM"]);
      expect(result.valid).toContain("test@example.com");
    });
  });

  describe("validateAndDeduplicate", () => {
    it("should remove duplicates", () => {
      const result = validateAndDeduplicate([
        "test@example.com",
        "test@example.com",
        "other@example.com",
        "TEST@example.com",
      ]);

      expect(result.valid.length).toBe(2);
    });

    it("should handle all duplicates", () => {
      const result = validateAndDeduplicate([
        "same@example.com",
        "same@example.com",
        "same@example.com",
      ]);

      expect(result.valid.length).toBe(1);
    });
  });
});
