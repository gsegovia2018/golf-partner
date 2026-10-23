// Where the web swing analyzer's runtime files are served (public/swing-web, copied there by
// scripts/copySwingWebAssets.mjs). Absolute from the site root, so a deep link still finds them.
export const ASSET_BASE = '/swing-web';

export const assetUrl = (name) => `${ASSET_BASE}/${name}`;
