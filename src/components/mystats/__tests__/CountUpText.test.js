import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import CountUpText from '../CountUpText';

// CountUpText nests a bare <Text> inside a styled parent <Text> in real use.
const wrap = (node) => <Text>{node}</Text>;

describe('CountUpText', () => {
  test('integer default: starts at 0 and lands on the whole number', async () => {
    const r = render(wrap(<CountUpText value={42} duration={80} />));
    expect(r.getByText('0')).toBeTruthy();
    await waitFor(() => expect(r.getByText('42')).toBeTruthy(), { timeout: 3000 });
  });

  test('integer default rounds a decimal input (unchanged behavior)', async () => {
    const r = render(wrap(<CountUpText value={94.3} duration={80} />));
    await waitFor(() => expect(r.getByText('94')).toBeTruthy(), { timeout: 3000 });
  });

  test('decimals: lands exactly on the decimal value', async () => {
    const r = render(wrap(<CountUpText value={94.3} decimals={1} duration={80} />));
    // Fixed-formatted from the first frame so the precision never jumps.
    expect(r.getByText('0.0')).toBeTruthy();
    await waitFor(() => expect(r.getByText('94.3')).toBeTruthy(), { timeout: 3000 });
  });

  test('decimals: pads a whole-number landing value to the stated precision', async () => {
    const r = render(wrap(<CountUpText value={94} decimals={1} duration={80} />));
    await waitFor(() => expect(r.getByText('94.0')).toBeTruthy(), { timeout: 3000 });
  });

  test('disabled (reduced motion): decimal value renders statically, no count-up', () => {
    const r = render(wrap(<CountUpText value={94.3} decimals={1} disabled />));
    expect(r.getByText('94.3')).toBeTruthy();
    expect(r.queryByText('0.0')).toBeNull();
  });

  test('disabled without decimals keeps the integer contract', () => {
    const r = render(wrap(<CountUpText value={94.3} disabled />));
    expect(r.getByText('94')).toBeTruthy();
  });
});
