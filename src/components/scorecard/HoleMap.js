import React, { useMemo, useState, useCallback, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Polygon, Circle, Line } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import {
  holeFeatures, greenDistances,
  subscribeCourseGeometry, getCourseGeometryVersion,
} from '../../lib/geo';

const W = 200;
const H = 250;
const PAD = 0.14;

function fmt(m) { return m == null ? '—' : `${Math.round(m)}`; }

// Top-down vector diagram of one hole: green outline, hazards, tees, and the
// live player position, rotated so the tee->green line points up. Pure SVG —
// no map tiles, works offline. Tap anywhere to drop a measuring marker and read
// front/center/back to the green from that point — a manual rangefinder that
// works with no GPS at all. Renders nothing when the hole has no polygon
// geometry (greens-mode courses). Player [lat,lng] is optional.
export function HoleMap({ courseName, holeNumber, position }) {
  const { theme } = useTheme();
  const geomVersion = useSyncExternalStore(subscribeCourseGeometry, getCourseGeometryVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const feat = useMemo(() => holeFeatures(courseName, holeNumber), [courseName, holeNumber, geomVersion]);
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [containerW, setContainerW] = useState(W);
  const [manual, setManual] = useState(null); // { latlng, screen:[x,y] } in viewBox coords

  // Clear the manual marker whenever the hole changes.
  const holeKey = `${courseName}#${holeNumber}`;
  const [lastKey, setLastKey] = useState(holeKey);
  if (holeKey !== lastKey) { setLastKey(holeKey); setManual(null); }

  const model = useMemo(() => {
    if (!feat?.green && !feat?.greenCenter) return null;
    const [lat0, lon0] = feat.greenCenter;
    const mLat = 111320;
    const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const toEN = ([lat, lng]) => [(lng - lon0) * mLng, (lat - lat0) * mLat];

    let theta = 0;
    if (feat.start) {
      const [se, sn] = toEN(feat.start);
      theta = Math.PI / 2 - Math.atan2(0 - sn, 0 - se);
    }
    const ct = Math.cos(theta);
    const st = Math.sin(theta);

    // fit transform is derived from feature bounds; compute in two passes.
    const projRaw = (ll) => { const [e, n] = toEN(ll); return [e * ct - n * st, -(e * st + n * ct)]; };
    const green = feat.green ? feat.green.map(projRaw) : null;
    const greenC = projRaw(feat.greenCenter);
    const tees = feat.tees ? feat.tees.map(projRaw) : null;
    const start = feat.start ? projRaw(feat.start) : null;
    const hazards = (feat.hazards ?? []).map((hz) => ({ kind: hz.kind, pts: feat.green ? hz.poly.map(projRaw) : [] }));
    const featPts = [greenC, ...(green ?? []), ...(tees ?? []), ...(start ? [start] : []), ...hazards.flatMap((h) => h.pts)];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of featPts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 8), spanY = Math.max(maxY - minY, 8);
    const scale = Math.min((W * (1 - 2 * PAD)) / spanX, (H * (1 - 2 * PAD)) / spanY);
    const screen = ([x, y]) => [(x - cx) * scale + W / 2, (y - cy) * scale + H / 2];
    const clamp = ([x, y]) => [Math.max(6, Math.min(W - 6, x)), Math.max(6, Math.min(H - 6, y))];
    const pts = (arr) => arr.map(screen).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    // Inverse: viewBox screen point -> [lat, lng] (for tap-to-measure).
    const screenToLatLng = ([vx, vy]) => {
      const X = (vx - W / 2) / scale + cx;
      const Y = (vy - H / 2) / scale + cy;
      const rx = X, ry = -Y;
      const e = rx * ct + ry * st;
      const n = -rx * st + ry * ct;
      return [lat0 + n / mLat, lon0 + e / mLng];
    };
    const player = position ? clamp(screen(projRaw(position))) : null;

    return {
      green: green ? pts(green) : null,
      greenC: screen(greenC),
      tees: tees ? pts(tees) : null,
      start: start ? screen(start) : null,
      hazards: hazards.map((h) => ({ kind: h.kind, pts: pts(h.pts) })),
      player, playerOff: position ? outOfBounds(screen(projRaw(position))) : false,
      screenToLatLng,
      greenPoly: feat.green ?? null,
      greenCenterLL: feat.greenCenter,
    };
  }, [feat, position]);

  // Tap -> viewBox coords -> latlng -> distances. containerW maps device px to
  // the 200-wide viewBox (uniform, since Svg height tracks width * H/W).
  const onTap = useCallback((e) => {
    if (!model) return;
    const { locationX, locationY } = e.nativeEvent;
    const k = W / (containerW || W);
    const vx = locationX * k;
    const vy = locationY * k;
    const latlng = model.screenToLatLng([vx, vy]);
    setManual({ latlng, screen: [vx, vy] });
  }, [model, containerW]);

  if (!model) return null;
  const water = theme.accent.primary;
  const greenFill = '#57ae5b';
  const svgH = (containerW || W) * (H / W);

  const measured = manual
    ? greenDistances(manual.latlng, model.greenPoly, model.greenCenterLL)
    : null;

  return (
    <View style={s.wrap}>
      <Pressable onPress={onTap} onLayout={(e) => setContainerW(e.nativeEvent.layout.width)} style={s.mapArea}>
        <Svg width={containerW || W} height={svgH} viewBox={`0 0 ${W} ${H}`}>
          {model.hazards.map((h, i) => (
            <Polygon key={i} points={h.pts}
              fill={h.kind === 'water' ? water + '55' : '#e6d7a8'}
              stroke={h.kind === 'water' ? water : '#c7b581'} strokeWidth={1} />
          ))}
          {model.tees && <Polygon points={model.tees} fill="#9aa0a6" stroke="#7c8288" strokeWidth={1} />}
          {model.start && (
            <Line x1={model.start[0]} y1={model.start[1]} x2={model.greenC[0]} y2={model.greenC[1]}
              stroke={theme.text.muted} strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
          )}
          {model.green
            ? <Polygon points={model.green} fill={greenFill} stroke="#3f8f43" strokeWidth={1.5} />
            : <Circle cx={model.greenC[0]} cy={model.greenC[1]} r={10} fill={greenFill} stroke="#3f8f43" strokeWidth={1.5} />}
          <Circle cx={model.greenC[0]} cy={model.greenC[1]} r={2.5} fill="#fff" stroke="#3f8f43" strokeWidth={1} />
          {/* manual measuring marker */}
          {manual && (
            <>
              <Line x1={manual.screen[0]} y1={manual.screen[1]} x2={model.greenC[0]} y2={model.greenC[1]}
                stroke={theme.text.primary} strokeWidth={1} strokeDasharray="2 3" opacity={0.8} />
              <Circle cx={manual.screen[0]} cy={manual.screen[1]} r={4} fill="#fff" stroke={theme.text.primary} strokeWidth={2} />
            </>
          )}
          {/* live player */}
          {model.player && (
            <>
              {!model.playerOff && <Line x1={model.player[0]} y1={model.player[1]} x2={model.greenC[0]} y2={model.greenC[1]} stroke={water} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />}
              <Circle cx={model.player[0]} cy={model.player[1]} r={5} fill={water} stroke="#fff" strokeWidth={2} />
            </>
          )}
        </Svg>
      </Pressable>
      {measured ? (
        <Pressable onPress={() => setManual(null)} style={s.readout}>
          <Text style={s.readoutLabel}>Tapped point</Text>
          <Text style={s.readoutVals}>
            <Text style={s.tag}>F </Text>{fmt(measured.front)}  <Text style={s.tag}>C </Text>{fmt(measured.center)}  <Text style={s.tag}>B </Text>{fmt(measured.back)}<Text style={s.unit}> m</Text>
          </Text>
          <Text style={s.clear}>tap to clear</Text>
        </Pressable>
      ) : (
        <Text style={s.caption}>Hole {holeNumber} · tap map to measure{model.playerOff ? ' · you are off the edge' : ''}</Text>
      )}
    </View>
  );
}

function outOfBounds([x, y]) { return x < 4 || x > W - 4 || y < 4 || y > H - 4; }

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: {
      marginHorizontal: 12, marginTop: 6, borderRadius: 18, borderWidth: 1,
      borderColor: theme.accent.primary + '30',
      backgroundColor: theme.isDark ? '#14321c' : '#eef6ee',
      paddingVertical: 8, paddingHorizontal: 8,
    },
    mapArea: { alignSelf: 'stretch' },
    caption: { fontSize: 11, fontWeight: '600', color: theme.text.muted, marginTop: 4, textAlign: 'center' },
    readout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
    readoutLabel: { fontSize: 11, fontWeight: '600', color: theme.text.muted },
    readoutVals: { fontSize: 14, fontWeight: '700', color: theme.text.primary, fontVariant: ['tabular-nums'] },
    tag: { fontSize: 10, fontWeight: '600', color: theme.text.muted },
    unit: { fontSize: 11, color: theme.text.muted },
    clear: { fontSize: 10, color: theme.accent.primary },
  });
}
