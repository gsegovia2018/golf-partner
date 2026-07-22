import React from 'react';
import { render } from '@testing-library/react-native';
import { ClubIcon } from '../ClubIcon';

describe('ClubIcon', () => {
  it('renders an svg at the given size', () => {
    const { toJSON } = render(<ClubIcon size={26} color="#0a0d10" />);
    expect(toJSON()).toBeTruthy();
  });
});
