import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import useMediaAttachFlow from '../useMediaAttachFlow';
import { pickMedia, attachMedia, attachManyMedia } from '../../lib/mediaCapture';

jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(),
  attachMedia: jest.fn(() => Promise.resolve({ id: 'm1' })),
  attachManyMedia: jest.fn(() => Promise.resolve(['m1', 'm2'])),
}));

jest.mock('../../components/CaptureMenuSheet', () => function MockCaptureMenu({ visible, onSelect }) {
  const { Text, TouchableOpacity } = require('react-native');
  return visible ? (
    <TouchableOpacity onPress={() => onSelect({ source: 'library', mediaTypes: 'all' })}>
      <Text>mock-capture-menu</Text>
    </TouchableOpacity>
  ) : null;
});

jest.mock('../../components/AttachMediaSheet', () => function MockAttach({ visible, onConfirm }) {
  const { Text, TouchableOpacity } = require('react-native');
  return visible ? (
    <TouchableOpacity onPress={() => onConfirm({
      roundIndex: 1, roundId: 'r2', holeIndex: 4, caption: 'c', uploaderLabel: null,
    })}>
      <Text>mock-attach-sheet</Text>
    </TouchableOpacity>
  ) : null;
});

jest.mock('../../components/BatchAttachSheet', () => function MockBatch({ visible, onConfirm }) {
  const { Text, TouchableOpacity } = require('react-native');
  return visible ? (
    <TouchableOpacity onPress={() => onConfirm([
      { asset: { kind: 'photo', localUri: 'file://a.jpg' }, roundId: 'r1', holeIndex: null, caption: null, uploaderLabel: null },
    ])}>
      <Text>mock-batch-sheet</Text>
    </TouchableOpacity>
  ) : null;
});

const TOURNAMENT = {
  id: 't1',
  rounds: [
    { id: 'r1', holes: [{ par: 4 }] },
    { id: 'r2', holes: [{ par: 4 }] },
  ],
};

function Harness({ onAttached, allowBatch }) {
  const { openCaptureMenu, sheets } = useMediaAttachFlow({
    tournament: TOURNAMENT,
    defaultRoundIndex: 1,
    onAttached,
    allowBatch,
  });
  return (
    <>
      <TouchableOpacity onPress={openCaptureMenu}><Text>open</Text></TouchableOpacity>
      {sheets}
    </>
  );
}

describe('useMediaAttachFlow', () => {
  beforeEach(() => jest.clearAllMocks());

  test('single asset routes to AttachMediaSheet and attaches with the picked round', async () => {
    pickMedia.mockResolvedValue({
      kind: 'photo', localUri: 'file://a.jpg', durationS: null,
      mimeType: 'image/jpeg', fileName: 'a.jpg', fileSize: 123,
    });
    const onAttached = jest.fn();
    const { getByText, findByText } = render(<Harness onAttached={onAttached} />);
    fireEvent.press(getByText('open'));
    fireEvent.press(getByText('mock-capture-menu'));
    fireEvent.press(await findByText('mock-attach-sheet'));
    await waitFor(() => expect(attachMedia).toHaveBeenCalledWith(expect.objectContaining({
      tournamentId: 't1', roundId: 'r2', holeIndex: 4, caption: 'c', fileSize: 123,
    })));
    expect(onAttached).toHaveBeenCalled();
  });

  test('multiple assets route to BatchAttachSheet and attachManyMedia', async () => {
    pickMedia.mockResolvedValue([
      { kind: 'photo', localUri: 'file://a.jpg' },
      { kind: 'photo', localUri: 'file://b.jpg' },
    ]);
    const { getByText, findByText } = render(<Harness />);
    fireEvent.press(getByText('open'));
    fireEvent.press(getByText('mock-capture-menu'));
    fireEvent.press(await findByText('mock-batch-sheet'));
    await waitFor(() => expect(attachManyMedia).toHaveBeenCalledWith({
      tournamentId: 't1',
      items: [expect.objectContaining({ roundId: 'r1' })],
    }));
  });

  test('allowBatch: false picks a single asset even from the library', async () => {
    pickMedia.mockResolvedValue({ kind: 'photo', localUri: 'file://a.jpg' });
    const { getByText } = render(<Harness allowBatch={false} />);
    fireEvent.press(getByText('open'));
    fireEvent.press(getByText('mock-capture-menu'));
    await waitFor(() => expect(pickMedia).toHaveBeenCalledWith(
      expect.objectContaining({ multi: false }),
    ));
  });
});
