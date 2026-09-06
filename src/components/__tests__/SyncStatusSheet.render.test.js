import React from 'react';
import { render, act } from '@testing-library/react-native';
import SyncStatusSheet from '../SyncStatusSheet';
import { ThemeProvider } from '../../theme/ThemeContext';

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after render so its
// follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));

// Regression test for the removal of the dead conflict-audit path
// (_appendConflicts / _conflictLog): SyncStatusSheet must still render its
// live "Estado" section (status dot, pending count, last-sync timestamp)
// without the "Cambios sobrescritos" section, which could never populate
// under the sync v2 derived-conflict model.
test('renders the sync status sheet without the removed conflict-log section', async () => {
  const { getByText, queryByText } = render(
    <ThemeProvider>
      <SyncStatusSheet visible onClose={() => {}} />
    </ThemeProvider>,
  );
  await flush();

  expect(getByText('Sincronización')).toBeTruthy();
  expect(getByText('Estado')).toBeTruthy();
  expect(queryByText('Cambios sobrescritos')).toBeNull();
  expect(queryByText(/Sin cambios sobrescritos/)).toBeNull();
});
