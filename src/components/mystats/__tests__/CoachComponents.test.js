import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CoachHero from '../CoachHero';
import CoachInsightRow from '../CoachInsightRow';
import CoachBoard from '../CoachBoard';
import PracticePlanCard from '../PracticePlanCard';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const insight = {
  id: 'putting:6-m-putts',
  group: 'fixFirst',
  area: 'putting',
  areaLabel: 'Putting',
  title: '6+ m putts',
  reason: '6+ m putts is costing points across 18 samples.',
  metric: '-0.81 SG / putt',
  sample: 18,
  confidence: 'high',
  tone: 'bad',
};

describe('Coach components', () => {
  test('CoachHero renders the main insight and proof chips', () => {
    const { getByText } = render(wrap(<CoachHero insight={insight} />));

    expect(getByText('Fix first')).toBeTruthy();
    expect(getByText('Putting')).toBeTruthy();
    expect(getByText('6+ m putts')).toBeTruthy();
    expect(getByText('6+ m putts is costing points across 18 samples.')).toBeTruthy();
    expect(getByText('-0.81 SG / putt')).toBeTruthy();
    expect(getByText('18 samples')).toBeTruthy();
    expect(getByText('High confidence')).toBeTruthy();
  });

  test('CoachHero renders a safe fallback without an insight', () => {
    const { getByText } = render(wrap(<CoachHero insight={null} />));

    expect(getByText('Coach')).toBeTruthy();
    expect(getByText('No coach insight yet')).toBeTruthy();
  });

  test('CoachHero renders the nextGain group label used by coach data', () => {
    const { getByText } = render(wrap(<CoachHero insight={{ ...insight, group: 'nextGain' }} />));

    expect(getByText('Next gain')).toBeTruthy();
  });

  test('CoachInsightRow exposes distinct icon and color state for each tone', () => {
    const tones = ['good', 'bad', 'watch', 'neutral'];
    const rendered = tones.map((tone) => {
      const view = render(wrap(<CoachInsightRow insight={{ ...insight, id: tone, tone, title: `${tone} insight` }} />));
      const icon = view.getByTestId(`coach-insight-icon-${tone}`);
      const iconWrap = view.getByTestId(`coach-insight-tone-${tone}`);
      const metric = view.getByTestId(`coach-insight-metric-${tone}`);

      return {
        tone,
        iconName: icon.props.name,
        iconColor: icon.props.color,
        metricColor: StyleSheet.flatten(metric.props.style).color,
        backgroundColor: StyleSheet.flatten(iconWrap.props.style).backgroundColor,
      };
    });

    expect(rendered.map((state) => state.iconName)).toEqual(['trending-up', 'alert-triangle', 'eye', 'activity']);
    expect(rendered[0].iconColor).not.toBe(rendered[1].iconColor);
    expect(rendered[1].iconColor).not.toBe(rendered[2].iconColor);
    expect(rendered[2].iconColor).toBe(rendered[3].iconColor);
    expect(rendered[2].metricColor).toBe(rendered[3].metricColor);
    expect(new Set(rendered.map((state) => state.backgroundColor)).size).toBe(3);
  });

  test('CoachInsightRow shows the points equivalent when pointsPerRound is present', () => {
    const { getByText, queryByText, rerender } = render(
      wrap(<CoachInsightRow insight={{ ...insight, pointsPerRound: -1.4 }} />),
    );
    expect(getByText('≈ -1.4 pts / round')).toBeTruthy();

    rerender(wrap(<CoachInsightRow insight={insight} />));
    expect(queryByText(/pts \/ round/)).toBeNull();
  });

  test('CoachBoard renders multiple diagnostic groups', () => {
    const board = {
      fixFirst: [insight],
      keepDoing: [
        {
          ...insight,
          id: 'driving:fairway-drives',
          group: 'keepDoing',
          title: 'Fairway drives',
          tone: 'good',
          metric: '+0.64 pts / hole',
        },
      ],
      gettingBetter: [
        {
          ...insight,
          id: 'form:points-round',
          group: 'gettingBetter',
          area: 'form',
          title: 'Points / round',
          tone: 'good',
          metric: 'Improved by 3',
        },
      ],
      gettingWorse: [],
      nextGains: [],
      watch: [],
    };

    const { getByText, queryByText } = render(wrap(<CoachBoard board={board} />));

    expect(getByText('Coach Board')).toBeTruthy();
    expect(getByText('Improve now')).toBeTruthy();
    expect(getByText('Biggest leaks and smaller gains to chase next.')).toBeTruthy();
    expect(getByText('Fix first')).toBeTruthy();
    expect(getByText('Protect')).toBeTruthy();
    expect(getByText('What is already helping your score.')).toBeTruthy();
    expect(getByText('Keep doing')).toBeTruthy();
    expect(getByText('Trends')).toBeTruthy();
    expect(getByText('What changed lately, split into better and worse.')).toBeTruthy();
    expect(getByText('Getting better')).toBeTruthy();
    expect(queryByText('Getting worse')).toBeNull();
    expect(getByText('Fairway drives')).toBeTruthy();
  });

  test('CoachBoard renders an empty state when no groups are present', () => {
    const { getByText } = render(wrap(<CoachBoard board={{}} />));

    expect(getByText('Coach Board')).toBeTruthy();
    expect(getByText('No coach insights yet. Play more rounds to build a clearer pattern.')).toBeTruthy();
  });

  test('PracticePlanCard renders the three plan roles at the bottom summary level', () => {
    const plan = [
      {
        id: 'a',
        role: 'practiceFirst',
        title: '6+ m putts',
        instruction: 'Spend 15 minutes on distance control.',
        reason: 'Putting is costing points.',
      },
      {
        id: 'b',
        role: 'secondaryFocus',
        title: '100-150 m approaches',
        instruction: 'Hit 10 focused approach shots.',
        reason: 'Approach is below target.',
      },
      {
        id: 'c',
        role: 'onCourseCue',
        title: 'Closing 3 holes',
        instruction: 'Choose conservative targets late.',
        reason: 'Closing holes are fading.',
      },
    ];

    const { getByText } = render(wrap(<PracticePlanCard plan={plan} />));

    expect(getByText('Practice Plan')).toBeTruthy();
    expect(getByText('Practice first')).toBeTruthy();
    expect(getByText('Secondary focus')).toBeTruthy();
    expect(getByText('On-course cue')).toBeTruthy();
    expect(getByText('Spend 15 minutes on distance control.')).toBeTruthy();
  });
});
