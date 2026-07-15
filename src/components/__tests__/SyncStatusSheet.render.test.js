import React from 'react';
import { render } from '@testing-library/react-native';
import SyncStatusSheet from '../SyncStatusSheet';
import { ThemeProvider } from '../../theme/ThemeContext';

// Regression test for the removal of the dead conflict-audit path
// (_appendConflicts / _conflictLog): SyncStatusSheet must still render its
// live "Estado" section (status dot, pending count, last-sync timestamp)
// without the "Cambios sobrescritos" section, which could never populate
// under the sync v2 derived-conflict model.
test('renders the sync status sheet without the removed conflict-log section', () => {
  const { getByText, queryByText } = render(
    <ThemeProvider>
      <SyncStatusSheet visible onClose={() => {}} />
    </ThemeProvider>,
  );

  expect(getByText('Sincronización')).toBeTruthy();
  expect(getByText('Estado')).toBeTruthy();
  expect(queryByText('Cambios sobrescritos')).toBeNull();
  expect(queryByText(/Sin cambios sobrescritos/)).toBeNull();
});
