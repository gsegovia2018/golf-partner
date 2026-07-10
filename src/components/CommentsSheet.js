import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BottomSheet from './BottomSheet';
import CommentThread from './CommentThread';
import { useTheme } from '../theme/ThemeContext';

// Bottom-sheet comment thread for a single feed item (a round or a photo
// reel), keyed by the feed item key. The thread itself (load, optimistic
// post, delete-own) lives in CommentThread, shared with the round summary.
export default function CommentsSheet({ visible, itemKey, onClose, onCountChange, onCommentAdded }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  return (
    <BottomSheet visible={visible} onClose={onClose} sheetStyle={s.sheet}>
      <View style={s.handle} />
      <Text style={s.title}>Comments</Text>
      <CommentThread
        itemKey={itemKey}
        active={visible}
        scroll
        onCountChange={onCountChange}
        onCommentAdded={onCommentAdded}
      />
    </BottomSheet>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  sheet: {
    backgroundColor: theme.bg.primary,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20,
    maxHeight: '80%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: theme.border.default, marginBottom: 10,
  },
  title: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 16, color: theme.text.primary,
    marginBottom: 12,
  },
});
