import React, { useEffect, useMemo, useRef } from 'react';
import { buildHoleMapHtml } from '../../lib/holeMapHtml';

// Web host: renders the Leaflet map page in an <iframe>. Rebuilds the page only
// when the hole/mode identity changes (data.holeKey); live player / activeField
// / marker updates go through postMessage so the map never reloads.
export function HoleMapView({ data, player, anchor, activeField, onPoint, style }) {
  const ref = useRef(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildHoleMapHtml(data), [data.holeKey]);

  const send = (m) => { ref.current?.contentWindow?.postMessage(JSON.stringify(m), '*'); };

  useEffect(() => {
    const h = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'point') onPoint?.(m.field, m.pos, m.drag);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onPoint]);

  useEffect(() => { send({ type: 'player', pos: player || null, anchor: anchor ?? null }); }, [player, anchor]);
  useEffect(() => { if (activeField) send({ type: 'activeField', field: activeField }); }, [activeField]);
  useEffect(() => { if (data.updateHole) send({ type: 'hole', hole: data }); }, [data]);

  return (
    <iframe
      ref={ref}
      srcDoc={html}
      title="hole map"
      style={{ border: 'none', width: '100%', height: '100%', display: 'block', ...flatten(style) }}
    />
  );
}

function flatten(style) {
  if (!style) return {};
  return Array.isArray(style) ? Object.assign({}, ...style) : style;
}
