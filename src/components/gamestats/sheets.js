// Builders for the StatDetailSheet content ({ title, subtitle, explainer, rows })
// the Game Stats tabs open. Presentation only: every number comes from the
// engine records the tabs already hold. Call at render/event time (uses t()).
// `single` (a one-round game) names holes without the round and course.
import { t } from '../../i18n';
import { getPlayingHandicap, calcStablefordPoints } from '../../store/tournamentStore';
import { holeCountOf } from '../../store/scoring';
import { firstName, joinNames, num, signed } from './ui';

export const roundTag = (i) => t('stats.screen.roundShort', { n: i + 1 });
const pts = (v) => t('stats.screen.pts', { n: num(v) });
const str = (v) => t('stats.screen.str', { n: num(v) });
const roundHole = (b, single) => (single
  ? t('stats.screen.hole', { n: b.holeNumber })
  : t('stats.screen.roundHole', { round: b.roundIndex + 1, course: b.courseName, hole: b.holeNumber }));
const parStrokes = (b) => t('stats.screen.parStrokes', { par: b.par, strokes: b.strokes });
export const toneForPoints = (p) => (p >= 3 ? 'excellent' : p === 2 ? 'good' : p === 1 ? 'neutral' : 'poor');

const holeRow = (b, i, tone, single) => ({
  key: `${b.roundIndex}-${b.holeNumber}-${i}`,
  primary: roundHole(b, single),
  secondary: parStrokes(b),
  rightPrimary: pts(b.points),
  tone: tone ?? toneForPoints(b.points),
});
const section = (key, label, rightLabel) => ({ key: `sec-${key}`, section: true, label, rightLabel });

// Rows grouped under a header per player when the award is shared.
function rowsByPlayer(entries, makeRows, headerRight) {
  if (entries.length === 1) return makeRows(entries[0]);
  const groups = new Map();
  entries.forEach((e) => {
    const g = groups.get(e.player.id) || { player: e.player, items: [] };
    g.items.push(e);
    groups.set(e.player.id, g);
  });
  const out = [];
  [...groups.values()].forEach(({ player, items }, idx) => {
    const label = items.length > 1 ? `${firstName(player)} ×${items.length}` : firstName(player);
    out.push(section(`${idx}`, label, items.length === 1 && headerRight ? headerRight(items[0]) : null));
    items.forEach((e) => out.push(...makeRows(e)));
  });
  return out;
}

// ── Award sheets ──
export function awardSheet(award, { single = false } = {}) {
  const d = award.data;
  const names = joinNames(award.players);
  const awardTitle = t(award.titleKey ?? `stats.game.award.title.${award.id}`);
  const title = `${awardTitle} · ${names}`;
  const where = (b) => roundHole(b, single);
  const row = (b, i, tone) => holeRow(b, i, tone, single);
  switch (award.id) {
    case 'bestRound':
      return {
        title,
        subtitle: t('stats.screen.namesPts', { names, value: num(d.value) }),
        explainer: t('stats.screen.best.explainerPoints'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b) => ({
          key: `${e.player.id}-${e.roundIndex}-${b.holeNumber}`,
          primary: t('stats.screen.hole', { n: b.holeNumber }),
          secondary: parStrokes(b),
          rightPrimary: pts(b.points),
          tone: toneForPoints(b.points),
        })), (e) => `${roundTag(e.roundIndex)} · ${e.courseName}`),
      };
    case 'hotStretch':
      return {
        title,
        subtitle: single
          ? `H${d.startHole}–H${d.endHole}`
          : `${roundTag(d.roundIndex)} · ${d.breakdown[0]?.courseName ?? ''} · H${d.startHole}–H${d.endHole}`,
        explainer: t('stats.screen.hotStretch.explainer'),
        rows: d.breakdown.map((b, i) => row(b, i)),
      };
    case 'birdiesNet':
    case 'birdiesGross':
      return {
        title,
        subtitle: t(award.id === 'birdiesNet' ? 'stats.game.sheet.netBirdies' : 'stats.game.sheet.grossBirdies'),
        explainer: t('stats.screen.birdies.explainer'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: where(b),
          secondary: parStrokes(b),
          rightPrimary: b.vsPar <= -2 ? t('stats.screen.eagle') : t('stats.screen.birdie'),
          tone: 'excellent',
        })), (e) => t('stats.screen.birdies.count', { count: e.count })),
      };
    case 'parStreak':
      return {
        title,
        subtitle: t('stats.screen.nHoles', { count: d.value }),
        explainer: t('stats.screen.parStreak.explainer'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b, i) => row(b, i, b.vsPar <= -1 ? 'excellent' : 'good'))),
      };
    case 'skins': {
      const winners = d.rounds.flatMap((r) => r.holes.filter((h) => h.winner));
      return {
        title,
        subtitle: t('stats.game.award.skinsDetail', { count: d.totalSkins }),
        explainer: t('stats.screen.skins.explainerPoints'),
        rows: [
          section('table', t('stats.game.sheet.skinsTable')),
          ...d.leaderboard.map((r) => ({
            key: `p-${r.player.id}`,
            primary: r.player.name,
            secondary: t('stats.screen.h2h.ties', { count: r.ties }),
            rightPrimary: t('stats.game.award.skins', { count: r.skins }),
            tone: r.skins > 0 ? 'excellent' : undefined,
          })),
          section('holes', t('stats.game.sheet.skinHoles')),
          ...winners.map((h, i) => ({
            key: `h-${h.roundIndex}-${h.holeNumber}-${i}`,
            primary: where(h),
            secondary: firstName(h.winner),
            rightPrimary: pts(h.bestVal),
            tone: 'excellent',
          })),
        ],
      };
    }
    case 'worstHole': {
      const single = (e, key) => ({
        key: `${key}-${e.player.id}-${e.roundIndex}-${e.holeNumber}`,
        primary: `${firstName(e.player)} · ${where(e)}`,
        secondary: t('stats.screen.shame.blowupRow', { strokes: e.strokes, over: num(e.grossVsPar ?? e.vsPar) }),
        rightPrimary: pts(e.points),
        tone: 'poor',
      });
      return {
        title,
        subtitle: t('stats.game.sheet.worstHoleSub'),
        explainer: t('stats.game.sheet.worstHoleExplainer'),
        rows: [
          ...(d.blowup ? [section('blowup', t('stats.game.sheet.blowup')), ...d.blowup.entries.map((e) => single(e, 'b'))] : []),
          ...(d.tripleBogey ? [section('triple', t('stats.game.sheet.triple')), ...d.tripleBogey.entries.map((e) => single(e, 't'))] : []),
        ],
      };
    }
    case 'coldStreak': {
      const streakRows = (key, stat, label) => (stat ? [
        section(key, label, t('stats.screen.nHoles', { count: stat.value })),
        ...stat.entries.flatMap((e) => e.breakdown.map((b, i) => ({
          ...row(b, i, b.points === 0 ? 'poor' : 'neutral'),
          key: `${key}-${e.player.id}-${b.roundIndex}-${b.holeNumber}-${i}`,
          primary: `${firstName(e.player)} · ${where(b)}`,
        }))),
      ] : []);
      const zeroRows = d.zero ? [
        section('zero', t('stats.game.sheet.zero')),
        ...d.zero.entries.map((e, i) => ({
          key: `zero-${i}`,
          primary: single ? firstName(e.player) : `${firstName(e.player)} · ${roundTag(e.roundIndex)} · ${e.courseName}`,
          rightPrimary: t('stats.screen.shame.zeroHoles', { count: e.count }),
          tone: 'poor',
        })),
      ] : [];
      return {
        title,
        subtitle: t('stats.game.sheet.coldSub'),
        explainer: t('stats.game.sheet.coldExplainer'),
        rows: [
          ...streakRows('pointless', d.pointless, t('stats.game.award.cold.pointless')),
          ...streakRows('double', d.double, t('stats.game.award.cold.double')),
          ...streakRows('bogey', d.bogey, t('stats.game.award.cold.bogey')),
          ...zeroRows,
        ],
      };
    }
    case 'gift':
      return {
        title,
        subtitle: t('stats.game.award.gift', { count: num(d.value) }),
        explainer: t('stats.screen.shame.giftExplainer'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b) => ({
          key: `${e.player.id}-${e.roundIndex}-${e.holeNumber}-${b.playerId}`,
          primary: b.playerName,
          secondary: t('stats.screen.strokesN', { n: b.strokes }),
          rightPrimary: pts(b.points),
          tone: b.playerId === e.player.id ? 'poor' : toneForPoints(b.points),
        })), (e) => where(e)),
      };
    case 'collapse':
      return {
        title,
        subtitle: t('stats.game.award.collapse', { count: num(d.value) }),
        explainer: t('stats.screen.shame.collapseExplainer'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b) => ({
          key: `${e.player.id}-${e.roundIndex}-${b.holeNumber}`,
          primary: t(b.holeNumber <= 9 ? 'stats.screen.shame.holeFront' : 'stats.screen.shame.holeBack', { n: b.holeNumber }),
          secondary: parStrokes(b),
          rightPrimary: pts(b.points),
          tone: toneForPoints(b.points),
        })), (e) => (single ? `${e.front}/${e.back}` : `${roundTag(e.roundIndex)} · ${e.front}/${e.back}`)),
      };
    case 'par3':
      return {
        title,
        subtitle: t('stats.screen.shame.par3Subtitle', { value: num(d.value) }),
        explainer: t('stats.screen.shame.par3Explainer'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${i}`,
          primary: where(b),
          secondary: t('stats.screen.parSi', { par: b.par, si: b.si }),
          rightPrimary: `${str(b.strokes)} · ${pts(b.points)}`,
          tone: b.points === 0 ? 'poor' : b.points === 1 ? 'neutral' : 'good',
        })), (e) => t('stats.screen.shame.par3Header', { avg: num(e.avgStrokes), count: e.holes })),
      };
    case 'pickup':
      return {
        title,
        subtitle: t('stats.screen.shame.pickupSubtitle'),
        explainer: t('stats.screen.shame.pickupExplainer'),
        rows: rowsByPlayer(d.entries, (e) => e.breakdown.map((b, i) => ({
          key: `${e.player.id}-${i}`,
          primary: where(b),
          secondary: t('stats.screen.parSiStrokes', { par: b.par, si: b.si, strokes: b.strokes }),
          rightPrimary: pts(0),
          tone: 'poor',
        })), (e) => t('stats.screen.shame.pickups', { count: e.pickups })),
      };
    case 'anchor':
      return {
        title,
        subtitle: t('stats.screen.shame.anchorSubtitle', { value: num(d.value) }),
        explainer: t('stats.screen.shame.anchorExplainer'),
        rows: d.all.filter((a) => a.mbCount + a.pbCount > 0).map((a) => ({
          key: a.player.id,
          primary: a.player.name,
          secondary: `MB ${a.mbCount} · PB ${a.pbCount}`,
          rightPrimary: signed(a.anchorScore),
          tone: a.anchorScore >= 5 ? 'poor' : a.anchorScore > 0 ? 'neutral' : 'good',
        })),
      };
    case 'bestGross':
      return {
        title,
        subtitle: t(single ? 'stats.game.sheet.grossSubSingle' : d.nine ? 'stats.game.sheet.grossSubNine' : 'stats.game.sheet.grossSub'),
        explainer: t(single ? 'stats.game.sheet.grossExplainerSingle' : 'stats.game.sheet.grossExplainer'),
        rows: d.rows.map((r) => ({
          key: `${r.player.id}-${r.roundIndex}`,
          primary: single ? r.player.name : `${firstName(r.player)} · ${roundTag(r.roundIndex)} · ${r.courseName}`,
          secondary: t('stats.screen.parStrokes', { par: r.par, strokes: r.strokes }),
          rightPrimary: t('stats.game.award.gross', { strokes: num(r.strokes), vs: r.vs === 0 ? 'E' : signed(r.vs) }),
          tone: r.strokes === d.rows[0].strokes ? 'excellent' : undefined,
        })),
      };
    case 'comeback':
      return {
        title,
        subtitle: t('stats.game.sheet.comebackSub'),
        explainer: t('stats.game.sheet.comebackExplainer'),
        rows: d.map((c) => ({
          key: `${c.players[0].id}-${c.roundIndex}`,
          primary: single ? joinNames(c.players) : `${joinNames(c.players)} · ${roundTag(c.roundIndex)} · ${c.courseName}`,
          secondary: t('stats.game.sheet.comebackRow', { count: c.deficit, hole: c.afterHole }),
          rightPrimary: signed(-c.deficit),
          tone: c.deficit === d[0].deficit ? 'excellent' : 'neutral',
        })),
      };
    case 'improved':
      return {
        title,
        subtitle: t('stats.game.sheet.improvedSub'),
        explainer: t('stats.game.sheet.improvedExplainer'),
        rows: d.map((r) => ({
          key: r.player.id,
          primary: r.player.name,
          secondary: t('stats.game.award.improvedDetail', {
            from: r.from.roundIndex + 1, a: r.from.points, to: r.to.roundIndex + 1, b: r.to.points,
          }),
          rightPrimary: signed(r.gain),
          tone: r.gain >= 3 ? 'excellent' : r.gain < 0 ? 'poor' : 'neutral',
        })),
      };
    case 'easiestHole':
    case 'hardestHole':
      return {
        title: t(`stats.game.award.title.${award.id}`),
        subtitle: t(award.id === 'easiestHole' ? 'stats.game.sheet.easiestSub' : 'stats.game.sheet.hardestSub'),
        explainer: t('stats.game.sheet.holesExplainer'),
        rows: d.map((h) => ({
          key: h.key,
          primary: `${h.courseName} · ${t('stats.screen.hole', { n: h.holeNumber })}`,
          secondary: t('stats.game.sheet.holeRow', { par: h.par, count: h.scores }),
          rightPrimary: t('stats.screen.pts', { n: num(h.avgPoints, { decimals: 2 }) }),
          tone: h.avgPoints >= 2 ? 'good' : h.avgPoints >= 1.5 ? 'neutral' : 'poor',
        })),
      };
    default:
      return { title, rows: [] };
  }
}

// ── Hole sheet (a hole of one round, everyone's score) ──
export function holeSheet(h, label, explainer, { single = false } = {}) {
  return {
    title: single
      ? t('stats.screen.hole', { n: h.holeNumber })
      : `${roundTag(h.roundIndex)} · ${t('stats.screen.holeCourse', { n: h.holeNumber, course: h.courseName })}`,
    subtitle: `${label} · ${t('stats.screen.parSi', { par: h.par, si: h.si })}`,
    explainer,
    rows: (h.playerScores ?? h.scores ?? []).map((ps) => ({
      key: ps.playerId,
      primary: ps.playerName,
      secondary: t('stats.screen.strokesN', { n: ps.strokes }),
      rightPrimary: pts(ps.points),
      tone: toneForPoints(ps.points),
    })),
  };
}

// ── One player's round, hole by hole ──
export function roundSheet(tournament, player, r) {
  const round = tournament.rounds[r.roundIndex];
  const handicap = getPlayingHandicap(round, player);
  const rows = round.holes.map((h) => {
    const sc = round.scores?.[player.id]?.[h.number];
    if (!sc) return null;
    const p = calcStablefordPoints(h.par, sc, handicap, h.strokeIndex, holeCountOf(round));
    return {
      key: `${h.number}`,
      primary: t('stats.screen.hole', { n: h.number }),
      secondary: t('stats.screen.parStrokes', { par: h.par, strokes: sc }),
      rightPrimary: pts(p),
      tone: toneForPoints(p),
    };
  }).filter(Boolean);
  return {
    title: `${roundTag(r.roundIndex)} · ${r.courseName}`,
    subtitle: t('stats.screen.round.subtitle', { name: player.name, points: num(r.points), strokes: r.strokes }),
    explainer: t('stats.screen.round.explainer'),
    rows,
  };
}

// ── Head-to-head duel ──
export function duelSheet(p1, p2, result, { single = false } = {}) {
  const b = result.points;
  return {
    title: t('stats.screen.h2h.titlePoints', { a: firstName(p1), b: firstName(p2) }),
    subtitle: t('stats.screen.h2h.subtitle', { a: firstName(p1), aw: b.p1Wins, b: firstName(p2), bw: b.p2Wins, ties: b.ties }),
    explainer: `${t('stats.screen.h2h.explainerPoints')} ${t('stats.screen.h2h.totals', {
      a: firstName(p1), av: pts(result.totals.p1Points), b: firstName(p2), bv: pts(result.totals.p2Points),
    })}`,
    rows: result.holes.map((h, i) => {
      const winner = h.p1Points > h.p2Points ? firstName(p1) : h.p2Points > h.p1Points ? firstName(p2) : t('stats.screen.tie');
      return {
        key: `${h.roundIndex}-${h.holeNumber}-${i}`,
        primary: roundHole(h, single),
        secondary: `${firstName(p1)} ${h.p1Points} · ${firstName(p2)} ${h.p2Points}`,
        rightPrimary: winner,
        tone: h.p1Points === h.p2Points ? 'neutral' : 'good',
      };
    }),
  };
}

export function pairCardSheet(card, { single = false } = {}) {
  return {
    title: t('stats.screen.join.two', { a: card.players[0].name, b: card.players[1].name }),
    subtitle: single
      ? t('stats.game.rivals.pairCombined', { n: num(card.avgPoints) })
      : t('stats.screen.pairs.cardSubtitle', { avg: num(card.avgPoints), count: card.rounds }),
    explainer: t('stats.screen.pairs.cardExplainer'),
    rows: [
      ...card.roundList.map((r) => ({
        key: `r${r.roundIndex}`,
        primary: single ? r.courseName : `${roundTag(r.roundIndex)} · ${r.courseName}`,
        secondary: r.memberPoints.map((m) => `${firstName({ name: m.playerName })} ${m.points}`).join(' · '),
        rightPrimary: pts(r.combinedPoints),
      })),
      ...(card.carry ? [
        section('carry', t('stats.screen.pairs.carrySplit')),
        ...card.carry.shares.map((sh) => ({
          key: `carry-${sh.player.id}`,
          primary: sh.player.name,
          secondary: pts(sh.points),
          rightPrimary: `${Math.round(sh.share * 100)}%`,
        })),
      ] : []),
    ],
  };
}

export function splitsSheet(player, row, baseline) {
  return {
    title: t('stats.screen.splits.sheetTitle', { a: player.name, b: row.partner.name }),
    subtitle: t('stats.screen.splits.sheetSubtitle', { avg: num(row.avgPlayerPoints), count: row.rounds, base: num(baseline) }),
    explainer: t('stats.screen.splits.sheetExplainer', {
      a: player.name, b: row.partner.name, base: num(baseline), fa: firstName(player), fb: firstName(row.partner),
    }),
    rows: row.perRoundPoints.map((p, i) => ({
      key: `${row.partner.id}-${i}`,
      primary: roundTag(row.roundIndices[i]),
      rightPrimary: pts(p),
    })),
  };
}

export function bounceSheet(row, { single = false } = {}) {
  return {
    title: t('stats.screen.bounce.title', { name: row.player.name }),
    subtitle: t('stats.screen.bounce.subtitle', { done: row.bounceBacks, total: row.opportunities, rate: num(row.rate) }),
    explainer: t('stats.screen.bounce.explainer'),
    rows: row.breakdown.map((b, i) => ({
      key: `bb-${b.roundIndex}-${b.holeNumber}-${i}`,
      primary: roundHole(b, single),
      secondary: t('stats.screen.bounce.row', { hole: b.afterHole, over: num(b.afterVsPar), par: b.par, strokes: b.strokes }),
      rightPrimary: b.recovered ? t('stats.screen.bounce.yes') : t('stats.screen.bounce.no'),
      tone: b.recovered ? 'excellent' : 'poor',
    })),
  };
}

export function nemesisSheet(player, entry, kind, { single = false } = {}) {
  const nemesis = kind === 'nemesis';
  return {
    title: t(nemesis ? 'stats.screen.nemesis.title' : 'stats.screen.crushed.title', { name: player.name }),
    subtitle: roundHole(entry, single),
    explainer: t(nemesis ? 'stats.screen.nemesis.explainer' : 'stats.screen.crushed.explainer'),
    rows: [{
      key: kind,
      primary: t('stats.screen.parSi', { par: entry.par, si: entry.si }),
      secondary: t('stats.screen.strokesVsPar', { strokes: entry.strokes, vs: signed(entry.vsPar) }),
      rightPrimary: pts(entry.points),
      tone: nemesis ? 'poor' : 'excellent',
    }],
  };
}
