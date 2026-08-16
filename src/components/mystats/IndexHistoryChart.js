import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';

// Index-history chart for the Handicap tab. Two modes share one frame:
//  - 'round': a step line, one step per qualifying round (the index is a
//    step function — it only moves when a round is posted). The personal-low
//    point gets the ceremonial gold dot and a small annotation.
//  - 'month': one point per calendar month; segments into months without a
//    qualifying round are dashed, so idle stretches (winter break) read as
//    "carried flat", not hidden.
//
// data: [{ value, label, detail?, played?, isLow? }] — `played` only matters
// in month mode (defaults to true); at most one point should carry `isLow`;
// `detail` names the point in the inspect tooltip (course · date, month).
// lowLabel: annotation text next to the gold dot (round mode only).
//
// Points are inspectable: hover (web) or tap (touch) shows a tooltip with
// the value and the round behind it; tapping the same point again hides it.
export default function IndexHistoryChart({ data = [], mode = 'round', lowLabel }) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const [sel, setSel] = useState(null);

  useEffect(() => { setSel(null); }, [mode, data]);

  const height = 150;
  const padL = 30;
  const padR = 14;
  const padTop = 12;
  const padBottom = 26;
  const baseY = height - padBottom;

  const gold = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;
  const goldText = theme.isDark ? theme.semantic.winner.soft : theme.semantic.winner.light;
  const stroke = theme.accent.primary;

  const values = data.map((p) => p.value).filter((v) => v != null);
  const geom = useMemo(() => {
    if (width === 0 || data.length < 2 || values.length < 2) return null;
    const vmin = Math.min(...values) - 0.4;
    const vmax = Math.max(...values) + 0.4;
    const span = Math.max(vmax - vmin, 1);
    const sx = (i) => padL + ((width - padL - padR) * i) / (data.length - 1);
    const sy = (v) => padTop + ((baseY - padTop) * (vmax - v)) / span;
    const ticks = [];
    const step = Math.max(1, Math.ceil((Math.floor(vmax) - Math.ceil(vmin)) / 3));
    for (let t = Math.ceil(vmin); t <= Math.floor(vmax); t += step) ticks.push(t);
    return { sx, sy, ticks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, data, mode]);

  // The wrapper always mounts (even before geometry exists) — onLayout must
  // fire once to learn the width, otherwise the chart could never appear.
  if (data.length < 2 || values.length < 2) return null;
  const n = data.length;
  const lowIdx = data.findIndex((p) => p.isLow);
  const last = data[n - 1];

  const a11y = `Handicap index history, ${mode === 'round' ? 'by round' : 'by month'}: `
    + `from ${data[0].value.toFixed(1)} to ${last.value.toFixed(1)}`;

  // One invisible hit strip per point (hover on web, tap on touch), split at
  // the midpoints between neighbours so the whole chart surface is live.
  const step = geom ? (width - padL - padR) / (n - 1) : 0;
  const strips = geom ? data.map((p, i) => {
    const x0 = i === 0 ? 0 : padL + step * (i - 0.5);
    const x1 = i === n - 1 ? width : padL + step * (i + 0.5);
    return { i, left: x0, width: x1 - x0 };
  }) : [];

  const selPoint = sel != null ? data[sel] : null;
  const tipLeft = geom && sel != null
    ? Math.min(Math.max(geom.sx(sel) - 62, 2), Math.max(2, width - 126))
    : 0;

  return (
    <View
      testID="index-history-chart"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height }}
      accessibilityLabel={a11y}
    >
      {geom && renderSvg(geom)}
      {strips.map(({ i, left, width: w }) => (
        <Pressable
          key={`hit-${i}`}
          style={{ position: 'absolute', left, width: w, top: 0, bottom: 0 }}
          onHoverIn={() => setSel(i)}
          onHoverOut={() => setSel((s) => (s === i ? null : s))}
          onPress={() => setSel((s) => (s === i ? null : i))}
          accessibilityRole="button"
          accessibilityLabel={`${data[i].value.toFixed(1)}${data[i].detail ? ` — ${data[i].detail}` : ''}`}
        />
      ))}
      {selPoint && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 2,
            left: tipLeft,
            maxWidth: 190,
            backgroundColor: theme.bg.primary,
            borderWidth: 1,
            borderColor: theme.border.default,
            borderRadius: theme.radius.sm,
            paddingVertical: 5,
            paddingHorizontal: 9,
          }}
        >
          <Text
            style={{
              fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold',
              color: theme.text.primary, fontVariant: ['tabular-nums'],
            }}
          >
            {selPoint.value.toFixed(1)}
          </Text>
          {selPoint.detail ? (
            <Text
              style={{ fontSize: 10.5, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary }}
              numberOfLines={1}
            >
              {selPoint.detail}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );

  function renderSvg({ sx, sy, ticks }) {
    // Step path for round mode: hold the previous value until the new round.
    let stepPath = `M ${sx(0)} ${sy(data[0].value)}`;
    for (let i = 1; i < n; i += 1) {
      stepPath += ` L ${sx(i)} ${sy(data[i - 1].value)} L ${sx(i)} ${sy(data[i].value)}`;
    }

    const xLabels = [
      { i: 0, anchor: 'start' },
      { i: Math.floor((n - 1) / 2), anchor: 'middle' },
      { i: n - 1, anchor: 'end' },
    ].filter((l, k, arr) => arr.findIndex((o) => o.i === l.i) === k);

    return (
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t) => (
          <React.Fragment key={`tick-${t}`}>
            <Line x1={padL} y1={sy(t)} x2={width - padR} y2={sy(t)} stroke={theme.border.default} strokeWidth="1" />
            <SvgText x={padL - 7} y={sy(t) + 3.5} fontSize={10} fontWeight="600" fill={theme.text.muted} textAnchor="end">
              {t}
            </SvgText>
          </React.Fragment>
        ))}

        {mode === 'round' ? (
          <>
            <Path
              d={`${stepPath} L ${sx(n - 1)} ${baseY} L ${sx(0)} ${baseY} Z`}
              fill={stroke}
              opacity={0.07}
            />
            <Path d={stepPath} fill="none" stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" />
            {data.map((p, i) => (
              i === lowIdx || i === n - 1 ? null : (
                <Circle key={`d-${i}`} cx={sx(i)} cy={sy(p.value)} r={2.2} fill={stroke} />
              )
            ))}
            <SvgText x={sx(0)} y={sy(data[0].value) - 8} fontSize={10} fontWeight="700" fill={theme.text.muted} textAnchor="start">
              {data[0].value.toFixed(1)}
            </SvgText>
            {lowIdx >= 0 && (
              <>
                <Circle cx={sx(lowIdx)} cy={sy(data[lowIdx].value)} r={4} fill={gold} />
                {lowLabel ? (
                  // Below the dot: the low is the chart's minimum, so nothing
                  // is ever drawn under it. Clamped so the label stays inside.
                  <SvgText
                    x={Math.min(Math.max(sx(lowIdx), padL + 44), width - padR - 44)}
                    y={sy(data[lowIdx].value) + 16}
                    fontSize={10}
                    fontWeight="700"
                    fill={goldText}
                    textAnchor="middle"
                  >
                    {lowLabel}
                  </SvgText>
                ) : null}
              </>
            )}
          </>
        ) : (
          <>
            {data.slice(1).map((p, k) => (
              <Line
                key={`seg-${k}`}
                x1={sx(k)}
                y1={sy(data[k].value)}
                x2={sx(k + 1)}
                y2={sy(p.value)}
                stroke={stroke}
                strokeWidth={p.played === false ? 1.6 : 2.2}
                strokeLinecap="round"
                strokeDasharray={p.played === false ? '2 5' : undefined}
              />
            ))}
            {data.map((p, i) => (
              p.played === false || i === n - 1 ? null : (
                <Circle key={`m-${i}`} cx={sx(i)} cy={sy(p.value)} r={2.6} fill={stroke} />
              )
            ))}
          </>
        )}

        <Circle
          cx={sx(n - 1)}
          cy={sy(last.value)}
          r={4.2}
          fill={stroke}
          stroke={theme.bg.card}
          strokeWidth={2}
        />

        {sel != null && (
          <>
            <Line
              x1={sx(sel)}
              y1={padTop}
              x2={sx(sel)}
              y2={baseY}
              stroke={theme.text.muted}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <Circle
              cx={sx(sel)}
              cy={sy(data[sel].value)}
              r={5}
              fill={data[sel].isLow ? gold : stroke}
              stroke={theme.bg.card}
              strokeWidth={2}
            />
          </>
        )}

        {xLabels.map(({ i, anchor }) => (
          <SvgText key={`x-${i}`} x={sx(i)} y={height - 8} fontSize={10} fontWeight="600" fill={theme.text.muted} textAnchor={anchor}>
            {data[i].label}
          </SvgText>
        ))}
      </Svg>
    );
  }
}
