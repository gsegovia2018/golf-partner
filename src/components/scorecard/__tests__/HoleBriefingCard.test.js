import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import HoleBriefingCard from '../HoleBriefingCard';
import { holeBriefing } from '../../../store/holeBriefing';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic } = jest.requireActual('../../../theme/tokens');
    return { theme: { ...light, semantic, isDark: false } };
  },
}));
jest.mock('../../../hooks/useCourseGeometry', () => ({ useCourseGeometry: () => null }));
jest.mock('../../../lib/geo', () => ({
  ...jest.requireActual('../../../lib/geo'),
  holeFeatures: jest.fn(() => null),
  getCourseGeometryVersion: () => 0,
}));
jest.mock('../../../store/holeBriefing', () => ({ holeBriefing: jest.fn() }));

const tip = (shot, aim, extra = {}) => ({
  shot,
  aim,
  msg: { key: `stats.aim.title.${aim}` },
  detail: { key: 'stats.aim.why.tee.right', params: { count: 12, total: 17 } },
  hazardMsg: null,
  ...extra,
});
const props = { par: 4, holeNumber: 3, courseName: 'Pebble', stats: {}, handedness: 'right', scored: false };

describe('HoleBriefingCard', () => {
  it('shows both lines with the expected approach distance', () => {
    holeBriefing.mockReturnValue({
      tee: tip('tee', 'left-edge'),
      approach: tip('approach', 'left-half', { hazardMsg: { key: 'stats.aim.hazard.bunker.right' } }),
      approachMeters: 130,
    });
    const { getByText, queryByText } = render(<HoleBriefingCard {...props} />);
    expect(getByText('Off the tee')).toBeTruthy();
    expect(getByText('Approach (~130 m)')).toBeTruthy();
    expect(getByText('Aim at the left edge of the fairway')).toBeTruthy();
    expect(getByText('Aim at the left half of the green')).toBeTruthy();
    expect(getByText(/bunker right/)).toBeTruthy();
    expect(queryByText(/Aim tips:/)).toBeNull();
  });

  it('shows one line and a plain Approach label without a distance', () => {
    holeBriefing.mockReturnValue({ tee: null, approach: tip('approach', 'club-up'), approachMeters: null });
    const { getByText, queryByText } = render(<HoleBriefingCard {...props} />);
    expect(getByText('Approach')).toBeTruthy();
    expect(queryByText('Off the tee')).toBeNull();
  });

  it('renders nothing when no line qualifies, or without stats', () => {
    holeBriefing.mockReturnValue({ tee: null, approach: null, approachMeters: null });
    expect(render(<HoleBriefingCard {...props} />).toJSON()).toBeNull();
    expect(render(<HoleBriefingCard {...props} stats={null} />).toJSON()).toBeNull();
  });

  it('collapses to a one-line summary once scored, and expands on tap', () => {
    holeBriefing.mockReturnValue({
      tee: tip('tee', 'left-edge'), approach: tip('approach', 'left-half'), approachMeters: 130,
    });
    const { getByText, queryByText, getByRole } = render(<HoleBriefingCard {...props} scored />);
    expect(getByText('Aim tips: left edge · left half')).toBeTruthy();
    expect(queryByText('Off the tee')).toBeNull();
    fireEvent.press(getByRole('button'));
    expect(getByText('Off the tee')).toBeTruthy();
    fireEvent.press(getByRole('button'));
    expect(getByText('Aim tips: left edge · left half')).toBeTruthy();
  });

  it('computes the briefing from par, stats and the hole geometry', () => {
    holeBriefing.mockClear();
    holeBriefing.mockReturnValue({ tee: null, approach: null, approachMeters: null });
    render(<HoleBriefingCard {...props} />);
    expect(holeBriefing).toHaveBeenCalledWith(expect.objectContaining({ par: 4, stats: props.stats, geometry: null, handedness: 'right' }));
  });
});
