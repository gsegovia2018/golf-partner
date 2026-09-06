import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ReportChapter from '../ReportChapter';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

// ThemeProvider reads its persisted preference from AsyncStorage in a
// useEffect; flush that pending promise (inside act) after every render so
// its follow-up setState doesn't land outside act().
const flush = () => act(() => new Promise((resolve) => setImmediate(resolve)));
async function renderChapter(ui) {
  const utils = render(wrap(ui));
  await flush();
  return utils;
}

const rows = [
  { label: 'Par 3s', valueText: '1.25', sub: '1.25 / hole', delta: -0.7, good: -0.7, ratio: 0.78 },
  { label: 'Par 5s', valueText: '2.80', sub: '2.80 / hole', delta: 0.9, good: 0.9, ratio: 1 },
];

describe('ReportChapter', () => {
  test('collapsed chapter shows the preview but not its rows', async () => {
    const { getByText, queryByText } = await renderChapter(
      <ReportChapter icon="flag" title="Where on the course" preview="Best: Par 5s +0.9 · Worst: Par 3s -0.7" rows={rows} hasDeltas />
    );
    expect(getByText('Best: Par 5s +0.9 · Worst: Par 3s -0.7')).toBeTruthy();
    expect(queryByText('Par 5s')).toBeNull();
  });

  test('tapping the header expands the rows', async () => {
    const { getByText, queryByText } = await renderChapter(
      <ReportChapter icon="flag" title="Where on the course" preview="p" rows={rows} hasDeltas />
    );
    fireEvent.press(getByText('Where on the course'));
    expect(getByText('Par 5s')).toBeTruthy();
    expect(getByText('+0.9')).toBeTruthy();
  });

  test('initiallyOpen renders rows and a legend when deltas exist', async () => {
    const { getByText } = await renderChapter(
      <ReportChapter icon="flag" title="Where on the course" preview="p" rows={rows} hasDeltas initiallyOpen />
    );
    expect(getByText('Par 3s')).toBeTruthy();
    expect(getByText(/cost you/i)).toBeTruthy();
    expect(getByText(/gained/i)).toBeTruthy();
  });

  test('rows without deltas render an em-dash and no legend', async () => {
    const bare = [{ label: 'Pars', valueText: '8', sub: '8 this round', delta: null, good: null, ratio: 0 }];
    const { getByText, queryByText } = await renderChapter(
      <ReportChapter icon="hash" title="Scoring" preview="8 pars" rows={bare} hasDeltas={false} initiallyOpen />
    );
    expect(getByText('—')).toBeTruthy();
    expect(queryByText(/gained/i)).toBeNull();
  });
});
