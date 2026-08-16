import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import { ShareableRoundCard, roundSummaryToText } from '../ShareableCard';

// react-native-view-shot ships untransformed ESM (its main entry uses raw
// `import`/`export`, and it isn't in jest.config.js's transformIgnorePatterns
// allow-list), so importing ShareableCard.js in a test needs this mocked —
// same approach as StatsScreen.test.js / HomeScreen.quickStart.test.js use
// for screens that pull it in indirectly.
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('file://mock.png')),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const ranked = [
  { player: { id: 'p1', name: 'Marcos' }, points: 36, strokes: 72 },
  { player: { id: 'p2', name: 'Pablo' }, points: 30, strokes: 78 },
  { player: { id: 'p3', name: 'Ana' }, points: 28, strokes: 80 },
];

describe('roundSummaryToText', () => {
  test('includes the winner from the ranked list', () => {
    const text = roundSummaryToText({
      tournamentName: 'Weekend Cup', roundLabel: 'Round 1', ranked, unit: 'pts',
    });
    expect(text).toContain('Marcos');
    expect(text).toContain('36 pts');
    expect(text).toContain('🥇');
  });

  test('appends the board URL after a blank line when provided', () => {
    const text = roundSummaryToText({
      tournamentName: 'Weekend Cup', roundLabel: 'Round 1', ranked, unit: 'pts',
      boardUrl: 'https://golf-partner.vercel.app/board/tok-123',
    });
    const lines = text.split('\n');
    const urlIndex = lines.indexOf('https://golf-partner.vercel.app/board/tok-123');
    expect(urlIndex).toBeGreaterThan(0);
    expect(lines[urlIndex - 1]).toBe('');
  });

  test('omits the board URL entirely when none is given', () => {
    const text = roundSummaryToText({
      tournamentName: 'Weekend Cup', roundLabel: 'Round 1', ranked, unit: 'pts', boardUrl: null,
    });
    expect(text).not.toContain('vercel.app');
  });

  test('uses "holes" as the unit label for match play', () => {
    const text = roundSummaryToText({
      tournamentName: 'Weekend Cup', roundLabel: 'Round 1', ranked, unit: 'holes',
    });
    expect(text).toContain('36 holes');
  });
});

describe('ShareableRoundCard', () => {
  test('renders the winner, podium and branding without crashing', () => {
    const { getByText, getAllByText } = render(wrap(
      <ShareableRoundCard
        tournamentName="Weekend Cup"
        roundLabel="Round 1 · La Moraleja"
        courseName="La Moraleja"
        recap={{ winnerName: 'Marcos', winnerPoints: 36 }}
        ranked={ranked}
        unit="pts"
      />,
    ));

    // "Marcos" appears twice: the winner hero and the podium's 1st-place cell.
    expect(getAllByText('Marcos').length).toBe(2);
    expect(getAllByText(/36 pts/).length).toBeGreaterThan(0);
    expect(getByText('Pablo')).toBeTruthy();
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Golf Partner 🏌️')).toBeTruthy();
  });

  test('falls back gracefully with no recap or ranked entries', () => {
    const { getByText } = render(wrap(
      <ShareableRoundCard tournamentName="Weekend Cup" roundLabel="Round 1" ranked={[]} />,
    ));
    expect(getByText('No winner yet')).toBeTruthy();
  });
});
