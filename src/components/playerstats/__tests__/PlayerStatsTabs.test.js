import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { setLanguagePref } from '../../../i18n';
import SummaryTab from '../SummaryTab';
import TogetherTab from '../TogetherTab';

const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

const SUMMARY = {
  roundCount: 6,
  recentDiff: { value: 14.2, count: 5 },
  index: { value: 12.4, move3m: -1.5 },
  bestDiff: { value: 9.1, courseName: 'Pine' },
  bestRound: { points: 41 },
  form: { recent: 13.8, chip: 'up' },
  series: [],
  strengths: [{ label: 'Par 5s', avgPoints: 2.456, sample: 40, deviation: 0.5 }],
  weaknesses: [{ label: 'Back nine', avgPoints: 1.5, sample: 40, deviation: -0.5 }],
  scoreMix: { total: 0 },
  homeCourse: { courseName: 'Pine', rounds: 4, avgPoints: 31.5, bestPoints: 38, avgDifferential: 12.3 },
  milestones: { longestParStreak: 3, bestNine: 20 },
};
const H2H = { n: 3, wins: 2, ties: 0, losses: 1, avgMe: 34, avgThem: 32, last5: ['W', 'L', 'W'] };
const VERDICT = {
  key: 'stats.player.verdict.noTrait',
  params: {
    level: { key: 'stats.player.verdict.level.over.neutral', params: { gap: 4.2, idx: 12.4 } },
    form: { key: 'stats.player.verdict.form.steady' },
  },
};

const wrap = (el) => render(<ThemeProvider>{el}</ThemeProvider>);

afterEach(async () => {
  await setLanguagePref('system');
});

describe('SummaryTab', () => {
  const tab = () => (
    <SummaryTab summary={SUMMARY} verdict={VERDICT} h2h={H2H} name="Ana" onInfo={() => {}} onGoTogether={() => {}} />
  );

  test('English', async () => {
    const { getByText } = wrap(tab());
    await flush();
    expect(getByText('Averaging 4.2 strokes over the 12.4 the app rates them — and holding steady.')).toBeTruthy();
    expect(getByText('Avg diff · last 5')).toBeTruthy();
    expect(getByText('You vs Ana')).toBeTruthy();
    expect(getByText('Back nine')).toBeTruthy();
  });

  test('Spanish', async () => {
    await setLanguagePref('es');
    const { getByText } = wrap(tab());
    await flush();
    expect(getByText('Promedia 4,2 golpes por encima del 12,4 que le da la app — y se mantiene estable.')).toBeTruthy();
    expect(getByText('Dif. media · últ. 5')).toBeTruthy();
    expect(getByText('▼ 1,5 · 3 meses')).toBeTruthy();
    expect(getByText('En mejora')).toBeTruthy();
    expect(getByText('Tú vs Ana')).toBeTruthy();
    expect(getByText('Últimos 9')).toBeTruthy();
    expect(getByText('2,46')).toBeTruthy();
    expect(getByText('Victorias')).toBeTruthy();
    expect(getByText('Basado en 6 vueltas que puedes ver · las vueltas de 9 hoyos y las inacabadas no cuentan para los diferenciales')).toBeTruthy();
  });
});

describe('TogetherTab', () => {
  const shared = [{
    key: 'k1', tournamentId: 't1', tournamentName: 'Open', courseName: '',
    date: '2026-10-04', roundIndex: 1, mePoints: 36, themPoints: 30, partners: true,
  }];

  test('Spanish: rows, tiles and empty state', async () => {
    await setLanguagePref('es');
    const { getByText, rerender } = wrap(
      <TogetherTab shared={shared} h2h={H2H} name="Ana" navigation={{ navigate: jest.fn() }} />,
    );
    await flush();
    expect(getByText('Vueltas juntos')).toBeTruthy();
    expect(getByText('+2,0')).toBeTruthy();
    expect(getByText('Vuelta 2')).toBeTruthy();
    expect(getByText('Pareja')).toBeTruthy();
    expect(getByText('Open · 4 oct 26')).toBeTruthy();
    rerender(<ThemeProvider><TogetherTab shared={[]} h2h={null} name="Ana" navigation={{}} /></ThemeProvider>);
    expect(getByText('Aún no hay vueltas compartidas')).toBeTruthy();
  });
});
