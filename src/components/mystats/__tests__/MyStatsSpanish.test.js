import React from 'react';
import { render, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { setLanguagePref, t } from '../../../i18n';
import CareerMilestonesCard from '../CareerMilestonesCard';
import CoachHero from '../CoachHero';
import CoachTab from '../tabs/CoachTab';
import DiagnosisCard from '../DiagnosisCard';
import { onePutting, tieStats, teeLeft, week, driverSwing, focusRecord, verdictOf, approachShort } from './coachFixtures';
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
    const perRound = [-1, -1.4, -1.2, -1.2].map((putting) => ({
      byCategory: { putting },
      sampleHolesByCategory: { offTheTee: 18, approach: 18, aroundGreen: 18, putting: 18, penalties: 18 },
    }));
    const { hero } = buildCoachInsights({ strokesGained: { perRound } });
    const { getByText, getAllByText } = render(wrap(<CoachHero insight={hero} />));
    expect(getByText('Corrige primero')).toBeTruthy();
    expect(getAllByText('Putts').length).toBeGreaterThan(0);
    expect(getByText('Putts te cuesta 1,2 SG / vuelta frente a tu hándicap objetivo en 72 hoyos.')).toBeTruthy();
    expect(getByText('Confianza alta')).toBeTruthy();
  });
  test('the diagnosis chain renders in Spanish: rail, symptom, cause, drills, task, check', () => {
    const stats = onePutting();
    const { getByText, getAllByText, getByTestId } = render(wrap(
      <DiagnosisCard week={week(stats)} diagnosis={stats.coachDiagnosis} onCommitFocus={() => {}} />,
    ));
    expect(getByText('Corrige primero')).toBeTruthy();
    ['Pérdida', 'Por qué', 'Qué hacer', 'Comprobar'].forEach((k) => expect(getByText(k)).toBeTruthy());
    expect(getByText('Putts · 6+ m')).toBeTruthy();
    expect(getByText('-1,4')).toBeTruthy();
    expect(getByText('golpes por vuelta frente a un hándicap de 15')).toBeTruthy();
    expect(getByText('Putts: pierdes unos 1,4 golpes por vuelta frente a un hándicap de 15, sobre todo desde 6+ m (12 vueltas).')).toBeTruthy();
    expect(getByText('Confianza alta')).toBeTruthy();
    expect(getByText(/^La mayor parte viene de putts desde 6\+ m que acaban en tres putts \(18 de 58, 31%\), con un promedio de 2,5 putts/)).toBeTruthy();
    expect(getByText(/^Escalera de lag putt/)).toBeTruthy();
    expect(getAllByText(/^Nivel 1 de 3$/).length).toBeGreaterThan(0);
    expect(getByText('Objetivo: 7 de 10 acaban a menos de 1 m del hoyo')).toBeTruthy();
    expect(getByText('Próxima vuelta')).toBeTruthy();
    expect(getByText('Porcentaje de tres putts desde 6+ m: ahora 31%.')).toBeTruthy();
    expect(getByText('Se vuelve a medir tras 2 vueltas; el veredicto se asienta a las 4.')).toBeTruthy();
    expect(getByText('Trabajar en esto')).toBeTruthy();
    expect(getByTestId('focus-explain')).toHaveTextContent(
      'El entrenador sigue porcentaje de tres putts desde 6+ m en tus próximas vueltas, te dice a las 2 vueltas si mejoras y sube de nivel tu plan.',
    );
  });

  test('tie, swing line and web fallback in Spanish', () => {
    const tie = tieStats();
    const a = render(wrap(<DiagnosisCard week={week(tie)} diagnosis={tie.coachDiagnosis} onCommitFocus={() => {}} />));
    expect(a.getByText('Dos pérdidas demasiado igualadas')).toBeTruthy();
    expect(a.getByLabelText('Trabajar en Aproximación')).toBeTruthy();
    const tee = teeLeft();
    const linked = render(wrap(<DiagnosisCard week={week(tee, { swings: [driverSwing()] })} diagnosis={tee.coachDiagnosis} swingSupport={{ supported: true }} onOpenSwing={() => {}} />));
    expect(linked.getByText(/Tu swing con el driver grabado el 4 oct muestra over the top/)).toBeTruthy();
    expect(linked.getByLabelText('Abrir el análisis del swing')).toBeTruthy();
    const none = render(wrap(<DiagnosisCard week={week(tee)} diagnosis={tee.coachDiagnosis} swingSupport={{ supported: false, reason: 'web' }} />));
    expect(none.getByText(/^El análisis del swing funciona en la app del móvil/)).toBeTruthy();
  });

  test('the weekly plan and focus card render in Spanish', () => {
    const stats = approachShort();
    const focus = focusRecord();
    const verdict = verdictOf();
    const r = render(wrap(<CoachTab stats={stats} week={week(stats, { focus, verdict })} focus={focus} focusVerdict={verdict} targetHandicap={15} />));
    expect(r.getByText('Esta semana')).toBeTruthy();
    expect(r.getByText('min / semana')).toBeTruthy();
    expect(r.getByLabelText('90 minutos')).toBeTruthy();
    expect(r.getByTestId('plan-level').props.children).toBe('Nivel 2 de 3 · 3 vueltas desde el 2 oct');
    expect(r.getByText('Primera lectura: 3 vueltas jugadas, el veredicto se asienta a las 4.')).toBeTruthy();
    expect(r.getByText('Fallos cortos desde 100-150 m')).toBeTruthy();
    expect(render(wrap(<CoachTab stats={onePutting()} week={week(onePutting())} targetHandicap={15} />)).getByText('Más hallazgos')).toBeTruthy();
    expect(r.getByLabelText('Terminar foco')).toBeTruthy();
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
