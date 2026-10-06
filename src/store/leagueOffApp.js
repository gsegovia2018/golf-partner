// Off-app league cards (plan L6/L7): the pure bits and the submit sequence
// behind LeagueAnnounce / LeagueAddScore / LeagueAddProof.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  submitLeagueCard, addUnannouncedLeagueCard, uploadLeagueProof, attachLeagueProof,
} from './leagueStore';
import { middleTee } from './tees';
import { scoreCard } from './leagueRules';
import { isRatedTee } from './handicapIndex';

export const HOLES_PER_CARD = 18;

// The jsonb the server keeps on the card: { name, tee, slope, rating, holes:[{n,par,si}] }.
export function courseSnapshot(course, tee) {
  return {
    name: course.name,
    tee: tee?.label ?? null,
    slope: tee?.slope ?? course.slope ?? null,
    rating: tee?.rating ?? course.rating ?? null,
    holes: [...(course.holes ?? [])]
      .sort((a, b) => a.number - b.number)
      .map((h) => ({ n: h.number, par: h.par, si: h.strokeIndex })),
  };
}

// Back to the shapes the scorecard and scoreCard() use.
export function courseFromSnapshot(snap) {
  const holes = (snap?.holes ?? []).map((h) => ({ number: h.n, par: h.par, strokeIndex: h.si }));
  const tee = snap?.slope || snap?.rating
    ? { label: snap.tee ?? null, slope: snap.slope ?? null, rating: snap.rating ?? null }
    : null;
  return { name: snap?.name ?? '', holes, tee };
}

export function defaultTee(course) {
  return middleTee(course?.tees);
}

export const UNRATED_TEE_PROBLEM = "This tee has no slope and course rating, so it can't count for the league. "
  + 'Pick a rated tee or add its slope and rating in the course library.';

// A league card is 18 holes off a rated tee; return an error line or null.
// `tee` defaults to `course.tee` (courseFromSnapshot's shape, where an
// unrated snapshot reads tee: null). A library course passed without a tee
// and without a `tee` key skips the rating check (callers pass the picked tee).
export function courseProblem(course, tee = course?.tee) {
  if (!course) return 'Pick the course you are playing.';
  if ((course.holes ?? []).length !== HOLES_PER_CARD) {
    return 'League cards need an 18-hole layout. Pick another course or layout.';
  }
  const checkTee = tee !== undefined || Object.prototype.hasOwnProperty.call(course, 'tee');
  if (checkTee && !isRatedTee(tee)) return UNRATED_TEE_PROBLEM;
  return null;
}

const isValidStroke = (v) => Number.isInteger(v) && v >= 1 && v <= 30;

// The server rule: every hole 1..18 is a whole number from 1 to 30.
export function scoresComplete(strokes) {
  for (let n = 1; n <= HOLES_PER_CARD; n += 1) {
    if (!isValidStroke(strokes?.[n])) return false;
  }
  return true;
}

// { 1: 5, ... } -> { '1': 5, ... } as the RPCs take it.
export function holesPayload(strokes) {
  const out = {};
  for (let n = 1; n <= HOLES_PER_CARD; n += 1) out[String(n)] = strokes[n];
  return out;
}

// Typed text from a scorecard cell into the strokes map (empty clears it).
export function applyStrokeText(strokes, holeNumber, text) {
  const next = { ...strokes };
  const t = String(text ?? '').trim();
  if (t === '') delete next[holeNumber];
  else if (/^\d+$/.test(t)) next[holeNumber] = Number(t);
  return next;
}

// Local date/time inputs -> an ISO instant (device time zone).
export function buildTeeTime(dateText, timeText) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText ?? '').trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(timeText ?? '').trim());
  if (!d || !t) return null;
  const [y, mo, day, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const date = new Date(y, mo - 1, day, h, mi);
  const ok = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === day
    && h < 24 && mi < 60;
  return ok ? date.toISOString() : null;
}

export function localDateText(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localTimeText(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Sat 4 Oct" from an ISO instant or a YYYY-MM-DD date.
export function dayLabel(value) {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).slice(0, 10));
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function timeLabel(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : localTimeText(d);
}

// The proof summary: "<course> · <date> · <points> pts · gross <g>" plus the
// numbers the RPCs need.
export function proofSummary({ snapshot, playedOn, strokes, leagueHandicap }) {
  const course = courseFromSnapshot(snapshot);
  const { gross, points, playingHandicap, netDifferential } = scoreCard({
    holes: strokes, course, leagueHandicap, tee: course.tee,
  });
  const line = [snapshot?.name, dayLabel(playedOn), `${points} pts`, `gross ${gross}`]
    .filter(Boolean).join(' · ');
  return { line, gross, points, playingHandicap, netDifferential };
}

// ---- draft (AsyncStorage, one per card) ------------------------------------

export const draftKey = (leagueId, cardId) => `league_card_draft:${leagueId}:${cardId ?? 'unannounced'}`;

export async function loadDraft(leagueId, cardId) {
  try {
    const raw = await AsyncStorage.getItem(draftKey(leagueId, cardId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveDraft(leagueId, cardId, draft) {
  try {
    await AsyncStorage.setItem(draftKey(leagueId, cardId), JSON.stringify(draft));
  } catch {
    // A draft is a convenience; never block typing on it.
  }
}

export async function clearDraft(leagueId, cardId) {
  try {
    await AsyncStorage.removeItem(draftKey(leagueId, cardId));
  } catch {
    // ignore
  }
}

// ---- submit sequence -------------------------------------------------------

// announced card:   submitLeagueCard -> uploadLeagueProof -> attachLeagueProof
// unannounced card: addUnannouncedLeagueCard -> uploadLeagueProof -> attachLeagueProof
// `progress` ({ cardId, submitted, path }) is kept by the caller and updated
// as each step lands, so a retry after a failed upload never re-creates the
// card: it resumes at the step that failed. Returns the card id.
export async function submitOffAppCard({
  leagueId, cardId = null, snapshot, playedOn = null, strokes, gross, points, playingHandicap,
  photoUri, kind = 'photo', markerName = null, progress = {},
}) {
  if (!progress.submitted) {
    const holes = holesPayload(strokes);
    if (cardId) {
      await submitLeagueCard({ cardId, holes, gross, points, playingHandicap, playedOn });
      progress.cardId = cardId;
    } else {
      const created = await addUnannouncedLeagueCard({
        leagueId, course: snapshot, teeTime: null, playedOn, holes, gross, points, playingHandicap,
      });
      progress.cardId = created.id;
    }
    progress.submitted = true;
  }
  if (!progress.path) {
    progress.path = await uploadLeagueProof(leagueId, progress.cardId, photoUri);
  }
  await attachLeagueProof(progress.cardId, progress.path, kind, kind === 'photo' ? markerName : null);
  return progress.cardId;
}
