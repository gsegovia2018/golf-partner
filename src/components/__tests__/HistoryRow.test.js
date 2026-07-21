import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import HistoryRow from '../HistoryRow';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const wonModel = {
  id: 't1',
  kind: 'tournament',
  title: 'Marbella Open',
  when: 0,
  dateBox: { top: '3', bottom: 'ROUNDS' },
  subtitle: '3 courses',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'NO', isMe: false }],
  extraPlayers: 3,
  isOwner: true,
  result: { kind: 'won', points: 104 },
  champion: { name: 'Marcos', isMe: true, points: 104, unit: 'pts' },
  myPlacement: { place: 1, label: '1st', points: 104, fieldSize: 8, won: true, podium: true },
};

const gameModel = {
  id: 'g1',
  kind: 'game',
  title: 'Casual 18',
  when: 0,
  dateBox: { top: '7', bottom: 'JUN' },
  subtitle: 'CCVM Negro',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'NO', isMe: false }],
  extraPlayers: 0,
  isOwner: false,
  result: { kind: 'points', points: 29 },
  champion: null,
  myPlacement: null,
};

describe('HistoryRow', () => {
  test('won tournament renders WON badge, champion-as-You footer, and gold pill', () => {
    const { getByText } = render(wrap(<HistoryRow model={wonModel} onPress={() => {}} />));
    getByText('WON');
    getByText(/Champion ·/);
    getByText('You');
    getByText('1st of 8');
    getByText('+3'); // avatar overflow
  });

  test('game renders points and no champion footer', () => {
    const { getByText, queryByText } = render(wrap(<HistoryRow model={gameModel} onPress={() => {}} />));
    getByText('29');
    getByText('CCVM Negro');
    expect(queryByText(/Champion/)).toBeNull();
    expect(queryByText(/of \d/)).toBeNull();
  });

  test('press and long-press fire the callbacks', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const { getByLabelText } = render(wrap(
      <HistoryRow model={gameModel} onPress={onPress} onLongPress={onLongPress} />,
    ));
    const row = getByLabelText('Casual 18');
    fireEvent.press(row);
    fireEvent(row, 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});
