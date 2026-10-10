import { request as httpRequest } from 'http';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { User } from './repositories/userRepository';

const mockAccounts = new Map<string, User>();
const mockSessionValues = new Map<string, string>();
const mockJobRepository = { findAll: jest.fn(async () => []), count: jest.fn(async () => 0) };
const mockConfigService = { getMailgridConfig: jest.fn(async () => ({ host: 'mail.example', user: 'sender', pass: 'secret', from_address: 'sender@example.test', from_name: 'BulkMail', webhook_token: 'secret' })) };
const mockRedis = {
  get: async (key: string) => mockSessionValues.get(key) ?? null,
  set: async (key: string, value: string) => { mockSessionValues.set(key, value); return 'OK'; },
  del: async (key: string) => Number(mockSessionValues.delete(key)),
  sadd: async () => 1,
  expire: async () => 1,
};
jest.mock('./config/redis', () => ({ getRedisClient: () => mockRedis }));
jest.mock('./services/databaseService', () => ({
  getUserRepository: () => ({ findById: async (id: string) => mockAccounts.get(id) ?? null }),
  getJobRepository: () => mockJobRepository,
  getEmailLogRepository: () => ({}),
  getConfigService: () => mockConfigService,
  isDatabaseReady: () => true,
}));

import app from './app';
import { createLocalSession } from './services/authSessionService';
import { SESSION_COOKIE } from './middlewares/authentication';

interface HttpResult { status: number; body: Record<string, unknown> }
let server: Server;
const tokens = new Map<string, string>();
const request = (path: string, account?: string, method = 'GET'): Promise<HttpResult> => new Promise((resolve, reject) => {
  const address = server.address() as AddressInfo;
  const req = httpRequest({ host: '127.0.0.1', port: address.port, path, method, headers: { Origin: 'https://app.example', ...(account ? { Cookie: `${SESSION_COOKIE}=${tokens.get(account)}` } : {}) } }, response => {
    let data = '';
    response.setEncoding('utf8');
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(data) as Record<string, unknown> }));
  });
  req.on('error', reject); req.end();
});

beforeAll(async () => {
  process.env.APP_ORIGIN = 'https://app.example';
  for (const [id, role, mustChangePassword] of [
    ['admin', 'admin', false], ['operator', 'operator', false], ['forced', 'admin', true],
  ] as const) {
    mockAccounts.set(id, { id, role, mustChangePassword, provider: 'local', username: id, credentialVersion: 0, disabledAt: null, name: null, email: null, oidcSub: null, oidcIssuer: null, passwordHash: 'not-exposed', lastLoginAt: null });
    tokens.set(id, await createLocalSession({ sub: `local:${id}`, name: id }, id, 0));
  }
  server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
});
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => jest.clearAllMocks());

describe('actual application authentication route mounting', () => {
  it.each(['admin', 'operator'])('allows %s to reach the operational jobs handler', async account => {
    const response = await request('/api/jobs', account);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: [] });
    expect(mockJobRepository.findAll).toHaveBeenCalledTimes(1);
  });
  it('denies operator access to configuration before its handler', async () => {
    const response = await request('/api/config/mailgrid', 'operator');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'forbidden' });
    expect(mockConfigService.getMailgridConfig).not.toHaveBeenCalled();
  });
  it('allows administrators to reach the real configuration handler', async () => {
    const response = await request('/api/config/mailgrid', 'admin');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { host: 'mail.example', pass: '' } });
    expect(mockConfigService.getMailgridConfig).toHaveBeenCalledTimes(1);
  });
  it.each(['/api/jobs', '/api/config/mailgrid'])('returns 401 without a session on %s', async path => {
    const response = await request(path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, error: 'Authentication required' });
  });
  it.each(['/api/jobs', '/api/status', '/api/upload', '/api/send', '/api/config/mailgrid'])('blocks forced password changes across %s', async path => {
    const response = await request(path, 'forced');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: false, error: 'password_change_required' });
    expect(mockJobRepository.findAll).not.toHaveBeenCalled();
    expect(mockConfigService.getMailgridConfig).not.toHaveBeenCalled();
  });
  it('keeps account inspection accessible during a required password change', async () => {
    const response = await request('/api/auth/me', 'forced');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { userId: 'forced', mustChangePassword: true } });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('credentialVersion');
  });
  it('keeps authentication logout accessible during a required password change', async () => {
    const response = await request('/api/auth/logout', 'forced', 'POST');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, logoutUrl: null });
  });
});
