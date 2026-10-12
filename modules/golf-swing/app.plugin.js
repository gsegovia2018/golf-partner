// Turns off MediaPipe Tasks usage statistics, so "Your video and analysis stay on this
// phone. Nothing is uploaded." stays literally true.
//
// MediaPipe Tasks (tasks-core 1.1.0) has no switch of its own: TaskRunner.create always
// builds a TasksStatsProtoLogger, whose RemoteLoggingClient sends task name, mode, call
// counts, latency and app id/version through Google's datatransport library to the CCT
// ("Clearcut") backend, log source COREML_ON_DEVICE_SOLUTIONS.
//
// datatransport finds its upload backends through <meta-data> on its
// TransportBackendDiscovery service. Removing the CCT entry means every event is refused
// at schedule time ("Transport backend 'cct' is not registered"): nothing is stored and
// nothing is uploaded. It is app-wide, not MediaPipe-only. In this app it also silences
// ML Kit's barcode telemetry (expo-camera) and FCM's BigQuery delivery-metrics export
// (off by default). FCM token registration and push delivery go through Google Play
// services and Firebase Installations, not datatransport, so push is unaffected.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const DISCOVERY = 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery';
const CCT_BACKEND = 'backend:com.google.android.datatransport.cct.CctBackendFactory';

function withoutCctTelemetry(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== DISCOVERY);
    app.service.push({
      $: { 'android:name': DISCOVERY, 'android:exported': 'false', 'tools:node': 'merge' },
      'meta-data': [{ $: { 'android:name': CCT_BACKEND, 'tools:node': 'remove' } }],
    });
    return cfg;
  });
}

module.exports = withoutCctTelemetry;
