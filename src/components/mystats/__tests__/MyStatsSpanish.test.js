import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { setLanguagePref, t } from '../../../i18n';
import CareerMilestonesCard from '../CareerMilestonesCard';
import CoachHero from '../CoachHero';
import PracticePlanCard from '../PracticePlanCard';
import { buildChapterVM, calloutSub, fmtDelta } from '../reportCardView';
import { renderMsg } from '../msg';
import { buildCoachInsights } from '../../../store/coachInsights';
import { buildStrategyTips } from '../../../store/coachStrategy';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

beforeEach(async () => { await act(async () => { await setLanguagePref('es'); }); });
afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

const milestones = {
  birdies: 6, eagles: 0, longestParStreak: 3,
  bestNine: 21, bestNineHandicap: 20, bestNineIndex: 18.2,
  bestRound: 38, bestRoundHandicap: 20, bestRoundIndex: 18.2,
  bestDifferential: 14.2,
};

describe('My Stats components in Spanish', () => {
  test('CareerMilestonesCard translates labels, units and the era note', () => {
    const { getByText, getAllByText, getByLabelText } = render(wrap(
      <CareerMilestonesCard milestones={milestones} onInfo={() => {}} />,
    ));
    expect(getByText('Hitos de tu carrera')).toBeTruthy();
    expect(getByText('Mejor racha de pares')).toBeTruthy();
    expect(getByText('Mejor vuelta')).toBeTruthy();
    expect(getAllByText('con índice 18,2').length).toBe(2);
    expect(getByLabelText('Mejor diferencial: 14,2')).toBeTruthy();
    expect(getByLabelText('Mejor vuelta: 38 ptos con índice 18,2')).toBeTruthy();
  });

  test('CoachHero renders store descriptors in Spanish', async () => {
    const { hero } = buildCoachInsights({
      actionPlan: {
        improvements: [{
          area: 'Putting', label: '6+ m putts', labelMsg: { key: 'stats.my.label.puttBucket', params: { bucket: '6+' } },
          score: -0.81, sample: 18, unit: 'SG / putt', basis: 'vs target hcp',
        }],
      },
    });
    const { getByText } = render(wrap(<CoachHero insight={hero} />));
    expect(getByText('Corrige primero')).toBeTruthy();
    expect(getByText('Putts')).toBeTruthy();
    expect(getByText('Putts de 6+ m')).toBeTruthy();
    expect(getByText('Putts de 6+ m te está costando 0,81 SG / putt en 18 putts.')).toBeTruthy();
    expect(getByText('18 muestras')).toBeTruthy();
    expect(getByText('Confianza alta')).toBeTruthy();
  });

  test('PracticePlanCard translates the drill by id', () => {
    const plan = [{
      id: 'practice-first', role: 'practiceFirst', title: 'Practice first: Putting',
      instruction: 'x', reason: 'y',
      drill: {
        id: 'putt-lag-ladder', title: 'Lag ladder', instruction: 'Take 10 putts', passTarget: '7 of 10', location: 'green',
      },
      payoffPointsPerRound: 1.8,
    }];
    const { getByText } = render(wrap(<PracticePlanCard plan={plan} />));
    expect(getByText('Plan de práctica')).toBeTruthy();
    expect(getByText('Escalera de lag putt')).toBeTruthy();
    expect(getByText('Objetivo: 7 de 10 acaban a menos de 1 m del hoyo')).toBeTruthy();
    expect(getByText('vale ≈ 1,8 ptos / vuelta')).toBeTruthy();
  });
});

describe('My Stats view helpers and stores in Spanish', () => {
  test('report card view labels and numbers follow the language', () => {
    expect(fmtDelta(1.2)).toBe('+1,2');
    const vm = buildChapterVM({
      key: 'course',
      label: 'Where on the course',
      cells: [{
        label: 'Par 5s', group: 'course', value: 2.8, deltaVsAvg: 0.9, deltaVs2: 0.8, polarity: 'higher',
      }],
    });
    expect(vm.label).toBe('Dónde en el campo');
    expect(vm.rows[0].label).toBe('Par 5');
    expect(vm.rows[0].sub).toBe('2,80 / hoyo');
    expect(calloutSub({ label: 'Par 5s', value: 2.8, deltaVsAvg: 0.9 })).toBe('2,8 / hoyo · +0,9 frente a tu media');
  });

  test('strategy tips carry descriptors that render in Spanish', () => {
    const tips = buildStrategyTips({
      roundCount: 5,
      strokesGained: { roundsByCategory: { putting: 5 } },
      puttingTarget: { buckets: { '6+': { attempts: 40, threePuttRate: 30, sgPerPutt: -0.2 } } },
    });
    expect(tips[0].title).toBe('Lag first from 6+ m');
    expect(renderMsg(tips[0].titleMsg)).toBe('Acércala primero desde 6+ m');
    expect(renderMsg(tips[0].reasonMsg)).toContain('en el 30% de tus putts desde 6+ m');
  });

  test('renderMsg resolves nested descriptors and numbers', () => {
    expect(renderMsg({
      key: 'stats.my.coach.reason.moved',
      params: {
        label: { key: 'stats.my.metric.puttsPerRound' },
        history: { n: 31.5 },
        recent: { n: 30.25 },
        unit: { key: 'stats.my.unit.pts' },
      },
    })).toBe('Putts por vuelta ha pasado de 31,5 a 30,25 ptos.');
    expect(t('stats.my.whatIs', { name: 'x' })).toBe('Qué es x');
  });
});
