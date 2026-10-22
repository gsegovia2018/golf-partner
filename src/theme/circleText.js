import { Platform } from 'react-native';

// Spread into the style of a number, initials or check that sits inside a
// circle or badge. Android pads the line box with the font's win metrics, and
// Plus Jakarta's are lopsided (1296 above, 356 below per 1000 em), so a digit
// sits ~0.1 em below the circle's centre even though the Text is centred. Without the
// padding the line box is the hhea box (1038 / 222) and the digit lands within
// half a pixel of centre, as on web.
export const circleText = Platform.OS === 'android'
  ? { includeFontPadding: false, textAlignVertical: 'center' }
  : {};
