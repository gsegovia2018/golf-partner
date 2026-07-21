import { tournamentLeaderboardResolved } from './tournamentStore';
import { roundTotals, roundScoringMode, isScrambleMode } from './scoring';
import { assignPlacements, comparatorForBoardMode } from './leaderboardPlacement';

// Pure presentation models for the History tab. Everything the screen
// renders per row is computed here so it stays unit-testable without UI.

const MAX_AVATARS = 4;

export function playerInitials(name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 2).toUpperCase();
}

// Same resolution order as profileStore's me-matching: stamped user_id
// first, then a case-insensitive name match for legacy data.
export function findPlayerForIdentity(players, { userId, displayName } = {}) {
  const list = players ?? [];
  if (userId) {
    const byId = list.find((p) => p.user_id === userId);
    if (byId) return byId;
  }
  if (displayName) {
    const target = displayName.trim().toLowerCase();
    return list.find((p) => p.name.trim().toLowerCase() === target) ?? null;
  }
  return null;
}

export function placeLabel(place) {
  const mod100 = place % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  const mod10 = place % 10;
  if (mod10 === 1) return `${place}st`;
  if (mod10 === 2) return `${place}nd`;
  if (mod10 === 3) return `${place}rd`;
  return `${place}th`;
}

// finishedAt > createdAt > the numeric id (ids are Date.now() strings).
function entryTimestamp(t) {
  const parsed = Date.parse(t.finishedAt ?? t.createdAt ?? '');
  if (!Number.isNaN(parsed)) return parsed;
  const numericId = Number(t.id);
  return Number.isNaN(numericId) ? 0 : numericId;
}

function gameDateBox(when) {
  const d = new Date(when);
  return {
    top: String(d.getDate()),
    bottom: d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
  };
}

function tournamentSubtitle(tournament) {
  const names = [...new Set(
    (tournament.rounds ?? []).map((r) => r.courseName).filter(Boolean),
  )];
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.length} courses`;
}

function gameResult(tournament, me) {
  const round = tournament.rounds?.[0];
  if (!round) return { kind: 'none' };
  if (isScrambleMode(roundScoringMode(tournament, round))) return { kind: 'team' };
  if (!me) return { kind: 'none' };
  const mine = roundTotals(round, tournament.players ?? [])
    .find((e) => e.player.id === me.id);
  if (!mine || mine.totalStrokes === 0) return { kind: 'none' };
  return { kind: 'points', points: mine.totalPoints };
}

function tournamentStanding(tournament, me) {
  const board = tournamentLeaderboardResolved(tournament);
  const entries = board?.entries ?? [];
  if (entries.length === 0) return { champion: null, myPlacement: null, unit: board?.unit };
  const placed = assignPlacements(entries, comparatorForBoardMode(board.mode));
  const top = placed[0];
  const champion = (top?.points ?? 0) > 0 && top?.player?.name
    ? {
      name: top.player.name,
      isMe: !!me && top.player.id === me.id,
      points: top.points,
      unit: board.unit,
    }
    : null;
  const myRow = me ? placed.find((r) => r.player?.id === me.id) : null;
  const myPlacement = myRow
    ? {
      place: myRow.place,
      label: placeLabel(myRow.place),
      points: myRow.points,
      fieldSize: entries.length,
      won: myRow.place === 1 && (myRow.points ?? 0) > 0,
      podium: myRow.place <= 3,
    }
    : null;
  return { champion, myPlacement, unit: board.unit };
}

export function historyEntryModel(tournament, identity = {}) {
  const isGame = tournament.kind === 'game';
  const me = findPlayerForIdentity(tournament.players, identity);
  const when = entryTimestamp(tournament);
  const players = tournament.players ?? [];
  const rounds = tournament.rounds ?? [];

  const base = {
    id: tournament.id,
    kind: isGame ? 'game' : 'tournament',
    title: tournament.name,
    when,
    avatars: players.slice(0, MAX_AVATARS).map((p) => ({
      initials: playerInitials(p.name),
      isMe: !!me && p.id === me.id,
      avatarUrl: p.avatar_url ?? null,
    })),
    extraPlayers: Math.max(0, players.length - MAX_AVATARS),
    isOwner: tournament._role === 'owner',
  };

  if (isGame) {
    return {
      ...base,
      dateBox: gameDateBox(when),
      subtitle: rounds[0]?.courseName ?? 'Single round',
      result: gameResult(tournament, me),
      champion: null,
      myPlacement: null,
    };
  }

  const { champion, myPlacement, unit } = tournamentStanding(tournament, me);
  let result = { kind: 'none' };
  if (myPlacement) {
    result = myPlacement.won
      ? { kind: 'won', points: myPlacement.points, unit }
      : {
        kind: 'placement',
        place: myPlacement.place,
        label: myPlacement.label,
        points: myPlacement.points,
        unit,
      };
  }
  return {
    ...base,
    dateBox: {
      top: String(rounds.length),
      bottom: rounds.length === 1 ? 'ROUND' : 'ROUNDS',
    },
    subtitle: tournamentSubtitle(tournament),
    result,
    champion,
    myPlacement,
  };
}

export function buildHistorySections(tournaments, identity = {}) {
  const models = (tournaments ?? [])
    .map((t) => historyEntryModel(t, identity))
    .sort((a, b) => b.when - a.when);
  const sections = [];
  let current = null;
  for (const model of models) {
    const d = new Date(model.when);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!current || current.key !== key) {
      current = {
        key,
        label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
        items: [],
      };
      sections.push(current);
    }
    current.items.push(model);
  }
  return sections;
}
