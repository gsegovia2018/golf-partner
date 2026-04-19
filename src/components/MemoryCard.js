import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

// Reads intrinsic image dimensions so the card keeps the native aspect
// instead of forcing everything square. Defaults to 1 while loading and on
// error — harmless if we can't measure.
function useImageAspect(uri) {
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => { if (!cancelled && w > 0 && h > 0) setRatio(w / h); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [uri]);
  return ratio;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-ES', {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

function formatDuration(s) {
  if (!s && s !== 0) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function MemoryCard({ item, roundIndex, onPress }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const ratio = useImageAspect(item.thumbUrl);

  const holePart = typeof item.holeIndex === 'number' ? `·H${item.holeIndex + 1}` : '';
  const tag = `R${roundIndex + 1}${holePart}`;
  const time = formatTime(item.createdAt);
  const who = item.uploaderLabel ? `${item.uploaderLabel} · ${time}` : time;

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.imgWrap, { aspectRatio: ratio }]}>
        <Image source={{ uri: item.thumbUrl }} style={StyleSheet.absoluteFillObject} />
        <View style={s.hTag}>
          <Text style={s.hTagText}>{tag}</Text>
        </View>
        {item.kind === 'video' ? (
          <View style={s.vTag}>
            <Feather name="play" size={10} color="#fff" />
            {item.durationS ? (
              <Text style={s.vTagText}>{formatDuration(item.durationS)}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={s.body}>
        {item.caption ? (
          <Text style={s.caption} numberOfLines={2}>{item.caption}</Text>
        ) : null}
        <Text style={s.meta}>{who}</Text>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.secondary,
    borderRadius: 10,
    overflow: 'hidden',
  },
  imgWrap: {
    width: '100%',
    backgroundColor: theme.bg.primary,
  },
  hTag: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 999,
  },
  hTagText: {
    color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 10,
  },
  vTag: {
    position: 'absolute', top: 6, right: 6,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 999, gap: 3,
  },
  vTagText: {
    color: '#fff', fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 9,
  },
  body: { padding: 8, paddingBottom: 10 },
  caption: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 12, color: theme.text.primary, lineHeight: 16,
  },
  meta: {
    fontFamily: 'PlusJakartaSans-Regular',
    fontSize: 10, color: theme.text.muted, marginTop: 3,
  },
});
