import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFoundHandler } from './core/errors';
import { apiLimiter, maintenanceGate } from './middleware/security';
import authRouter from './modules/auth';
import meRouter from './modules/me';
import rolesRouter from './modules/roles';
import adminsRouter from './modules/admins';
import membersRouter from './modules/members';
import settingsRouter from './modules/settings';
import { auditRouter, devRouter, publicRouter } from './modules/misc';
import vendorRouter from './modules/vendor';
import adminCatalogRouter, { categoriesPublicRouter } from './modules/admin-catalog';
import adminVendorsRouter from './modules/admin-vendors';
import publicCatalogRouter, { mediaRouter } from './modules/public-catalog';
import { authenticate, requireRole } from './middleware/auth';
import adminMemberExtrasRouter from './modules/admin-member-extras';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind IIS/Nginx in production: trust the first proxy so req.ip is the client address.
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(cors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') {
    app.use(pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      // Method, path and status only: query strings can contain search terms with personal data.
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url.split('?')[0] }),
        res: (res: { statusCode: number }) => ({ status: res.statusCode }),
      },
    }));
  }

  const v1 = Router();
  v1.get('/health', (_req, res) => void res.json({ ok: true }));
  v1.use(apiLimiter, maintenanceGate);
  v1.use('/public', publicRouter);
  v1.use('/dev', devRouter);
  v1.use('/auth', authRouter);
  v1.use('/me', meRouter);
  v1.use('/', rolesRouter); // /permissions and /roles
  v1.use('/super-admin/admins', adminsRouter);
  v1.use('/media', mediaRouter);
  v1.use('/catalog', publicCatalogRouter);
  v1.use('/categories', categoriesPublicRouter);
  v1.use('/vendor', vendorRouter);
  v1.use('/admin/members', adminMemberExtrasRouter, membersRouter);
  const admin = Router();
  admin.use(authenticate, requireRole('admin', 'super_admin'));
  admin.use(adminCatalogRouter);
  admin.use(adminVendorsRouter);
  v1.use('/admin', admin);
  v1.use('/settings', settingsRouter);
  v1.use('/audit', auditRouter);

  app.use('/api/v1', v1);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
