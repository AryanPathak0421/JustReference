import { ProfileModel } from '../models/member';
import { UserModel } from '../models/user';
import { MemberModel } from '../models/member';
import { JobRunModel } from '../models/referral';
import { logger } from '../config/logger';
import { getSettings } from './settings';
import { messaging } from './messaging';
import { istToday } from './referrals';

/**
 * Daily birthday job (brief §9 "birthday reminders and birthday greetings"):
 * - greets each active member on their birthday (once per year), via the configured channel;
 * - reminds their direct sponsor that it's their referral's birthday.
 * A JobRun lock keyed by date makes it safe to run from several servers or more than once a day.
 */
export async function runBirthdayJob(now = new Date()) {
  const t = istToday(now);
  const key = `birthday:${t.iso}`;
  try {
    await JobRunModel.create({ key });
  } catch {
    return { skipped: true as const, greeted: 0, reminded: 0 };
  }
  const settings = await getSettings('engagement');
  const { siteName } = await getSettings('general');
  const md = t.iso.slice(5);
  const isLeap = new Date(Date.UTC(t.year, 1, 29)).getUTCMonth() === 1;
  const mds = md === '02-28' && !isLeap ? ['02-28', '02-29'] : [md];

  let greeted = 0;
  let reminded = 0;
  const profiles = await ProfileModel.find({ dobMD: { $in: mds }, birthdayGreetedYear: { $ne: t.year } }, { userId: 1 }).lean();
  for (const p of profiles) {
    const user = await UserModel.findOne({ _id: p.userId, status: 'active' }, { name: 1, mobile: 1, email: 1 }).lean();
    if (!user) continue;
    const first = user.name.split(' ')[0];
    if (settings.birthdayGreetings) {
      const to = settings.greetingChannel === 'email' ? user.email : user.mobile;
      await messaging.send({ channel: settings.greetingChannel, to, subject: `Happy birthday from ${siteName}!`, text: `Happy birthday, ${first}! 🎂 Wishing you a wonderful year ahead. — Team ${siteName}` });
      greeted++;
    }
    if (settings.birthdayReminders) {
      const member = await MemberModel.findOne({ userId: user._id }, { sponsorUserId: 1, memberId: 1 }).lean();
      const sponsor = member?.sponsorUserId ? await UserModel.findOne({ _id: member.sponsorUserId, status: 'active' }, { name: 1, mobile: 1, email: 1 }).lean() : null;
      if (sponsor) {
        const to = settings.greetingChannel === 'email' ? sponsor.email : sponsor.mobile;
        await messaging.send({ channel: settings.greetingChannel, to, subject: 'A birthday in your network', text: `Today is ${user.name}'s birthday (${member!.memberId}). Send them your wishes! — ${siteName}` });
        reminded++;
      }
    }
    await ProfileModel.updateOne({ _id: p._id }, { birthdayGreetedYear: t.year });
  }
  await JobRunModel.updateOne({ key }, { finishedAt: new Date(), result: { greeted, reminded } });
  logger.info({ greeted, reminded }, 'Birthday job finished');
  return { skipped: false as const, greeted, reminded };
}

/** Run the job each day once it's past 09:00 IST; checks every 15 minutes. */
export function scheduleBirthdayJob() {
  const tick = () => {
    const hourIst = (new Date().getUTCHours() + 5.5) % 24;
    if (hourIst >= 9) runBirthdayJob().catch((err) => logger.error({ err }, 'Birthday job failed'));
  };
  tick();
  return setInterval(tick, 15 * 60_000).unref();
}
