import { Router } from 'express';
import { z } from 'zod';
import { SETTINGS_GROUPS, type SettingsGroup } from '@jr/shared';
import { authenticate, requirePermission, requireRecentAuth, requireRole } from '../middleware/auth';
import { forbidden } from '../core/errors';
import { parse } from '../core/http';
import { getSettings, saveSettings, SETTINGS_SCHEMAS } from '../services/settings';
import { audit } from '../services/audit';

const router = Router();
router.use(authenticate, requireRole('admin', 'super_admin'));

const groupParam = z.enum(SETTINGS_GROUPS);

router.get('/:group', requirePermission('settings.view'), async (req, res) => {
  const group = parse(groupParam, req.params.group);
  res.json(await getSettings(group));
});

router.put('/:group', async (req, res) => {
  const group: SettingsGroup = parse(groupParam, req.params.group);
  const needed = group === 'maintenance' ? 'maintenance.manage' : group === 'wallet' || group === 'earnings' ? 'money.manage' : 'settings.edit';
  if (!req.auth!.permissions.has(needed)) throw forbidden('You don’t have permission to change these settings', 'FORBIDDEN', { missing: [needed] });

  if (needed === 'money.manage') await new Promise<void>((ok, no) => requireRecentAuth(req, res, (e?: unknown) => (e ? no(e) : ok())));

  const value = parse(SETTINGS_SCHEMAS[group], req.body);
  const before = (await getSettings(group)) as Record<string, unknown>;
  await saveSettings(group, value as never, req.auth!.user.id);
  const changed = Object.keys(value).filter((k) => JSON.stringify(before[k]) !== JSON.stringify((value as Record<string, unknown>)[k]));

  const summary = group === 'maintenance'
    ? `Turned maintenance mode ${(value as { enabled: boolean }).enabled ? 'ON' : 'OFF'}`
    : `Updated ${group} settings${changed.length ? `: ${changed.join(', ')}` : ''}`;
  await audit(req, { action: `settings.${group}`, entity: 'settings', entityId: group, summary, meta: { changed } });
  res.json(await getSettings(group));
});

export default router;
