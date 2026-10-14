import React from 'react';
import { render, act } from '@testing-library/react-native';
import SyncStatusSheet from '../SyncStatusSheet';
import { ThemeProvider } from '../../theme/ThemeContext';
import { setLanguagePref } from '../../i18n';

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after render so its
// follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

// Regression test for the removal of the dead conflict-audit path
// (_appendConflicts / _conflictLog): SyncStatusSheet must still render its
// live "Status" section (status dot, pending count, last-sync timestamp)
// without the "Overwritten changes" section, which could never populate
// under the sync v2 derived-conflict model.
test('renders the sync status sheet without the removed conflict-log section', async () => {
  const { getByText, queryByText } = render(
    <ThemeProvider>
      <SyncStatusSheet visible onClose={() => {}} />
    </ThemeProvider>,
  );
  await flush();

  expect(getByText('Sync')).toBeTruthy();
  expect(getByText('Status')).toBeTruthy();
  expect(queryByText('Overwritten changes')).toBeNull();
  expect(queryByText('Cambios sobrescritos')).toBeNull();
});

describe('in Spanish', () => {
  beforeEach(async () => { await setLanguagePref('es'); });
  afterEach(async () => { await setLanguagePref('en'); });

  test('titles, state and the unsent-hole note are Spanish', async () => {
    const { getByText } = render(
      <ThemeProvider>
        <SyncStatusSheet visible onClose={() => {}} status="pending" unsentHole={7} cardsPending />
      </ThemeProvider>,
    );
    await flush();

    expect(getByText('Sincronización')).toBeTruthy();
    expect(getByText('Estado')).toBeTruthy();
    expect(getByText('Pendiente')).toBeTruthy();
    expect(getByText('Hoyo 7 sin enviar: sal del hoyo para enviarlo')).toBeTruthy();
    expect(getByText('Tarjeta pendiente de enviar')).toBeTruthy();
    expect(getByText('Reintentar')).toBeTruthy();
  });
});
