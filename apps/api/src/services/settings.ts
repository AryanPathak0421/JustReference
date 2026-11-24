import {
  authSettingsSchema, commerceSettingsSchema, engagementSettingsSchema, generalSettingsSchema, maintenanceSettingsSchema,
  type AuthSettings, type CommerceSettings, type EngagementSettings, type GeneralSettings, type MaintenanceSettings, type SettingsGroup,
} from '@jr/shared';
import { SettingModel } from '../models/system';

interface SettingsMap {
  general: GeneralSettings;
  auth: AuthSettings;
  maintenance: MaintenanceSettings;
  engagement: EngagementSettings;
  commerce: CommerceSettings;
}

export const SETTINGS_SCHEMAS = { general: generalSettingsSchema, auth: authSettingsSchema, maintenance: maintenanceSettingsSchema, engagement: engagementSettingsSchema, commerce: commerceSettingsSchema };

export const SETTINGS_DEFAULTS: SettingsMap = {
  general: { siteName: 'JustReference', supportEmail: '', supportPhone: '', address: '', social: {} },
  auth: { otpChannel: 'whatsapp', otpTtlMinutes: 5, memberIdPrefix: 'JR' },
  maintenance: { enabled: false, message: 'We’re making some improvements. Please check back shortly.' },
  engagement: { birthdayGreetings: true, birthdayReminders: true, greetingChannel: 'whatsapp' },
  commerce: { unpaidExpiryMinutes: 60, completionBy: 'either', projectRequestsNeedApproval: true },
};

// Settings are read on hot paths (maintenance check on every request), so cache briefly.
const TTL_MS = 5000;
const cache = new Map<SettingsGroup, { at: number; value: unknown }>();

export async function getSettings<G extends SettingsGroup>(group: G): Promise<SettingsMap[G]> {
  const hit = cache.get(group);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingsMap[G];
  const doc = await SettingModel.findOne({ group }).lean();
  const value = { ...SETTINGS_DEFAULTS[group], ...(doc?.value ?? {}) } as SettingsMap[G];
  cache.set(group, { at: Date.now(), value });
  return value;
}

export async function saveSettings<G extends SettingsGroup>(group: G, value: SettingsMap[G], actorId: string) {
  await SettingModel.findOneAndUpdate({ group }, { value, updatedBy: actorId }, { upsert: true });
  cache.delete(group);
}

export function clearSettingsCache() {
  cache.clear();
}
