import * as Sharing from 'expo-sharing';
import { shareSwingExport } from '../shareExport';
import { exportSwing } from '../../store/swingStore';

jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../store/swingStore', () => ({ exportSwing: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  exportSwing.mockResolvedValue({ zipUri: 'file:///cache/swing-export/s1/x.swing.zip' });
  Sharing.isAvailableAsync.mockResolvedValue(true);
  Sharing.shareAsync.mockResolvedValue(undefined);
});

test('shares the single zip through the share sheet', async () => {
  await expect(shareSwingExport('s1')).resolves.toBe('shared');
  expect(exportSwing).toHaveBeenCalledWith('s1');
  expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/swing-export/s1/x.swing.zip', expect.objectContaining({ mimeType: 'application/zip' }));
});

test('says so when sharing is not available', async () => {
  Sharing.isAvailableAsync.mockResolvedValue(false);
  await expect(shareSwingExport('s1')).resolves.toBe('unavailable');
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test('a failed export rejects before anything is shared', async () => {
  exportSwing.mockRejectedValue(new Error('Swing not found.'));
  await expect(shareSwingExport('s1')).rejects.toThrow('Swing not found');
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
