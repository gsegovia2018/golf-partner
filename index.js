// Polyfill `crypto.getRandomValues` for the React Native (Hermes) runtime.
// Must load before any module that imports `uuid` (player IDs, sync queue,
// official admin) — otherwise uuidv4() throws "crypto.getRandomValues() not
// supported" on Android. No-op on web, which already has Web Crypto.
import 'react-native-get-random-values';
// Polyfill `Alert` on web — react-native-web ships it as a no-op, so without
// this every Alert.alert(...) (errors, confirmations) silently does nothing.
import './src/lib/webAlert';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
