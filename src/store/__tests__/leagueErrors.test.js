import fs from 'fs';
import path from 'path';
import { leagueErrorDescriptor, KNOWN_HINTS } from '../leagueErrors';
import { LeagueError, toLeagueError, OFFLINE_MESSAGE, LEAGUE_GONE_MESSAGE } from '../leagueStore';
import { leagueErrorText } from '../../lib/leagueErrorText';
import { setLanguagePref } from '../../i18n';
import en from '../../i18n/locales/en/leagueErrors';

jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn(), auth: { getUser: jest.fn() } } }));

// Functions in those migrations that are not league functions (their errors
// never reach leagueErrorText).
const NOT_LEAGUE = new Set(['set_my_locale', 'start_swing_share']);

// Every RAISE EXCEPTION in the latest definition of each league function,
// with its hint and a sample of what %-placeholders become.
function serverRaises() {
  const dir = path.join(__dirname, '../../../supabase/migrations');
  const defs = {};
  for (const f of fs.readdirSync(dir).filter((x) => x >= '20261004').sort()) {
    const parts = fs.readFileSync(path.join(dir, f), 'utf8').split(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_0-9]+)\s*\(/i);
    for (let i = 1; i < parts.length; i += 2) if (!NOT_LEAGUE.has(parts[i])) defs[parts[i]] = parts[i + 1];
  }
  const out = [];
  for (const body of Object.values(defs)) {
    for (const m of body.matchAll(/RAISE\s+EXCEPTION\s+'((?:[^']|'')*)'([\s\S]*?);/gi)) {
      const hint = /HINT\s*=\s*'([a-z_]+)'/i.exec(m[2])?.[1] ?? null;
      out.push({ hint, message: m[1].replace(/''/g, "'") });
    }
  }
  return out;
}

// Server messages that are developer errors or belong to the anon marker page.
const UNMAPPED = [/^Unknown (card source|proof kind) %$/, /^Extra strokes must be/, /^An app card needs its game/,
  /^(invalid|used|expired|changed)$/];

const SAMPLES = {
  card_exists: 'You already have your October card.',
  month_closed: 'October is closed: its cards can\'t change any more.',
  month_change: 'This is your October card. The new tee time has to stay in October.',
  last_admin: "Nacho is the league's only admin. Make someone else admin first.",
  already_member: "You are already in this league, so you can't take Javi's spot.",
  outside_season: 'That date is outside the season (2026-01-01 to 2026-12-31).',
};

afterEach(() => setLanguagePref('en'));

describe('leagueErrorDescriptor', () => {
  test('every server refusal of a league function maps to a catalogue key', () => {
    const raises = serverRaises();
    expect(raises.length).toBeGreaterThan(60);
    const missing = raises
      .filter((r) => !UNMAPPED.some((re) => re.test(r.message)))
      .filter((r) => !r.message.includes('%'))
      .filter((r) => !leagueErrorDescriptor(r.message, r.hint))
      .map((r) => r.message);
    expect(missing).toEqual([]);
    // Every hint the server raises is known.
    const hints = new Set(raises.map((r) => r.hint).filter(Boolean));
    expect([...hints].filter((h) => !KNOWN_HINTS.includes(h))).toEqual([]);
  });

  test('the English text is the server sentence, so English shows exactly what the server said', async () => {
    for (const { hint, message } of serverRaises()) {
      if (message.includes('%') || UNMAPPED.some((re) => re.test(message))) continue;
      expect(leagueErrorText(new LeagueError(message, { hint }))).toBe(message);
    }
    for (const [hint, message] of Object.entries(SAMPLES)) {
      if (hint === 'outside_season') continue; // dates are formatted
      expect(leagueErrorText(new LeagueError(message, { hint }))).toBe(message);
    }
  });

  test('every hint resolves to Spanish text different from English', async () => {
    const raises = serverRaises().filter((r) => r.hint && !r.message.includes('%'));
    await setLanguagePref('es');
    for (const { hint, message } of raises) {
      const text = leagueErrorText(new LeagueError(message, { hint }));
      expect(text).not.toBe(message);
      expect(text).not.toMatch(/^league\./);
    }
    for (const [hint, message] of Object.entries(SAMPLES)) {
      const text = leagueErrorText(new LeagueError(message, { hint }));
      expect(text).not.toBe(message);
    }
  });

  test('parameters are read from the server text', async () => {
    expect(leagueErrorDescriptor(SAMPLES.card_exists, 'card_exists'))
      .toEqual({ key: 'league.error.cardExists', params: { monthKey: '2000-10' } });
    expect(leagueErrorDescriptor("This card doesn't match your scores in the game on holes: 3, 7. Wait for every hole to sync, or fix it in the scorecard.", 'holes_mismatch'))
      .toEqual({ key: 'league.error.holesMismatch', params: { holes: '3, 7', count: 2 } });
    await setLanguagePref('es');
    expect(leagueErrorText(new LeagueError(SAMPLES.card_exists, { hint: 'card_exists' }))).toBe('Ya tienes tu tarjeta de octubre.');
    expect(leagueErrorText(new LeagueError(SAMPLES.last_admin, { hint: 'last_admin' })))
      .toBe('Nacho es el único admin de la liga. Haz admin a otra persona primero.');
    expect(leagueErrorText(new LeagueError(
      "This card doesn't match your scores in the game on hole: 4. Wait for every hole to sync, or fix it in the scorecard.",
      { hint: 'holes_mismatch' },
    ))).toMatch(/en el hoyo 4\./);
    expect(leagueErrorText(new LeagueError(SAMPLES.outside_season, { hint: 'outside_season' })))
      .toBe('Esa fecha está fuera de la temporada (del 1 ene al 31 dic).');
    expect(leagueErrorText(new LeagueError('This is your October card, but the date is in November. Check the date.', { hint: 'month_mismatch' })))
      .toBe('Es tu tarjeta de octubre, pero la fecha es de noviembre. Revisa la fecha.');
  });

  test('a reworded server sentence still translates by its hint when the hint has one sentence', async () => {
    await setLanguagePref('es');
    expect(leagueErrorText(new LeagueError('Too soon, try tomorrow.', { hint: 'remind_too_soon' })))
      .toBe('Solo puedes recordarlo una vez al día.');
  });

  test('an unknown hint or message falls back to the server message', async () => {
    await setLanguagePref('es');
    expect(leagueErrorDescriptor('Something new happened.', 'brand_new')).toBeNull();
    expect(leagueErrorText(new LeagueError('Something new happened.', { hint: 'brand_new' }))).toBe('Something new happened.');
    expect(leagueErrorText(toLeagueError({ code: 'P0001', message: 'Nope' }))).toBe('Nope');
    expect(leagueErrorText(null)).toBe('');
    expect(leagueErrorText(new Error(''))).toBe('');
  });

  test('client messages keep their English message and gain a descriptor', async () => {
    const off = toLeagueError({ message: 'Failed to fetch' });
    expect(off.message).toBe(OFFLINE_MESSAGE);
    expect(off.descriptor).toEqual({ key: 'league.error.offline', params: {} });
    expect(new LeagueError(LEAGUE_GONE_MESSAGE, { code: 'league_gone' }).descriptor.key).toBe('league.error.gone');
    expect(toLeagueError(new Error('Failed to read photo (404)')).descriptor)
      .toEqual({ key: 'league.error.photoRead', params: { status: '404' } });
    await setLanguagePref('es');
    expect(leagueErrorText(off)).toBe('Necesitas conexión para hacer esto.');
    expect(leagueErrorText(new LeagueError(LEAGUE_GONE_MESSAGE))).toBe('Esta liga ya no existe.');
  });

  test('every descriptor key exists in the English catalogue', () => {
    for (const { hint, message } of [...serverRaises(), ...Object.entries(SAMPLES).map(([hint, message]) => ({ hint, message }))]) {
      const d = leagueErrorDescriptor(message, hint);
      if (d) expect(en[d.key]).toBeDefined();
    }
  });
});
