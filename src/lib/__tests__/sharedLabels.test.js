import { setLanguagePref } from '../../i18n';
import {
  CLUB_CATALOG, clubLabel, sanitizeBag, DEFAULT_BAG,
} from '../clubs';
import { pointsText, unitText } from '../pointsText';
import { formatRoundDuration } from '../../store/roundDuration';

const spanish = () => {
  beforeEach(async () => { await setLanguagePref('es'); });
  afterEach(async () => { await setLanguagePref('en'); });
};

describe('club names', () => {
  test('English labels are unchanged and every catalogue club has one', () => {
    expect(clubLabel('driver')).toBe('Driver');
    expect(clubLabel('3w')).toBe('3 Wood');
    expect(clubLabel('pw')).toBe('Pitching Wedge');
    for (const c of CLUB_CATALOG) {
      expect(c.label).not.toMatch(/^shared\.club\./);
    }
    expect(clubLabel('not-a-club')).toBe('not-a-club');
  });

  describe('in Spanish', () => {
    spanish();
    test('woods, hybrids and irons are named the Spanish way', () => {
      expect(clubLabel('3w')).toBe('Madera 3');
      expect(clubLabel('4h')).toBe('Híbrido 4');
      expect(clubLabel('7i')).toBe('Hierro 7');
      expect(clubLabel('sw')).toBe('Sand wedge');
      expect(clubLabel('putter')).toBe('Putter');
    });
    test('the catalogue label follows the language each time it is read', () => {
      const seven = CLUB_CATALOG.find((c) => c.key === '7i');
      expect(seven.label).toBe('Hierro 7');
    });
  });

  test('ordering and bag sanitising do not depend on labels', () => {
    expect(sanitizeBag(['putter', 'driver', 'driver', 'bogus'])).toEqual(['driver', 'putter']);
    expect(sanitizeBag(null)).toEqual([...DEFAULT_BAG]);
  });
});

describe('pointsText', () => {
  test('English', () => {
    expect(pointsText(38)).toBe('38 pts');
    expect(pointsText(1234, 'pts')).toBe('1,234 pts');
    expect(pointsText(3, 'holes')).toBe('3 holes');
    expect(pointsText('-')).toBe('- pts');
    expect(unitText()).toBe('pts');
  });
  describe('in Spanish', () => {
    spanish();
    test('ptos and hoyos, with Spanish number formatting', () => {
      expect(pointsText(38)).toBe('38 ptos');
      expect(pointsText(1234)).toBe('1.234 ptos');
      expect(pointsText(3, 'holes')).toBe('3 hoyos');
      expect(unitText('holes')).toBe('hoyos');
    });
  });
});

describe('formatRoundDuration', () => {
  test('English keeps the compact form', () => {
    expect(formatRoundDuration(48 * 60000)).toBe('48m');
    expect(formatRoundDuration(4 * 3600000)).toBe('4h');
    expect(formatRoundDuration((3 * 60 + 52) * 60000)).toBe('3h 52m');
  });
  describe('in Spanish', () => {
    spanish();
    test('uses h and min', () => {
      expect(formatRoundDuration(48 * 60000)).toBe('48 min');
      expect(formatRoundDuration(4 * 3600000)).toBe('4 h');
      expect(formatRoundDuration((3 * 60 + 52) * 60000)).toBe('3 h 52 min');
    });
  });
});
