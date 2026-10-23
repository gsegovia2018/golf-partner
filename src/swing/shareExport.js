// "Export swing" (D18): build the one-file export and open the share sheet. Nothing is sent
// automatically; the user picks where it goes. Resolves to 'shared' | 'unavailable' and
// rejects when the file could not be built.

import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { exportSwing } from '../store/swingStore';
import { SWING_STRINGS } from './strings';

export async function shareSwingExport(id) {
  const { zipUri, name } = await exportSwing(id);
  if (Platform.OS === 'web') {
    // a browser can't hand a stored file to a share sheet by URL: download it instead
    const a = document.createElement('a');
    a.href = zipUri;
    a.download = name || 'swing.swing.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'shared';
  }
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(zipUri, {
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
    dialogTitle: SWING_STRINGS.exportSwing.dialogTitle,
  });
  return 'shared';
}
