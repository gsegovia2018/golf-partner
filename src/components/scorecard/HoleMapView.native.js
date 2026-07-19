import React, { useEffect, useMemo, useRef } from 'react';
import { WebView } from 'react-native-webview';
import { buildHoleMapHtml } from '../../lib/holeMapHtml';

// Native host: renders the Leaflet map page in a WebView. Same contract as the
// web host — rebuilds only on hole/mode identity change; live updates are
// injected as postMessage into the page so it never reloads.
export function HoleMapView({ data, player, activeField, onPoint, style }) {
  const ref = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildHoleMapHtml(data), [data.holeKey]);

  const send = (m) => {
    const str = JSON.stringify(JSON.stringify(m));
    ref.current?.injectJavaScript(`window.postMessage(${str}, '*'); true;`);
  };

  useEffect(() => { send({ type: 'player', pos: player || null }); }, [player]);
  useEffect(() => { if (activeField) send({ type: 'activeField', field: activeField }); }, [activeField]);
  useEffect(() => { if (data.updateHole) send({ type: 'hole', hole: data }); }, [data]);

  return (
    <WebView
      ref={ref}
      source={{ html }}
      style={style}
      originWhitelist={['*']}
      javaScriptEnabled
      onMessage={(e) => {
        let m; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
        if (m.type === 'point') onPoint?.(m.field, m.pos, m.drag);
      }}
    />
  );
}
