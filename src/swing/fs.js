// The swing library's file system: expo-file-system on Android. The web has its own build of the
// same subset (fs.web.js, IndexedDB behind a synchronous in-memory index), picked by Metro.

export { Paths, File, Directory } from 'expo-file-system';

/** Resolves once stored files can be read synchronously. Nothing to load on a phone. */
export async function fsReady() {}

/** A URI that can be stored and shown again after a restart. File URIs already are. */
export const storableUri = (uri) => uri;

/** The URI to show for a stored one (see storableUri). */
export const displayUri = (uri) => uri;

/** The bytes behind a URI, for code that needs the Blob itself (the web analyzer). Not used here. */
export async function blobOf() {
  throw new Error('blobOf is web-only');
}
