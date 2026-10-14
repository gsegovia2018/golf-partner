// Fixes from the Spanish walkthrough: each case runs in Spanish and English.
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { t, tr, setLanguagePref, formatNumber } from '..';
import { getTabBarItem } from '../../navigation/tabBarModel';
import { leaderboardToggleLabels } from '../../components/scoringModes';
import { unitWord } from '../../lib/units';
import { teeDisplayName } from '../../lib/teeName';
import { formatLabel } from '../../lib/calendar';
import { buildChapterVM } from '../../components/mystats/reportCardView';
import { ThemeProvider } from '../../theme/ThemeContext';
import DateField from '../../components/DateField';

afterEach(async () => {
  await setLanguagePref('en');
  delete global.document;
});

const both = async (fn) => {
  await setLanguagePref('en');
  fn('en');
  await setLanguagePref('es');
  fn('es');
};

describe('1 tab bar labels', () => {
  test('every tab label is translated', async () => {
    const labels = (r) => ['Feed', 'MyStats', 'Home', 'History', 'Profile'].map((n) => getTabBarItem(n).label);
    await both((lang) => {
      expect(labels()).toEqual(lang === 'en'
        ? ['Feed', 'Stats', 'Play', 'History', 'Profile']
        : ['Feed', 'Estadísticas', 'Jugar', 'Historial', 'Perfil']);
    });
  });
});

describe('2 scoring toggle and round title', () => {
  test('Stroke Play becomes Juego por golpes, Stableford stays', async () => {
    await both((lang) => {
      expect(leaderboardToggleLabels('individual')).toEqual({
        left: 'Stableford', right: lang === 'en' ? 'Stroke Play' : 'Juego por golpes',
      });
      expect(leaderboardToggleLabels('scramble4').right).toBe(lang === 'en' ? 'Stroke Play' : 'Juego por golpes');
      expect(leaderboardToggleLabels('matchplay').right).toBe('Stableford');
    });
  });

  test('the leaderboard title spells the round out in Spanish', async () => {
    await both((lang) => {
      expect(t('home.board.roundTitle', { n: 1, mode: 'Stableford' }))
        .toBe(lang === 'en' ? 'R1 · Stableford' : 'Vuelta 1 · Stableford');
    });
  });
});

describe('3 units, tees, approach', () => {
  test('unit words', async () => {
    await both((lang) => {
      expect(unitWord('meters')).toBe(lang === 'en' ? 'metres' : 'metros');
      expect(unitWord('yards')).toBe(lang === 'en' ? 'yards' : 'yardas');
    });
  });

  test('only the placeholder tee is translated', async () => {
    await both((lang) => {
      expect(teeDisplayName('Default')).toBe(lang === 'en' ? 'Default' : 'Por defecto');
      expect(teeDisplayName(' default ')).toBe(lang === 'en' ? 'Default' : 'Por defecto');
      expect(teeDisplayName('Blancas')).toBe('Blancas');
      expect(teeDisplayName(null)).toBeNull();
      expect(t('shared.tees.teeName', { tee: teeDisplayName('Default') }))
        .toBe(lang === 'en' ? 'Default tee' : 'Barras Por defecto');
    });
  });

  test('the approach row is Aproximación in Spanish', async () => {
    await both((lang) => {
      expect(t('shots.detail.approach')).toBe(lang === 'en' ? 'Approach' : 'Aproximación');
      expect(t('shots.detail.approachLie')).toBe(lang === 'en' ? 'Approach lie' : 'Terreno de la aproximación');
    });
  });

  test('the Q+1 edge label is spelled out for screen readers', async () => {
    await both((lang) => {
      expect(t('scorecard.hole.edgeA11y', { name: 'Quique', count: 1 }))
        .toBe(lang === 'en' ? 'Quique gets 1 extra shot on this hole.' : 'Quique recibe 1 golpe de ventaja en este hoyo.');
      expect(t('scorecard.hole.edgeA11y', { name: 'Quique', count: 2 }))
        .toBe(lang === 'en' ? 'Quique gets 2 extra shots on this hole.' : 'Quique recibe 2 golpes de ventaja en este hoyo.');
    });
  });
});

describe('4 full card heading', () => {
  test('course and round', async () => {
    await both((lang) => {
      expect(t('scorecard.grid.courseRound', { course: 'Abama Golf', n: 1 }))
        .toBe(lang === 'en' ? 'Abama Golf · Round 1' : 'Abama Golf · Vuelta 1');
    });
  });
});

describe('5 feed highlights', () => {
  test('the descriptors render in each language, nested hole labels included', async () => {
    const line = { key: 'achv.parStreak.sub', params: { holes: { key: 'achv.holes.span', params: { from: 6, to: 9 } } } };
    await both((lang) => {
      expect(tr(line)).toBe(lang === 'en' ? 'Par or better on holes 6-9' : 'Par o mejor en los hoyos 6-9');
      expect(tr({ key: 'achv.scored.title', params: { hole: 1 } }))
        .toBe(lang === 'en' ? 'Hole 1 gave itself away' : 'El hoyo 1 se regaló');
      expect(tr({ key: 'achv.parStreak.title', params: { count: 18 } }))
        .toBe(lang === 'en' ? '18 in a row' : '18 seguidos');
    });
  });
});

describe('6 season dates', () => {
  test('the date field label follows the language', async () => {
    await both((lang) => {
      expect(formatLabel('2026-10-13')).toBe(lang === 'en' ? 'Tue 13 Oct 2026' : 'mar 13 oct 2026');
    });
  });

  test('the DateField shows the localised date and placeholder', async () => {
    const view = (value) => (
      <ThemeProvider><DateField label="Season starts" value={value} onChange={() => {}} /></ThemeProvider>
    );
    const en = render(view('2026-10-13'));
    expect(en.getByText('Tue 13 Oct 2026')).toBeTruthy();
    en.unmount();
    await setLanguagePref('es');
    const es = render(view('2026-10-13'));
    expect(es.getByText('mar 13 oct 2026')).toBeTruthy();
    es.unmount();
    const empty = render(view(''));
    expect(empty.getByText('Elige una fecha')).toBeTruthy();
    void fireEvent;
  });
});

describe('7 plurals', () => {
  test('tee count label agrees with the number', async () => {
    await both((lang) => {
      expect(t('setup.screen.statTees', { count: 1 })).toBe(lang === 'en' ? 'TEE' : 'BARRA');
      expect(t('setup.screen.statTees', { count: 3 })).toBe(lang === 'en' ? 'TEES' : 'BARRAS');
    });
  });

  test('the results preview says "1 par", not "1 pares"', async () => {
    const group = { key: 'distribution', label: 'Score mix', cells: [
      { label: 'Pars', value: 1 }, { label: 'Bogeys', value: 3 },
    ] };
    await both((lang) => {
      expect(buildChapterVM(group).preview).toBe('1 par · 3 bogeys');
      expect(t('stats.my.report.count.pars', { count: 3 })).toBe(lang === 'en' ? '3 pars' : '3 pares');
    });
  });
});

describe('8 sentence-start capitalisation', () => {
  test('Spanish capitalises a month at the start of a sentence, not inside one', async () => {
    await setLanguagePref('es');
    expect(t('league.void.admin', { month: 'octubre' })).toBe('Anulada por un admin. Octubre sigue ocupado.');
    expect(t('league.void.adminReason', { month: 'octubre', reason: 'Barras equivocadas' }))
      .toBe('Anulada por un admin: Barras equivocadas. Octubre sigue ocupado.');
    expect(t('league.actions.monthClosed', { month: 'octubre' })).toBe('Octubre está cerrado. Sus tarjetas ya no cambian.');
    expect(t('league.share.msg.announceNoBy', { month: 'octubre', league: 'Liga', when: 'hoy', course: 'Abama' }))
      .toContain('tarjeta de octubre en Liga');
    expect(tr({ key: 'league.play.monthMissed', params: { monthKey: '2026-10' } })).toBe('Octubre: sin tarjeta');
  });

  test('English is untouched', async () => {
    expect(t('league.void.admin', { month: 'October' })).toBe('Voided by an admin. October stays used.');
  });
});

describe('9 course rating', () => {
  test('goes through formatNumber so the decimal follows the language', async () => {
    await both((lang) => {
      const rating = formatNumber(74.8);
      expect(t('league.cardScreen.teeRated', { tee: 'Blancas', slope: formatNumber(131), rating }))
        .toBe(lang === 'en' ? 'Blancas tees, slope 131 · CR 74.8' : 'barras Blancas, slope 131 · VC 74,8');
    });
  });
});

describe('11 live round card label', () => {
  test('the round label is rendered from the number in the active language', async () => {
    await both((lang) => {
      expect(t('shared.round.numbered', { n: 1 }).toUpperCase()).toBe(lang === 'en' ? 'ROUND 1' : 'VUELTA 1');
    });
  });
});

describe('12 html lang', () => {
  test('follows the active language', async () => {
    global.document = { documentElement: { lang: 'en' } };
    await setLanguagePref('es');
    expect(global.document.documentElement.lang).toBe('es');
    await setLanguagePref('en');
    expect(global.document.documentElement.lang).toBe('en');
  });
});

describe('13 Spanish units in Settings', () => {
  test('yd, not yds; salida, not drive', async () => {
    await setLanguagePref('es');
    expect(t('settings.units.exampleYards', { yards: 100, meters: 91 })).toBe('p. ej. 100 yd ≈ 91 m');
    expect(t('settings.units.exampleMeters', { yards: 109, meters: 100 })).toBe('p. ej. 100 m ≈ 109 yd');
    expect(t('settings.statGroups.shortGame.loss')).toContain('up & down');
    expect(t('settings.statGroups.teeShot.loss')).toContain('distancia de salida');
    await setLanguagePref('en');
    expect(t('settings.units.exampleYards', { yards: 100, meters: 91 })).toBe('e.g. 100 yds ≈ 91 m');
  });
});
