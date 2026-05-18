// Jest mock for @react-native-community/netinfo
export default {
  addEventListener: () => () => {},
  fetch: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
  useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
};
