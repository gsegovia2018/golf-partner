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

const placementModel = {
  id: 't2',
  kind: 'tournament',
  title: 'Costa del Sol Classic',
  when: 0,
  dateBox: { top: '14', bottom: 'ROUNDS' },
  subtitle: '2 courses',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'SR', isMe: false }],
  extraPlayers: 0,
  isOwner: false,
  result: { kind: 'placement', place: 2, label: '2nd', points: 84 },
  champion: { name: 'Sergio', isMe: false, points: 89, unit: 'pts' },
  myPlacement: { place: 2, label: '2nd', points: 84, fieldSize: 4, won: false, podium: true },
};

const teamModel = {
  id: 'g2',
  kind: 'game',
  title: 'Team Play',
  when: 0,
  dateBox: { top: '21', bottom: 'JUL' },
  subtitle: 'La Quinta',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'JS', isMe: false }],
  extraPlayers: 0,
  isOwner: false,
  result: { kind: 'team', points: 0 },
  champion: null,
  myPlacement: null,
};

const noneModel = {
  id: 'g3',
  kind: 'game',
  title: 'Friendly Match',
  when: 0,
  dateBox: { top: '28', bottom: 'JUL' },
  subtitle: 'Alhama',
  avatars: [{ initials: 'MA', isMe: true }],
  extraPlayers: 0,
  isOwner: false,
  result: { kind: 'none', points: 0 },
  champion: null,
  myPlacement: null,
};

const neutralPillModel = {
  id: 't3',
  kind: 'tournament',
  title: 'Summer Shootout',
  when: 0,
  dateBox: { top: '5', bottom: 'AUG' },
  subtitle: '3 courses',
  avatars: [{ initials: 'MA', isMe: true }, { initials: 'NI', isMe: false }],
  extraPlayers: 1,
  isOwner: false,
  result: { kind: 'points', points: 72 },
  champion: { name: 'Nicolas', isMe: false, points: 95, unit: 'pts' },
  myPlacement: { place: 5, label: '5th', points: 72, fieldSize: 8, won: false, podium: false },
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

  test('placement result renders label and points, with podium pill and named-opponent footer', () => {
    const { getByText } = render(wrap(<HistoryRow model={placementModel} onPress={() => {}} />));
    getByText('2nd');
    getByText('84 pts');
    getByText(/Champion ·/);
    getByText('Sergio');
    getByText('2nd of 4');
  });

  test('team result renders dash and team label', () => {
    const { getByText } = render(wrap(<HistoryRow model={teamModel} onPress={() => {}} />));
    getByText('—');
    getByText('team');
  });

  test('none result renders dash and pts label', () => {
    const { getByText } = render(wrap(<HistoryRow model={noneModel} onPress={() => {}} />));
    getByText('—');
    expect(getByText('pts')).toBeDefined();
  });

  test('neutral pill state (not won, not podium) renders with secondary styling', () => {
    const { getByText, queryByText } = render(wrap(<HistoryRow model={neutralPillModel} onPress={() => {}} />));
    getByText('5th of 8');
    getByText('Nicolas');
    expect(queryByText('You')).toBeNull();
  });
});
