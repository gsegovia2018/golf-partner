import React from 'react';
import { ScrollView } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import CommentThread from '../CommentThread';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

jest.mock('../../store/feedStore', () => ({
  loadComments: jest.fn(() => Promise.resolve([
    { id: 'c1', body: 'Nice round!', createdAt: '2026-07-10T10:00:00Z', isMine: false, author: { name: 'Bea' } },
  ])),
  addComment: jest.fn(() => Promise.resolve(
    { id: 'c2', body: 'Thanks!', createdAt: '2026-07-10T10:05:00Z', isMine: true, author: { name: 'Ana' } },
  )),
  deleteComment: jest.fn(() => Promise.resolve(true)),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('CommentThread', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads and renders the thread', async () => {
    const { findByText } = render(wrap(<CommentThread itemKey="round:t1:r1" />));
    expect(await findByText('Nice round!')).toBeTruthy();
  });

  test('posts a comment optimistically', async () => {
    const { addComment } = require('../../store/feedStore');
    const onCountChange = jest.fn();
    const { findByText, getByPlaceholderText, getByLabelText } = render(wrap(
      <CommentThread itemKey="round:t1:r1" onCountChange={onCountChange} />,
    ));
    await findByText('Nice round!');

    fireEvent.changeText(getByPlaceholderText('Add a comment…'), 'Thanks!');
    fireEvent.press(getByLabelText('Post comment'));

    expect(await findByText('Thanks!')).toBeTruthy();
    expect(addComment).toHaveBeenCalledWith('round:t1:r1', 'Thanks!');
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith('round:t1:r1', 1));
  });

  test('shows the offline error when posting fails', async () => {
    const { addComment } = require('../../store/feedStore');
    addComment.mockResolvedValueOnce(null);
    const { findByText, getByPlaceholderText, getByLabelText } = render(wrap(
      <CommentThread itemKey="round:t1:r1" />,
    ));
    await findByText('Nice round!');

    fireEvent.changeText(getByPlaceholderText('Add a comment…'), 'Hello');
    fireEvent.press(getByLabelText('Post comment'));

    expect(await findByText(/Couldn't post/)).toBeTruthy();
  });

  test('scroll={false} (default) renders the list without a ScrollView', async () => {
    const { findByText, UNSAFE_queryAllByType } = render(wrap(
      <CommentThread itemKey="round:t1:r1" />,
    ));
    await findByText('Nice round!');

    expect(UNSAFE_queryAllByType(ScrollView).length).toBe(0);
  });

  test('scroll renders the list inside a ScrollView', async () => {
    const { findByText, UNSAFE_queryAllByType } = render(wrap(
      <CommentThread itemKey="round:t1:r1" scroll />,
    ));
    await findByText('Nice round!');

    expect(UNSAFE_queryAllByType(ScrollView).length).toBeGreaterThanOrEqual(1);
  });
});
