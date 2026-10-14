// Push copy parity. send-push (Deno) can't import the app, so its copy lives
// in supabase/functions/_shared/notificationCopy.js, generated from the
// catalogues. This suite fails when that file is stale and when the push
// renderer and the in-app renderer disagree for any push type, in en or es.
//
// After changing a notif.* string: UPDATE_NOTIFICATION_COPY=1 npx jest notificationPush
import fs from 'fs';
import path from 'path';
import en from '../../i18n/locales/en';
import es from '../../i18n/locales/es';
import { formatDate } from '../../i18n/format';
import { renderNotification } from '../notificationContent';
import { renderPushText, pushLocale } from '../../../supabase/functions/_shared/notificationRender';

const FUNCTIONS = path.join(__dirname, '../../../supabase/functions');
const COPY_FILE = path.join(FUNCTIONS, '_shared/notificationCopy.js');

const pick = (cat) => Object.fromEntries(Object.keys(cat).filter((k) => k.startsWith('notif.')).sort()
  .map((k) => [k, cat[k]]));
const months = (lang) => Array.from({ length: 12 }, (_, i) => formatDate(new Date(2026, i, 1), 'monthName', lang));

function generated() {
  const copy = { en: pick(en), es: pick(es) };
  const monthNames = { en: months('en'), es: months('es') };
  return `// GENERATED from the notif.* keys of src/i18n/locales/{en,es}/ and the month
// names of src/i18n/format.js. Do not edit: change the catalogue, then run
//   UPDATE_NOTIFICATION_COPY=1 npx jest notificationPush
// (src/lib/__tests__/notificationPush.test.js fails while this file is stale).
export const NOTIFICATION_COPY = ${JSON.stringify(copy, null, 2)};

export const NOTIFICATION_MONTHS = ${JSON.stringify(monthNames, null, 2)};
`;
}

// Every type send-push knows: the keys of its DEEP_LINKS table.
function pushTypes() {
  const src = fs.readFileSync(path.join(FUNCTIONS, 'send-push/index.ts'), 'utf8');
  const table = /const DEEP_LINKS[^\n]*\{\n([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
  return [...table.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}

const FULL = {
  actor_name: 'Pablo', inviter_name: 'Ana', marker_name: 'Javi', owner_name: 'Bea', subject_name: 'Luis',
  spot_name: 'Tío Juan', course_name: 'Golf Olivar', tournament_name: 'Fin de semana', league_name: 'Mulligan',
  month: '2026-10-01', points: 38.5, emoji: '🔥', note: 'Hole 12: should be 5', tournament_id: 't1', round_id: 'r1',
  reason: 'Wrong tees', old: 12.4, proposed: 1234.5, new: 11, tee_time: '2026-10-25T07:00:00Z', role: 'admin',
};
// Payload variants that pick other branches of a renderer.
const VARIANTS = [
  {},
  FULL,
  { ...FULL, course_name: '', month: 'garbage' },
  { ...FULL, month: '2026-01-01', course_name: '' },
  { ...FULL, tournament_id: null, round_id: null },
  { ...FULL, note: null, league_name: null, owner_name: null, reason: null, spot_name: null },
  { ...FULL, you: true },
  { ...FULL, role: 'member', old: null, points: '' },
  { ...FULL, new: null, proposed: null, tee_time: 'nope' },
  { subject_name: 'Luis', old: -0.5 },
];

describe('push copy (supabase/functions/_shared)', () => {
  test('notificationCopy.js is generated from the current catalogues', () => {
    const want = generated();
    if (process.env.UPDATE_NOTIFICATION_COPY) fs.writeFileSync(COPY_FILE, want);
    expect(fs.readFileSync(COPY_FILE, 'utf8')).toBe(want);
  });

  test('every notif.* key has Spanish copy with the same placeholders', () => {
    const e = pick(en);
    const s = pick(es);
    expect(Object.keys(s)).toEqual(Object.keys(e));
    const params = (v) => [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(e)) {
      expect(typeof e[k]).toBe('string');
      expect([k, params(s[k])]).toEqual([k, params(e[k])]);
    }
  });

  test('send-push knows the types; every one renders in en and es with no missing key', () => {
    const types = pushTypes();
    expect(types.length).toBeGreaterThanOrEqual(29);
    for (const type of types) {
      for (const lang of ['en', 'es']) {
        for (const data of VARIANTS) {
          const r = renderPushText(type, data, lang);
          expect([type, lang, r && typeof r.title]).toEqual([type, lang, 'string']);
          expect(`${r.title} ${r.body}`).not.toMatch(/notif\.|\{\w+\}|undefined/);
        }
      }
      const text = (lang) => { const r = renderPushText(type, FULL, lang); return `${r.title} / ${r.body}`; };
      expect([type, text('es')]).not.toEqual([type, text('en')]);
    }
  });

  test('push text matches the in-app inbox for every type, payload and language', () => {
    for (const type of pushTypes()) {
      for (const lang of ['en', 'es']) {
        for (const data of VARIANTS) {
          // post_by: push is Madrid time, the inbox the device zone (below).
          const payload = type === 'league_post_reminder' ? { ...data, post_by: undefined } : data;
          const push = renderPushText(type, payload, lang);
          const inbox = renderNotification(type, payload, lang);
          expect({ type, lang, payload, title: push.title, body: push.body })
            .toEqual({ type, lang, payload, title: inbox.title, body: inbox.body });
        }
      }
    }
  });

  test('the post deadline is Madrid time in both languages', () => {
    const data = { course_name: 'Golf Olivar', league_name: 'Mulligan', post_by: '2026-10-25T16:00:00Z' };
    expect(renderPushText('league_post_reminder', data, 'en').body)
      .toBe("Post your Golf Olivar card by 17:00 or it won't count for Mulligan");
    expect(renderPushText('league_post_reminder', data, 'es').body).toContain('17:00');
  });

  test('Spanish pushes use Spanish months and decimal commas', () => {
    const es1 = renderPushText('league_card_confirmed', { actor_name: 'Pablo', month: '2026-10-01', points: 38.5 }, 'es');
    expect(es1.body).toContain('octubre');
    expect(es1.body).toContain('38,5');
  });

  test('locale: es is Spanish, anything else (NULL, fr, es-ES) is English', () => {
    expect(pushLocale('es')).toBe('es');
    expect(pushLocale('en')).toBe('en');
    expect(pushLocale(null)).toBe('en');
    expect(pushLocale(undefined)).toBe('en');
    expect(pushLocale('fr')).toBe('en');
    expect(renderPushText('friend_request', { actor_name: 'Sam' }, null).title).toBe('New friend request');
    expect(renderPushText('unknown_type', {}, 'es')).toBeNull();
  });
});
