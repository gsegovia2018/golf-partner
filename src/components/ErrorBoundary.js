import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { captureException } from '../lib/errorReporting';
import { semantic } from '../theme/tokens';

// App-wide error boundary. Without it, any uncaught render error unmounts the
// whole React tree and the user is left staring at a blank screen with no way
// out. This catches the error, shows a friendly fallback, and lets the user
// retry — which remounts the wrapped subtree.
//
// Uses hard-coded brand colours rather than the theme: the boundary may sit
// above (or be catching a crash inside) the ThemeProvider, so useTheme() is
// not safe here.
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Route through the reporting layer: it logs to the console (dev/device
    // logs) AND records the crash so it isn't invisible in production. Attach a
    // vendor SDK via installReporter (see src/lib/errorReporting.js) to ship it.
    captureException(error, { source: 'ErrorBoundary', componentStack: info?.componentStack });
  }

  handleRetry = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text style={styles.body}>
            La app encontró un error inesperado. Inténtalo de nuevo.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={this.handleRetry}
            accessibilityRole="button"
            accessibilityLabel="Reintentar"
          >
            <Text style={styles.buttonText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#006747',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 10,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#e6f0eb',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 21,
  },
  button: {
    backgroundColor: semantic.winner.dark,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#006747',
  },
});
