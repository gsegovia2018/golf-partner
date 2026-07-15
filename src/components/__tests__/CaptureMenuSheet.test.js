import React from 'react';
import { render } from '@testing-library/react-native';
import CaptureMenuSheet from '../CaptureMenuSheet';

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: { primary: '#006747' },
      bg: { primary: '#ffffff' },
      border: { subtle: '#ece8e1' },
      text: {
        muted: '#6b7280',
        primary: '#1a1a1a',
      },
    },
  }),
}));

describe('CaptureMenuSheet', () => {
  test('shows the gallery video size limit before selecting media', () => {
    const { getByText } = render(
      <CaptureMenuSheet visible onSelect={jest.fn()} onClose={jest.fn()} />
    );

    expect(getByText('Videos up to 100 MB')).toBeTruthy();
  });
});
