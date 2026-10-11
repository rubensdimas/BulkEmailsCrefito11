// backend/src/routes/userAdminRoutes.test.ts
import type { NextFunction, Request, Response } from 'express';

const mockService = { list: jest.fn(), createLocal: jest.fn(), updateAccess: jest.fn(), resetPassword: jest.fn() };
jest.mock('../services/userAdminService', () => ({
  ...jest.requireActual('../services/userAdminService'),
  createUserAdminService: () => mockService,
}));
jest.mock('../services/databaseService', () => ({ getUserRepository: jest.fn() }));

import userAdminRoutes from './userAdminRoutes';
import { UserAdminError } from '../services/userAdminService';

type Handler = (request: Request, response: Response, next: NextFunction) => Promise<void>;
interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }

const handler = (method: string, path: string): Handler => {
  const layer = (userAdminRoutes as unknown as { stack: Layer[] }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const mockResponse = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response;
};

const adminRequest = (extra: object = {}) => ({
  auth: { account: { id: 'a', username: 'admin', email: null, oidcSub: null } }, body: {}, params: {}, ...extra,
}) as unknown as Request;

describe('user admin routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists users', async () => {
    mockService.list.mockResolvedValue([{ id: '1' }]);
    const response = mockResponse();
    await handler('get', '/')(adminRequest(), response as unknown as Response, jest.fn());
    expect(response.json).toHaveBeenCalledWith({ success: true, data: [{ id: '1' }] });
  });

  it('creates users with 201 and passes the acting admin', async () => {
    mockService.createLocal.mockResolvedValue({ id: '2' });
    const response = mockResponse();
    await handler('post', '/')(adminRequest({ body: { username: 'joao' } }), response as unknown as Response, jest.fn());
    expect(mockService.createLocal).toHaveBeenCalledWith('admin', { username: 'joao' });
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it('maps domain errors to their status and Portuguese message', async () => {
    mockService.updateAccess.mockRejectedValue(new UserAdminError('last_active_admin', 409, 'Mensagem'));
    const response = mockResponse();
    await handler('patch', '/:id')(adminRequest({ params: { id: 'x' }, body: { role: 'operator' } }), response as unknown as Response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'last_active_admin', message: 'Mensagem' });
  });

  it('forwards unexpected errors', async () => {
    const failure = new Error('db down');
    mockService.resetPassword.mockRejectedValue(failure);
    const next = jest.fn();
    await handler('post', '/:id/password')(adminRequest({ params: { id: 'x' }, body: { password: 'p' } }), mockResponse() as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});
