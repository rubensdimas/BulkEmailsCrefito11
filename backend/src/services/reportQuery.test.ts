import { REPORT_PAGE_SIZE, ReportQueryError, csvSafe, parseReportQuery } from './reportQuery';

const now = new Date('2026-11-12T15:00:00Z');

describe('parseReportQuery', () => {
  it('defaults to last 7 days, page 1 and 50 per page', () => {
    expect(parseReportQuery({}, now)).toEqual({
      from: new Date('2026-11-05T15:00:00Z'), to: now, page: 1, pageSize: REPORT_PAGE_SIZE,
    });
    expect(REPORT_PAGE_SIZE).toBe(50);
  });

  it("rejects from > to with field 'from'", () => {
    expect(() => parseReportQuery({ from: '2026-11-12T00:00:00-03:00', to: '2026-11-11T00:00:00-03:00' }, now))
      .toThrow(expect.objectContaining({ field: 'from' }));
    expect(() => parseReportQuery({ to: 'ontem' }, now)).toThrow(ReportQueryError);
  });

  it('rejects unknown tipoStatus and accepts the known ones', () => {
    expect(() => parseReportQuery({ tipoStatus: 'Aceita,Talvez' }, now)).toThrow(expect.objectContaining({ field: 'tipoStatus' }));
    expect(parseReportQuery({ tipoStatus: 'Aceita,Hard Bounce' }, now).tipoStatus).toEqual(['Aceita', 'Hard Bounce']);
  });

  it("local 23:59 'to' includes 23:30 event stored as 02:30Z next day", () => {
    const query = parseReportQuery({ from: '2026-11-11T00:00:00-03:00', to: '2026-11-11T23:59:59-03:00' }, now);
    expect(query.to.getTime()).toBeGreaterThanOrEqual(new Date('2026-11-12T02:30:00Z').getTime());
  });

  it('trims text filters, drops empty ones, caps length and clamps page', () => {
    const query = parseReportQuery({ recipient: '  a@b.com ', sender: '   ', subject: 'x'.repeat(400), page: '0', senderHost: 'prd-crefito-8' }, now);
    expect(query).toMatchObject({ recipient: 'a@b.com', page: 1, senderHost: 'prd-crefito-8' });
    expect(query.sender).toBeUndefined();
    expect(query.subject).toHaveLength(254);
    expect(parseReportQuery({ page: '3' }, now).page).toBe(3);
  });
});

describe('csvSafe', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(csvSafe('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    for (const prefix of ['+', '-', '@', '\t', '\r']) expect(csvSafe(`${prefix}1`).startsWith("'")).toBe(true);
    expect(csvSafe('normal')).toBe('normal');
    expect(csvSafe(null)).toBe('');
  });
});
