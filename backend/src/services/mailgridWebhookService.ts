import { EmailLogStatus, MailgridWebhookUpdate } from '../models/EmailLog';

export interface MailgridWebhookPayload extends Record<string, unknown> {
  msgid: string;
  status: 0 | 1 | 2;
  email_de?: string;
  email_para?: string;
  mensagem?: string;
  data_envio?: string;
  data_entrega?: string;
  sender?: string;
  sender_ip?: string;
  sender_host?: string;
  delivery_ip?: string;
  delivery_host?: string;
  size?: string;
}

const STATUS_MAP: Record<MailgridWebhookPayload['status'], MailgridWebhookUpdate['status']> = {
  0: 'hard_bounce',
  1: 'delivered',
  2: 'soft_bounce',
};

export const isMailgridWebhookPayload = (value: unknown): value is MailgridWebhookPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.msgid === 'string' &&
    payload.msgid.trim().length > 0 &&
    typeof payload.status === 'number' &&
    [0, 1, 2].includes(payload.status)
  );
};

export const parseMailgridDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value.trim().replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const toMailgridWebhookUpdate = (
  payload: MailgridWebhookPayload,
  receivedAt: Date = new Date()
): MailgridWebhookUpdate => ({
  status: STATUS_MAP[payload.status],
  statusCode: payload.status,
  statusMessage: typeof payload.mensagem === 'string' ? payload.mensagem : null,
  sentAt: parseMailgridDate(payload.data_envio),
  eventAt: parseMailgridDate(payload.data_entrega),
  receivedAt,
  payload,
});

export const getDeliveryStatusLabel = (status: EmailLogStatus): string => {
  switch (status) {
    case 'sent': return 'Enviado';
    case 'delivered': return 'Entregue';
    case 'soft_bounce': return 'Soft bounce';
    case 'hard_bounce': return 'Hard bounce';
    case 'processing': return 'Processando';
    case 'failed': return 'Falha no envio';
    case 'bounced': return 'Bounce';
    default: return 'Pendente';
  }
};
