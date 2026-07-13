import React from 'react';
import { render } from '@testing-library/react-native';
import ScoreConflictSheet from '../ScoreConflictSheet';

// @testing-library/react-native's `render` (not bare react-test-renderer)
// matches the pattern already used for FinishConflictSheet.test.js — it
// wraps mount in act() and settles BottomSheet's entrance Animated.timing,
// which bare react-test-renderer leaves as a dangling async update here.
test('renders author names for candidates', () => {
  const { toJSON } = render(
    <ScoreConflictSheet
      visible hole={3} subjectName="Ana"
      candidates={[{ value: 4, ts: 1, authorId: 'a', authorName: 'Marco' }, { value: 5, ts: 2, authorId: 'b', authorName: 'Claudia' }]}
      blankAuthors={['Ana']}
      currentValue={5}
      onResolve={() => {}}
    />,
  );
  const text = JSON.stringify(toJSON());
  expect(text).toContain('Marco');
  expect(text).toContain('Claudia');
  expect(text).toContain('Ana');
});
