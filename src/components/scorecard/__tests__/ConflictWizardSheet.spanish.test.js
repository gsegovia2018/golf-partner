import React from 'react';
import { act, render } from '@testing-library/react-native';
import ConflictWizardSheet from '../ConflictWizardSheet';
import { setLanguagePref } from '../../../i18n';

const rows = [
  {
    playerId: 'p1', hole: 3, par: 4, playerName: 'Marcos', currentValue: 5,
    candidates: [
      { value: 5, ts: 0, authorId: 'me', authorName: 'You' },
      { value: 6, ts: 0, authorId: 'juan', authorName: 'Juan' },
    ],
  },
];

describe('ConflictWizardSheet in Spanish', () => {
  beforeEach(async () => { await act(async () => { await setLanguagePref('es'); }); });
  afterEach(async () => { await act(async () => { await setLanguagePref('en'); }); });

  test('translates the wizard, its hole line and the plural stroke labels', () => {
    const { getByText, getByLabelText } = render(
      <ConflictWizardSheet
        visible
        rows={rows}
        localAuthorIds={['me']}
        onPick={jest.fn()}
        onClose={jest.fn()}
        primaryLabel="Hecho"
        onPrimary={jest.fn()}
      />,
    );
    expect(getByText('Resultado de Marcos')).toBeTruthy();
    expect(getByText('Hoyo 3 · Par 4 · dos móviles no coinciden')).toBeTruthy();
    expect(getByText('1 de 1')).toBeTruthy();
    expect(getByText('Escribiste tú')).toBeTruthy();
    expect(getByText('Juan escribió')).toBeTruthy();
    expect(getByLabelText('Usar 5 golpes para Marcos en el hoyo 3')).toBeTruthy();
    expect(getByText('Decidir más tarde')).toBeTruthy();
  });
});
