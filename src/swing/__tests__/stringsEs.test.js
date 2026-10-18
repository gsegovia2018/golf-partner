import { act } from '@testing-library/react-native';
import { SWING_STRINGS } from '../strings';
import { cueFor } from '../checkpoints';
import { DRILLS, progression } from '../drills';
import { fixCopy } from '../fixes';
import { valueText } from '../highlights';
import { setLanguagePref } from '../../i18n';

describe('SWING_STRINGS follows the active language', () => {
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('the finish balance value reads in the active language', async () => {
    const check = { id: 'finish_balance', value: 2, unit: 'of 2' };
    expect(valueText(check)).toBe('2 of 2');
    await act(async () => { await setLanguagePref('es'); });
    expect(valueText(check)).toBe('2 de 2');
  });

  test('English by default, Spanish after the switch, with the same shapes', async () => {
    expect(SWING_STRINGS.home.title).toBe('My swing');
    expect(SWING_STRINGS.capture.guideTips).toHaveLength(4);
    const tips = SWING_STRINGS.capture.guideTips;
    expect(SWING_STRINGS.capture.guideTips).toBe(tips); // stable between reads in one language
    await act(async () => { await setLanguagePref('es'); });
    expect(SWING_STRINGS.home.title).toBe('Mi swing');
    expect(SWING_STRINGS.capture.guideTips).toHaveLength(4);
    expect(SWING_STRINGS.capture.guideTips[0]).toMatch(/móvil/);
    expect(SWING_STRINGS.results.practice.blocks.map((b) => b.key)).toEqual(['program', 'block', 'random', 'compete']);
    expect(SWING_STRINGS.results.practice.blocks[0].name).toBe('Programa');
  });

  test('functions and plurals render in Spanish with locale numbers', async () => {
    await act(async () => { await setLanguagePref('es'); });
    expect(SWING_STRINGS.home.footer(1, '1,5 GB')).toBe('1 swing · 1,5 GB');
    expect(SWING_STRINGS.home.storage(2, '1,5 GB')).toBe('2 swings · 1,5 GB en este móvil');
    expect(SWING_STRINGS.results.moreDrills(2)).toBe('2 ejercicios más');
    expect(SWING_STRINGS.results.unconfirmedChip(1)).toBe('1 posición sin confirmar');
    expect(SWING_STRINGS.checkText.hands_under_shoulders_out(1234.4)).toBe('Manos 1.234 cm por delante de los hombros (te estiras hacia la bola)');
    expect(SWING_STRINGS.checkText.tempo(30, 10, 2.8)).toBe('Subida 30 : bajada 10 fotogramas = 2,8:1 (2,5–3,5 está bien)');
    expect(SWING_STRINGS.compare.stillFault('Extensión prematura')).toBe('Se mantiene: extensión prematura.');
    expect(SWING_STRINGS.results.alsoCausing(['Over the top', 'Palo cruzado', 'Ritmo lento'])).toBe('Probablemente también causa: over the top, palo cruzado y 1 más');
    expect(SWING_STRINGS.mark.chapterA11y('Impacto', 'todo')).toBe('Impacto: por hacer');
    expect(SWING_STRINGS.fault.early_extension).toBe('Extensión prematura');
    expect(SWING_STRINGS.checkpoint.address).toBe('Preparación');
  });

  test('coaching, cues and drills are translated; left-handers mirror izquierdo / derecho', async () => {
    await act(async () => { await setLanguagePref('es'); });
    expect(fixCopy({ id: 'tempo', status: 'red', dir: 'fast' }).headline).toBe('Aceleras el swing desde el top');
    expect(cueFor('leadArm', 'right').what).toBe('Brazo izquierdo paralelo al suelo en la subida.');
    expect(cueFor('leadArm', 'left').what).toBe('Brazo derecho paralelo al suelo en la subida.');
    expect(cueFor('shaftThrough', 'left').stop.short).toMatch(/cadera derecha/);
    expect(cueFor('top').stop.watch).toBe('la cabeza del palo, no las manos');
    expect(DRILLS.find((d) => d.id === 'ee-silla').title).toBe('La silla');
    expect(progression()).toMatch(/hierro 7/);
  });
});
