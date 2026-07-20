import { formatDistance, unitSuffix, unitWord, M_TO_YD } from '../units';

test('meters pass through rounded', () => {
  expect(formatDistance(151.4, 'meters')).toBe('151');
  expect(formatDistance(null, 'meters')).toBe('—');
});

test('yards convert at 1.09361', () => {
  expect(formatDistance(100, 'yards')).toBe('109');
  expect(formatDistance(150, 'yards')).toBe('164');
});

test('suffix and word', () => {
  expect(unitSuffix('meters')).toBe('m');
  expect(unitSuffix('yards')).toBe('yd');
  expect(unitWord('yards')).toBe('yards');
  expect(unitWord('meters')).toBe('metres');
  expect(M_TO_YD).toBeCloseTo(1.09361);
});
