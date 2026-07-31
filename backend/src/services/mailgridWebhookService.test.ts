import {
  isMailgridWebhookPayload,
  parseMailgridDate,
  toMailgridWebhookUpdate,
} from './mailgridWebhookService';
import { shouldApplyMailgridWebhookEvent } from '../models/EmailLog';

describe('mailgridWebhookService', () => {
  it.each([
    [0, 'hard_bounce'],
    [1, 'delivered'],
    [2, 'soft_bounce'],
  ] as const)('maps Mailgrid status %s to %s', (status, expected) => {
    const payload = { msgid: 'message-1', status, mensagem: 'provider response' };
    expect(isMailgridWebhookPayload(payload)).toBe(true);
    expect(toMailgridWebhookUpdate(payload).status).toBe(expected);
  });

  it('rejects unsupported payloads', () => {
    expect(isMailgridWebhookPayload({ msgid: '', status: 1 })).toBe(false);
    expect(isMailgridWebhookPayload({ msgid: 'message-1', status: 3 })).toBe(false);
    expect(isMailgridWebhookPayload({ msgid: 'message-1', status: '1' })).toBe(false);
  });

  it('parses Mailgrid dates and preserves invalid dates as null', () => {
    expect(parseMailgridDate('2025-08-25 14:05:41')).toBeInstanceOf(Date);
    expect(parseMailgridDate('invalid')).toBeNull();
  });

  it('ignores older or undated events after a dated event was stored', () => {
    const current = new Date('2025-08-25T14:05:41Z');
    expect(shouldApplyMailgridWebhookEvent(current, new Date('2025-08-25T14:05:40Z'))).toBe(false);
    expect(shouldApplyMailgridWebhookEvent(current, null)).toBe(false);
    expect(shouldApplyMailgridWebhookEvent(current, new Date('2025-08-25T14:05:42Z'))).toBe(true);
  });
});
