import type { SystemConfigRepository } from '../repositories/systemConfigRepository';

export const MAILGRID_REPORT_SETTINGS_KEY = 'mailgrid_report_schedule';

export const MAILGRID_REPORT_INTERVALS = [5, 10, 15, 30, 60] as const;

export interface MailgridReportSettings {
  enabled: boolean;
  /** daily: once at `time`; interval: every `intervalMinutes`. */
  mode: 'daily' | 'interval';
  /** Daily run time in São Paulo, HH:MM. */
  time: string;
  intervalMinutes: number;
  windowHours: number;
}

export const DEFAULT_MAILGRID_REPORT_SETTINGS: MailgridReportSettings = {
  enabled: true, mode: 'daily', time: '03:00', intervalMinutes: 5, windowHours: 48,
};

export class MailgridReportSettingsError extends Error {
  readonly code = 'invalid_settings';
  constructor(readonly field: keyof MailgridReportSettings, message: string) {
    super(message);
    this.name = 'MailgridReportSettingsError';
  }
}

type SettingsStore = Pick<SystemConfigRepository, 'getByKey' | 'set'>;

export const validateMailgridReportSettings = (input: unknown): MailgridReportSettings => {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean') throw new MailgridReportSettingsError('enabled', 'Informe se a rotina está ativa.');
  // Settings saved before Story 5.3 have no mode/interval and stay daily.
  const mode = value.mode ?? 'daily';
  if (mode !== 'daily' && mode !== 'interval') throw new MailgridReportSettingsError('mode', 'Frequência inválida.');
  const intervalMinutes = value.intervalMinutes ?? DEFAULT_MAILGRID_REPORT_SETTINGS.intervalMinutes;
  if (typeof intervalMinutes !== 'number' || !(MAILGRID_REPORT_INTERVALS as readonly number[]).includes(intervalMinutes)) {
    throw new MailgridReportSettingsError('intervalMinutes', 'Intervalo inválido. Use 5, 10, 15, 30 ou 60 minutos.');
  }
  if (typeof value.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) {
    throw new MailgridReportSettingsError('time', 'Horário inválido. Use HH:MM.');
  }
  const { windowHours } = value;
  if (typeof windowHours !== 'number' || !Number.isInteger(windowHours) || windowHours < 1 || windowHours > 168) {
    throw new MailgridReportSettingsError('windowHours', 'A janela deve ser um número inteiro de 1 a 168 horas.');
  }
  return { enabled: value.enabled, mode, time: value.time, intervalMinutes, windowHours };
};

export const getMailgridReportSettings = async (repo: SettingsStore): Promise<MailgridReportSettings> => {
  const stored = await repo.getByKey(MAILGRID_REPORT_SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_MAILGRID_REPORT_SETTINGS };
  try {
    return validateMailgridReportSettings(stored.value);
  } catch {
    return { ...DEFAULT_MAILGRID_REPORT_SETTINGS };
  }
};

export const saveMailgridReportSettings = async (
  repo: SettingsStore, input: unknown,
): Promise<{ settings: MailgridReportSettings; changedFields: string[] }> => {
  const settings = validateMailgridReportSettings(input);
  const previous = await getMailgridReportSettings(repo);
  await repo.set({ key: MAILGRID_REPORT_SETTINGS_KEY, value: { ...settings } });
  const changedFields = (Object.keys(settings) as Array<keyof MailgridReportSettings>)
    .filter((field) => settings[field] !== previous[field]);
  return { settings, changedFields };
};
