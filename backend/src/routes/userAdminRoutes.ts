import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../middlewares/authentication';
import { getUserRepository } from '../services/databaseService';
import { hashPassword, verifyPassword } from '../services/passwordHasher';
import { revokeLocalUserSessions } from '../services/authSessionService';
import { logSettingsChange } from '../services/settingsAudit';
import { accountLabel, createUserAdminService, UserAdminError } from '../services/userAdminService';

export const handleUserAdmin = (operation: (request: AuthenticatedRequest, response: Response) => Promise<void>) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try { await operation(request as AuthenticatedRequest, response); }
    catch (error) {
      if (error instanceof UserAdminError) {
        response.status(error.status).json({ success: false, error: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };
export const userAdminService = () => createUserAdminService({
  users: getUserRepository(), hash: hashPassword, verify: verifyPassword,
  revokeSessions: revokeLocalUserSessions, audit: logSettingsChange,
});
const actor = (request: AuthenticatedRequest): string => accountLabel(request.auth!.account);
export const createUserAdminRouter = (): Router => {
  const router = Router();
  router.get('/', handleUserAdmin(async (_request, response) => {
    response.json({ success: true, data: await userAdminService().list() });
  }));
  router.post('/', handleUserAdmin(async (request, response) => {
    const data = await userAdminService().createLocal(actor(request), request.body ?? {});
    response.status(201).json({ success: true, data });
  }));
  router.patch('/:id', handleUserAdmin(async (request, response) => {
    const data = await userAdminService().updateAccess(actor(request), request.params.id, request.body ?? {});
    response.json({ success: true, data });
  }));
  router.post('/:id/password', handleUserAdmin(async (request, response) => {
    await userAdminService().resetPassword(actor(request), request.params.id, request.body?.password);
    response.json({ success: true });
  }));
  return router;
};
export default createUserAdminRouter();
