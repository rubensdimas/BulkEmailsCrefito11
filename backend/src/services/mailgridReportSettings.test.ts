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
    expect(validateMailgridReportSettings(DEFAULT_MAILGRID_REPORT_SETTINGS)).toEqual({ enabled: true, time: '03:00', windowHours: 48 });
    expect(() => validateMailgridReportSettings({ enabled: true, time: '24:00', windowHours: 48 }))
      .toThrow(expect.objectContaining({ code: 'invalid_settings', field: 'time' }));
    for (const windowHours of [0, 169, 1.5, '48']) {
      expect(() => validateMailgridReportSettings({ enabled: true, time: '03:00', windowHours }))
        .toThrow(expect.objectContaining({ field: 'windowHours' }));
    }
    expect(() => validateMailgridReportSettings({ enabled: 'yes', time: '03:00', windowHours: 48 }))
      .toThrow(expect.objectContaining({ field: 'enabled' }));
  });

  it('getMailgridReportSettings returns defaults when key absent', async () => {
    await expect(getMailgridReportSettings(repoWith())).resolves.toEqual(DEFAULT_MAILGRID_REPORT_SETTINGS);
    await expect(getMailgridReportSettings(repoWith({ enabled: false, time: '04:30', windowHours: 24 })))
      .resolves.toEqual({ enabled: false, time: '04:30', windowHours: 24 });
  });

  it('saveMailgridReportSettings stores the value and reports changed field names', async () => {
    const repo = repoWith();
    const result = await saveMailgridReportSettings(repo, { enabled: true, time: '04:30', windowHours: 24 });
    expect(repo.set).toHaveBeenCalledWith({ key: MAILGRID_REPORT_SETTINGS_KEY, value: { enabled: true, time: '04:30', windowHours: 24 } });
    expect(result.changedFields).toEqual(['time', 'windowHours']);
  });
});
