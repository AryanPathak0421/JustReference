import {
  authSettingsSchema, commerceSettingsSchema, earningsSettingsSchema, engagementSettingsSchema, generalSettingsSchema, maintenanceSettingsSchema, NOTIFICATION_EVENTS, notificationSettingsSchema, walletSettingsSchema,
  type AuthSettings, type CommerceSettings, type EarningsSettings, type NotificationSettings, type WalletSettings, type EngagementSettings, type GeneralSettings, type MaintenanceSettings, type SettingsGroup,
} from '@jr/shared';
import { SettingModel } from '../models/system';

interface SettingsMap {
  general: GeneralSettings;
  auth: AuthSettings;
  maintenance: MaintenanceSettings;
  engagement: EngagementSettings;
  commerce: CommerceSettings;
  wallet: WalletSettings;
  earnings: EarningsSettings;
  notifications: NotificationSettings;
}

export const SETTINGS_SCHEMAS = { general: generalSettingsSchema, auth: authSettingsSchema, maintenance: maintenanceSettingsSchema, engagement: engagementSettingsSchema, commerce: commerceSettingsSchema, wallet: walletSettingsSchema, earnings: earningsSettingsSchema, notifications: notificationSettingsSchema };

export const SETTINGS_DEFAULTS: SettingsMap = {
  general: { siteName: 'JustReference', supportEmail: '', supportPhone: '', address: '', social: {} },
  auth: { otpChannel: 'whatsapp', otpTtlMinutes: 5, memberIdPrefix: 'JR' },
  maintenance: { enabled: false, message: 'We’re making some improvements. Please check back shortly.' },
  engagement: { birthdayGreetings: true, birthdayReminders: true, greetingChannel: 'whatsapp' },
  commerce: { unpaidExpiryMinutes: 60, completionBy: 'either', projectRequestsNeedApproval: true },
  // Nothing that moves money is on until a Super Admin decides the values.
  wallet: { topUpEnabled: false, topUpMinPaise: 0, topUpMaxPaise: 0, transferEnabled: false, transferMaxPaise: 0, withdrawEnabled: false, withdrawMinPaise: 0, withdrawFeePaise: 0, withdrawRequiresKyc: true, memberEpinEnabled: false },
  earnings: { platformFeePct: null, settlementHoldDays: 0, commissionHoldDays: 0, tdsEnabled: false, tdsRatePct: 0, tdsNoPanRatePct: 0, tdsThresholdPaise: 0, tdsOnRewards: false },
  // In-app notifications always work; outside channels are off until chosen.
  notifications: { events: Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, { email: false, sms: false, whatsapp: false }])) as NotificationSettings['events'], template: 'Hi {name}, {title}. {body} {link} - {site}', emailSubject: '{title} | {site}' },
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
