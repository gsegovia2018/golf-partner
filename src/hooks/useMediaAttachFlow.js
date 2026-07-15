import React, { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import CaptureMenuSheet from '../components/CaptureMenuSheet';
import AttachMediaSheet from '../components/AttachMediaSheet';
import BatchAttachSheet from '../components/BatchAttachSheet';
import { pickMedia, attachMedia, attachManyMedia } from '../lib/mediaCapture';

// One hook per screen that offers media uploads. Owns the capture-menu →
// pick → attach orchestration that FeedScreen, GalleryScreen and
// ScorecardScreen would otherwise each duplicate. Callers render `sheets`
// once and call `openCaptureMenu()` from their trigger (FAB, chip, button).
export default function useMediaAttachFlow({
  tournament,
  defaultRoundIndex = 0,
  defaultHoleIndex = null,
  extraActions = [],
  allowBatch = true,
  onAttached,
}) {
  const [captureMenuVisible, setCaptureMenuVisible] = useState(false);
  const [singleAsset, setSingleAsset] = useState(null);
  const [batchAssets, setBatchAssets] = useState(null);

  const rounds = tournament?.rounds ?? [];

  const openCaptureMenu = useCallback(() => setCaptureMenuVisible(true), []);

  const handleCaptureSelect = useCallback(async ({ source, mediaTypes }) => {
    setCaptureMenuVisible(false);
    try {
      const result = await pickMedia({
        source,
        mediaTypes,
        multi: allowBatch && source === 'library',
      });
      if (!result) return;
      if (Array.isArray(result)) {
        if (result.length === 0) return;
        if (result.length === 1) setSingleAsset(result[0]);
        else setBatchAssets(result);
      } else {
        setSingleAsset(result);
      }
    } catch (e) {
      Alert.alert("Couldn't capture", String(e?.message ?? e));
    }
  }, [allowBatch]);

  const onSingleConfirm = useCallback(async ({
    roundIndex, roundId, holeIndex, caption, uploaderLabel,
  }) => {
    const asset = singleAsset;
    setSingleAsset(null);
    if (!asset || !tournament) return;
    const resolvedRoundId = roundId ?? tournament.rounds?.[roundIndex]?.id;
    if (!resolvedRoundId) {
      Alert.alert("Couldn't attach", 'This round is no longer available.');
      return;
    }
    try {
      await attachMedia({
        tournamentId: tournament.id,
        roundId: resolvedRoundId,
        holeIndex,
        kind: asset.kind,
        localUri: asset.localUri,
        durationS: asset.durationS,
        caption,
        uploaderLabel,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
        fileSize: asset.fileSize,
      });
      onAttached?.();
    } catch (e) {
      Alert.alert("Couldn't attach", String(e?.message ?? e));
    }
  }, [singleAsset, tournament, onAttached]);

  const onBatchConfirm = useCallback(async (payload) => {
    setBatchAssets(null);
    if (!tournament) return;
    try {
      await attachManyMedia({ tournamentId: tournament.id, items: payload });
      onAttached?.();
    } catch (e) {
      Alert.alert("Couldn't attach", String(e?.message ?? e));
    }
  }, [tournament, onAttached]);

  // Extra menu entries (e.g. scorecard's "view memories") need the menu
  // closed before they act; wrap them so callers don't have to.
  const wrappedExtraActions = useMemo(() => extraActions.map((a) => ({
    ...a,
    onPress: () => {
      setCaptureMenuVisible(false);
      a.onPress();
    },
  })), [extraActions]);

  const sheets = (
    <>
      <CaptureMenuSheet
        visible={captureMenuVisible}
        onSelect={handleCaptureSelect}
        onClose={() => setCaptureMenuVisible(false)}
        extraActions={wrappedExtraActions}
      />
      <AttachMediaSheet
        visible={!!singleAsset}
        asset={singleAsset}
        rounds={rounds}
        defaultRoundIndex={defaultRoundIndex}
        defaultHoleIndex={defaultHoleIndex}
        onCancel={() => setSingleAsset(null)}
        onConfirm={onSingleConfirm}
      />
      <BatchAttachSheet
        visible={!!batchAssets}
        assets={batchAssets ?? []}
        rounds={rounds}
        defaultRoundIndex={defaultRoundIndex}
        onCancel={() => setBatchAssets(null)}
        onConfirm={onBatchConfirm}
      />
    </>
  );

  return { openCaptureMenu, sheets };
}
