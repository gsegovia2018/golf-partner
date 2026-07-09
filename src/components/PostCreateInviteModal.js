import React from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '../theme/ThemeContext';

export default function PostCreateInviteModal({
  visible,
  loading,
  link,
  error,
  onRequestClose,
  onShare,
}) {
  const { theme } = useTheme();
  const s = makeStyles(theme);

  return (
    <Modal statusBarTranslucent hardwareAccelerated
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onRequestClose}
    >
      <Pressable style={s.backdrop} onPress={onRequestClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <Text style={s.title}>Invite players</Text>
          <Text style={s.subtitle}>
            Share this QR with players who do not have the app yet. App users will see this game in Golf Partner.
          </Text>

          {loading ? (
            <View style={s.loading}>
              <ActivityIndicator color={theme.accent.primary} />
              <Text style={s.loadingText}>Creating invite link…</Text>
            </View>
          ) : link ? (
            <>
              <View style={s.qrBox}>
                <QRCode
                  value={link}
                  size={156}
                  backgroundColor="#ffffff"
                  color="#000000"
                />
              </View>
              <Text style={s.link} selectable>{link}</Text>
              <TouchableOpacity
                style={s.primaryBtn}
                onPress={onShare}
                activeOpacity={0.8}
              >
                <Feather name="share-2" size={16} color={theme.text.inverse} style={{ marginRight: 8 }} />
                <Text style={s.primaryText}>Share link</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.error}>
                Game created, but the invite link could not be created right now. You can invite players later from the game menu.
              </Text>
              {!!error && <Text style={s.errorDetail}>{error}</Text>}
            </>
          )}

          {!loading && (
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={onRequestClose}
              activeOpacity={0.8}
            >
              <Text style={s.secondaryText}>
                {link ? 'Skip for now' : 'Continue'}
              </Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.bg.card,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 22,
      paddingBottom: 28,
      borderWidth: 1,
      borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    },
    handle: {
      width: 42,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.border.default,
      alignSelf: 'center',
      marginBottom: 18,
    },
    title: {
      fontFamily: 'PlayfairDisplay-Bold',
      color: theme.text.primary,
      fontSize: 26,
      letterSpacing: -0.3,
      textAlign: 'center',
    },
    subtitle: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      marginTop: 8,
      marginBottom: 18,
    },
    loading: {
      alignItems: 'center',
      paddingVertical: 24,
      gap: 10,
    },
    loadingText: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 13,
    },
    qrBox: {
      alignSelf: 'center',
      backgroundColor: '#ffffff',
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border.default,
      marginBottom: 12,
    },
    link: {
      fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.secondary,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
      marginBottom: 14,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accent.primary,
      borderRadius: 14,
      paddingVertical: 14,
      marginTop: 2,
    },
    primaryText: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      color: theme.text.inverse,
      fontSize: 14,
    },
    secondaryBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border.default,
      paddingVertical: 14,
      marginTop: 10,
    },
    secondaryText: {
      fontFamily: 'PlusJakartaSans-Bold',
      color: theme.text.secondary,
      fontSize: 14,
    },
    error: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.destructive,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      marginVertical: 18,
    },
    errorDetail: {
      fontFamily: 'PlusJakartaSans-Regular',
      color: theme.text.muted,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
      marginTop: -8,
      marginBottom: 18,
    },
  });
}
