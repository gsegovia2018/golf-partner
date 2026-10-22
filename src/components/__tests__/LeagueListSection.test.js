import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import LeagueListSection from '../LeagueListSection';
import { setLanguagePref } from '../../i18n';

describe('LeagueListSection', () => {
  test('renders nothing when I am in no league', () => {
    const { toJSON } = render(<LeagueListSection navigation={{}} rows={[]} />);
    expect(toJSON()).toBeNull();
  });

  test('the first league is a hero with my place and what the month still needs', () => {
    const rows = [{
      id: 'L1',
      name: 'El Club',
      position: { key: 'league.play.position', params: { place: '4th', total: 18, points: '1,045' } },
      month: { key: 'league.play.monthNone', params: { monthKey: '2026-10', count: 17 } },
    }];
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<LeagueListSection navigation={navigation} rows={rows} />);
    expect(getByText('League · October')).toBeTruthy();
    expect(getByText('17 days left')).toBeTruthy();
    expect(getByText('4th')).toBeTruthy();
    expect(getByText('of 18')).toBeTruthy();
    expect(getByText('1,045 league pts')).toBeTruthy();
    expect(getByText('Your October card is still to play')).toBeTruthy();
    fireEvent.press(getByText('Open league'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });

  test("the hero's button does my card's next step; the card itself still opens the board", () => {
    const base = { id: 'L1', name: 'El Club', position: null, month: null };
    const cases = [
      [{ kind: 'play' }, 'Play with the app', ['Setup', { kind: 'game', leagueId: 'L1' }]],
      [{ kind: 'post', cardId: 'c1' }, 'Add your score', ['LeagueAddScore', { leagueId: 'L1', cardId: 'c1' }]],
      [{ kind: 'scorecard', tournamentId: 't1', roundId: 'r1' }, 'Open scorecard', ['Scorecard', { tournamentId: 't1', roundIndex: 0 }]],
      [{ kind: 'proof', cardId: 'c1' }, 'Add proof', ['LeagueAddProof', { leagueId: 'L1', cardId: 'c1', resume: true }]],
      [{ kind: 'validate', cardId: 'c1', tournamentId: 't1', roundId: 'r1' }, 'Finish card',
        ['LeagueValidate', { leagueId: 'L1', cardId: 'c1', tournamentId: 't1', roundId: 'r1', submitted: true }]],
      [{ kind: 'open' }, 'Open league', ['LeagueBoard', { leagueId: 'L1' }]],
      [undefined, 'Open league', ['LeagueBoard', { leagueId: 'L1' }]],
    ];
    cases.forEach(([action, label, call]) => {
      const navigation = { navigate: jest.fn() };
      const { getByLabelText, unmount } = render(<LeagueListSection navigation={navigation} rows={[{ ...base, action }]} />);
      fireEvent.press(getByLabelText(label));
      expect(navigation.navigate).toHaveBeenCalledWith(...call);
      unmount();
    });
    const navigation = { navigate: jest.fn() };
    const { getByLabelText } = render(<LeagueListSection navigation={navigation} rows={[{ ...base, action: { kind: 'play' } }]} />);
    fireEvent.press(getByLabelText(/^El Club league/));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
  });

  test('a card step on the button keeps a visible "See the league" link; "Open league" needs none', () => {
    const base = { id: 'L1', name: 'El Club', position: null, month: null };
    const navigation = { navigate: jest.fn() };
    const step = render(<LeagueListSection navigation={navigation} rows={[{ ...base, action: { kind: 'play' } }]} />);
    fireEvent.press(step.getByText('See the league'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L1' });
    step.unmount();
    const open = render(<LeagueListSection navigation={navigation} rows={[{ ...base, action: { kind: 'open' } }]} />);
    expect(open.queryByText('See the league')).toBeNull();
  });

  test('the month line follows the card: ranked, last day, in progress', () => {
    const base = { id: 'L1', name: 'El Club', position: { key: 'league.play.position', params: { place: '1st', total: 7, points: '2,340' } } };
    const ranked = render(<LeagueListSection navigation={{}} rows={[{ ...base, month: { key: 'league.play.monthRank', params: { monthKey: '2026-10', points: '36', place: '3rd' } } }]} />);
    expect(ranked.getByText('36 pts in October')).toBeTruthy();
    expect(ranked.getByText('3rd of the month so far')).toBeTruthy();
    const medal = render(<LeagueListSection navigation={{}} rows={[{ ...base, month: { key: 'league.play.monthRankScore', params: { monthKey: '2026-10', score: 'net −2', place: '3rd' } } }]} />);
    expect(medal.getByText('net −2 in October')).toBeTruthy();
    expect(medal.getByText('3rd of the month so far')).toBeTruthy();
    const last = render(<LeagueListSection navigation={{}} rows={[{ ...base, month: { key: 'league.play.monthNoneLast', params: { monthKey: '2026-10' } } }]} />);
    expect(last.getByText('Last day')).toBeTruthy();
    const live = render(<LeagueListSection navigation={{}} rows={[{ ...base, month: { key: 'league.play.monthLive', params: { monthKey: '2026-10' } } }]} />);
    expect(live.getByText('October card in progress')).toBeTruthy();
  });

  test('further leagues are compact rows; no cards and old cached strings still read', () => {
    const rows = [
      { id: 'L1', name: 'El Club', position: null, month: null },
      {
        id: 'L2',
        name: 'Sunday Four',
        position: { key: 'league.play.position', params: { place: '2nd', total: 4, points: '900' } },
        month: { key: 'league.play.monthRank', params: { monthKey: '2026-10', points: '36', place: '4th' } },
      },
      { id: 'L3', name: 'Old Cache', position: '2nd of 7 · 2,340 pts' },
    ];
    const navigation = { navigate: jest.fn() };
    const { getByText } = render(<LeagueListSection navigation={navigation} rows={rows} />);
    expect(getByText('No cards confirmed yet')).toBeTruthy();
    expect(getByText('October: 36 pts, 4th so far')).toBeTruthy();
    expect(getByText('2nd of 7 · 2,340 pts')).toBeTruthy();
    fireEvent.press(getByText('Sunday Four'));
    expect(navigation.navigate).toHaveBeenCalledWith('LeagueBoard', { leagueId: 'L2' });
  });

  describe('in Spanish', () => {
    afterEach(async () => { await setLanguagePref('en'); });

    test('hero copy is translated, the month name too', async () => {
      await setLanguagePref('es');
      const rows = [{
        id: 'L1',
        name: 'El Club',
        position: { key: 'league.play.position', params: { place: '4.º', total: 18, points: '1.045' } },
        month: { key: 'league.play.monthNone', params: { monthKey: '2026-10', count: 18 } },
      }];
      const { getByText } = render(<LeagueListSection navigation={{}} rows={rows} />);
      expect(getByText('Liga · octubre')).toBeTruthy();
      expect(getByText('quedan 18 días')).toBeTruthy();
      expect(getByText('de 18')).toBeTruthy();
      expect(getByText('1.045 ptos de liga')).toBeTruthy();
      expect(getByText('Te falta la tarjeta de octubre')).toBeTruthy();
      expect(getByText('Ver liga')).toBeTruthy();
    });
  });
});
