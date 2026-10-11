// "Export swing" (D18): build the one-file export and open the share sheet. Nothing is sent
// automatically; the user picks where it goes. Resolves to 'shared' | 'unavailable' and
// rejects when the file could not be built.

import * as Sharing from 'expo-sharing';
import { exportSwing } from '../store/swingStore';
import { SWING_STRINGS } from './strings';

export async function shareSwingExport(id) {
  const { zipUri } = await exportSwing(id);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(zipUri, {
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
    dialogTitle: SWING_STRINGS.exportSwing.dialogTitle,
  });
  return 'shared';
}
