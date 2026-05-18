import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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
    // Surfaced to the console so it's visible in dev / device logs. Wire a
    // crash reporter (e.g. Sentry) in here when one is added.
    console.error('Uncaught UI error', error, info?.componentStack);
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
    backgroundColor: '#ffd700',
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
