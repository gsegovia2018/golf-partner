// Side bets and settle-up. Pure: every amount is integer euro cents computed
// from the scores already on the device, and every bet is zero-sum, so the
// balances always add up to 0 and settleUp can pair them off.
//
// tournament.settings.stakes = { pot, perPoint, skin } in cents; 0 / absent = off.
//   pot      each player puts in `pot`; the top of the game's own board takes it
//            (ties split, team modes share it through equal team points).
//   perPoint each pair of players settles the gap on the overall board.
//   skin     best net score on a hole (Stableford points) wins one skin from
//            each other player who scored it; tied holes carry to the next one,
//            and a carry still open after the last hole is void. Not in scramble.
import { tournamentLeaderboardResolved } from './tournamentStore';
import { skinsLeaderboard } from './statsEngine';
import { isScrambleMode, roundScoringMode } from './scoring';
import { formatNumber } from '../i18n/format';
import { getLanguage } from '../i18n';

const BETS = ['pot', 'perPoint', 'skin'];

const cents = (v) => (Number.isInteger(v) && v > 0 ? v : 0);

export function normalizeStakes(stakes) {
  return Object.fromEntries(BETS.map((k) => [k, cents(stakes?.[k])]));
}

export function hasStakes(stakes) {
  const s = normalizeStakes(stakes);
  return BETS.some((k) => s[k] > 0);
}

// "0.50" / "0,5" / "10" -> 50 / 50 / 1000 cents; '' -> 0 (bet off); bad input -> null.
export function parseEuros(text) {
  const raw = String(text ?? '').trim().replace(',', '.');
  if (raw === '') return 0;
  if (!/^\d+(\.\d{0,2})?$/.test(raw)) return null;
  return Math.round(Number(raw) * 100);
}

// Hermes ships partial Intl, so format by hand: "€27.50" / "27,50 €".
export function formatEuros(amount, { sign = false } = {}, lang = getLanguage()) {
  const body = formatNumber(Math.abs(amount) / 100, { decimals: 2 }, lang);
  const prefix = sign ? (amount > 0 ? '+' : amount < 0 ? '−' : '') : (amount < 0 ? '−' : '');
  return lang === 'es' ? `${prefix}${body} €` : `${prefix}€${body}`;
}

const zeroes = (players) => Object.fromEntries(players.map((p) => [p.id, 0]));

function boardPoints(tournament) {
  const pts = zeroes(tournament.players ?? []);
  for (const e of tournamentLeaderboardResolved(tournament).entries ?? []) {
    if (e?.player?.id in pts) pts[e.player.id] = e.points ?? 0;
  }
  return pts;
}

export function potBalances(tournament, stake) {
  const players = tournament.players ?? [];
  const bal = zeroes(players);
  if (!stake || players.length < 2) return bal;
  const pts = boardPoints(tournament);
  const top = Math.max(...players.map((p) => pts[p.id]));
  const winners = players.filter((p) => pts[p.id] === top);
  // Nobody ahead (no scores yet, or everyone level): nothing changes hands.
  if (winners.length === players.length) return bal;
  const total = stake * players.length;
  const share = Math.floor(total / winners.length);
  let rest = total - share * winners.length;
  players.forEach((p) => { bal[p.id] = -stake; });
  winners.forEach((p) => { bal[p.id] += share + (rest-- > 0 ? 1 : 0); });
  return bal;
}

export function perPointBalances(tournament, stake) {
  const players = tournament.players ?? [];
  const bal = zeroes(players);
  if (!stake) return bal;
  const pts = boardPoints(tournament);
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      // One rounded amount per pair, added to one side and taken from the
      // other, keeps the total at exactly 0 even with half points.
      const amt = Math.round((pts[players[i].id] - pts[players[j].id]) * stake);
      bal[players[i].id] += amt;
      bal[players[j].id] -= amt;
    }
  }
  return bal;
}

// { balances, carry }: carry = skins riding on the next hole of the latest round.
export function skinsBalances(tournament, stake) {
  const bal = zeroes(tournament.players ?? []);
  if (!stake) return { balances: bal, carry: 0 };
  let carry = 0;
  for (const round of skinsLeaderboard(tournament, { metric: 'points' }).rounds) {
    carry = 0;
    if (isScrambleMode(roundScoringMode(tournament, tournament.rounds[round.roundIndex]))) continue;
    for (const hole of round.holes) {
      if (!hole.winner) { carry++; continue; }
      const units = 1 + carry;
      carry = 0;
      for (const { playerId } of hole.players) {
        if (playerId === hole.winner.id) continue;
        bal[playerId] -= units * stake;
        bal[hole.winner.id] += units * stake;
      }
    }
  }
  return { balances: bal, carry };
}

// Fewest-ish transfers: the biggest debtor pays the biggest creditor until
// everyone is square. At most n-1 transfers.
export function settleUp(balances) {
  const side = (sign) => Object.entries(balances)
    .filter(([, v]) => v * sign > 0)
    .map(([id, v]) => ({ id, left: Math.abs(v) }));
  const owe = side(-1);
  const get = side(1);
  const out = [];
  const byLeft = (a, b) => b.left - a.left;
  while (owe.length && get.length) {
    owe.sort(byLeft);
    get.sort(byLeft);
    const amount = Math.min(owe[0].left, get[0].left);
    out.push({ from: owe[0].id, to: get[0].id, amount });
    owe[0].left -= amount;
    get[0].left -= amount;
    if (owe[0].left === 0) owe.shift();
    if (get[0].left === 0) get.shift();
  }
  return out;
}

// Everything the settle-up card shows, or null when the game has no stakes.
// byPlayer[id] = { pot, perPoint, skin, net }.
export function stakeLedger(tournament) {
  const stakes = normalizeStakes(tournament?.settings?.stakes);
  if (!hasStakes(stakes)) return null;
  const pot = potBalances(tournament, stakes.pot);
  const perPoint = perPointBalances(tournament, stakes.perPoint);
  const skins = skinsBalances(tournament, stakes.skin);
  const byPlayer = {};
  const net = {};
  for (const p of tournament.players ?? []) {
    const row = { pot: pot[p.id], perPoint: perPoint[p.id], skin: skins.balances[p.id] };
    net[p.id] = row.pot + row.perPoint + row.skin;
    byPlayer[p.id] = { ...row, net: net[p.id] };
  }
  return { stakes, byPlayer, transfers: settleUp(net), skinCarry: skins.carry };
}
