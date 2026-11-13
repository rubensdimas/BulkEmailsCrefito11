import {
  DEFAULT_MAILGRID_REPORT_SETTINGS,
  MAILGRID_REPORT_SETTINGS_KEY,
  getMailgridReportSettings,
  saveMailgridReportSettings,
  validateMailgridReportSettings,
} from './mailgridReportSettings';

const repoWith = (value?: unknown) => ({
  getByKey: jest.fn().mockResolvedValue(value === undefined ? null : { key: MAILGRID_REPORT_SETTINGS_KEY, value }),
  set: jest.fn().mockResolvedValue(undefined),
});

describe('mailgridReportSettings', () => {
  it("rejects '24:00' and windowHours 0/169, accepts defaults", () => {
    expect(validateMailgridReportSettings(DEFAULT_MAILGRID_REPORT_SETTINGS)).toEqual({ enabled: true, mode: 'daily', time: '03:00', intervalMinutes: 5, windowHours: 48 });
    expect(() => validateMailgridReportSettings({ enabled: true, time: '24:00', windowHours: 48 }))
      .toThrow(expect.objectContaining({ code: 'invalid_settings', field: 'time' }));
    for (const windowHours of [0, 169, 1.5, '48']) {
      expect(() => validateMailgridReportSettings({ enabled: true, time: '03:00', windowHours }))
        .toThrow(expect.objectContaining({ field: 'windowHours' }));
    }
    expect(() => validateMailgridReportSettings({ enabled: 'yes', time: '03:00', windowHours: 48 }))
      .toThrow(expect.objectContaining({ field: 'enabled' }));
  });

  it('accepts interval mode with an allowed interval and rejects others', () => {
    expect(validateMailgridReportSettings({ enabled: true, mode: 'interval', time: '03:00', intervalMinutes: 5, windowHours: 2 }))
      .toEqual({ enabled: true, mode: 'interval', time: '03:00', intervalMinutes: 5, windowHours: 2 });
    for (const intervalMinutes of [7, 0, 120, '5']) {
      expect(() => validateMailgridReportSettings({ enabled: true, mode: 'interval', time: '03:00', intervalMinutes, windowHours: 2 }))
        .toThrow(expect.objectContaining({ code: 'invalid_settings', field: 'intervalMinutes' }));
    }
    expect(() => validateMailgridReportSettings({ enabled: true, mode: 'weekly', time: '03:00', intervalMinutes: 5, windowHours: 2 }))
      .toThrow(expect.objectContaining({ field: 'mode' }));
  });

  it('getMailgridReportSettings returns defaults when key absent', async () => {
    await expect(getMailgridReportSettings(repoWith())).resolves.toEqual(DEFAULT_MAILGRID_REPORT_SETTINGS);
    await expect(getMailgridReportSettings(repoWith({ enabled: false, time: '04:30', windowHours: 24 })))
      .resolves.toEqual({ enabled: false, mode: 'daily', time: '04:30', intervalMinutes: 5, windowHours: 24 });
  });

  it('saveMailgridReportSettings stores the value and reports changed field names', async () => {
    const repo = repoWith();
    const result = await saveMailgridReportSettings(repo, { enabled: true, time: '04:30', windowHours: 24 });
    expect(repo.set).toHaveBeenCalledWith({ key: MAILGRID_REPORT_SETTINGS_KEY, value: { enabled: true, mode: 'daily', time: '04:30', intervalMinutes: 5, windowHours: 24 } });
    expect(result.changedFields).toEqual(['time', 'windowHours']);
    const switched = await saveMailgridReportSettings(repoWith({ enabled: true, time: '04:30', windowHours: 24 }),
      { enabled: true, mode: 'interval', time: '04:30', intervalMinutes: 10, windowHours: 2 });
    expect(switched.changedFields).toEqual(['mode', 'intervalMinutes', 'windowHours']);
  });
});
