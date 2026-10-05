import {
  scoresComplete, applyStrokeText, holesPayload, buildTeeTime, courseSnapshot, courseFromSnapshot,
  courseProblem, proofSummary, submitOffAppCard, loadDraft, saveDraft, clearDraft,
} from '../leagueOffApp';

jest.mock('../leagueStore', () => ({
  submitLeagueCard: jest.fn(),
  addUnannouncedLeagueCard: jest.fn(),
  uploadLeagueProof: jest.fn(),
  attachLeagueProof: jest.fn(),
}));

const store = require('../leagueStore');

const full = (v = 5) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, v]));
const holes18 = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
const course = {
  name: 'Golf Olivar', slope: 120, rating: 71.5, holes: holes18, tees: [],
};

describe('scoresComplete (the add-score gate)', () => {
  test('needs all 18 holes with whole numbers from 1 to 30', () => {
    expect(scoresComplete(full())).toBe(true);
    expect(scoresComplete(full(30))).toBe(true);
    expect(scoresComplete(full(1))).toBe(true);
  });
  test('a missing hole, 0, 31 or a fraction keeps it closed', () => {
    const missing = full();
    delete missing[7];
    expect(scoresComplete(missing)).toBe(false);
    expect(scoresComplete({ ...full(), 3: 0 })).toBe(false);
    expect(scoresComplete({ ...full(), 3: 31 })).toBe(false);
    expect(scoresComplete({ ...full(), 3: 4.5 })).toBe(false);
    expect(scoresComplete({})).toBe(false);
  });
});

describe('helpers', () => {
  test('applyStrokeText sets, clears and ignores non-digits', () => {
    expect(applyStrokeText({}, 3, '5')).toEqual({ 3: 5 });
    expect(applyStrokeText({ 3: 5 }, 3, '')).toEqual({});
    expect(applyStrokeText({ 3: 5 }, 3, 'x')).toEqual({ 3: 5 });
  });

  test('holesPayload keys by string hole number', () => {
    expect(holesPayload(full(4))['18']).toBe(4);
    expect(Object.keys(holesPayload(full(4)))).toHaveLength(18);
  });

  test('buildTeeTime builds an instant from local date and time, or null', () => {
    expect(buildTeeTime('2025-10-04', '09:30')).toBe(new Date(2025, 9, 4, 9, 30).toISOString());
    expect(buildTeeTime('2025-13-04', '09:30')).toBeNull();
    expect(buildTeeTime('2025-10-04', '25:00')).toBeNull();
    expect(buildTeeTime('', '')).toBeNull();
  });

  test('courseSnapshot round-trips through courseFromSnapshot', () => {
    const snap = courseSnapshot(course, { label: 'Yellow', slope: 125, rating: 72 });
    expect(snap).toMatchObject({ name: 'Golf Olivar', tee: 'Yellow', slope: 125, rating: 72 });
    expect(snap.holes[0]).toEqual({ n: 1, par: 4, si: 1 });
    const back = courseFromSnapshot(snap);
    expect(back.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 1 });
    expect(back.tee).toEqual({ label: 'Yellow', slope: 125, rating: 72 });
  });

  test('courseProblem rejects a missing or non-18-hole course', () => {
    expect(courseProblem(null)).toMatch(/Pick the course/);
    expect(courseProblem({ holes: holes18.slice(0, 9) })).toMatch(/18-hole/);
    expect(courseProblem(course)).toBeNull();
  });

  test('courseProblem rejects an unrated tee (passed, or on a snapshot course)', () => {
    const unrated = /no slope and course rating, so it can't count for the league/;
    expect(courseProblem(course, { label: 'Red', slope: null, rating: null })).toMatch(unrated);
    expect(courseProblem(course, { label: 'Red', slope: 120 })).toMatch(unrated);
    expect(courseProblem(course, null)).toMatch(unrated);
    expect(courseProblem(course, { label: 'Yellow', slope: 125, rating: 72 })).toBeNull();
    // courseFromSnapshot shape: tee null when the snapshot has no slope/rating.
    const bare = { ...courseSnapshot(course, null), slope: null, rating: null };
    expect(courseProblem(courseFromSnapshot(bare))).toMatch(unrated);
    expect(courseProblem(courseFromSnapshot(courseSnapshot(course, { label: 'Y', slope: 125, rating: 72 }))))
      .toBeNull();
    // Hole-count problems still come first.
    expect(courseProblem({ holes: holes18.slice(0, 9) }, null)).toMatch(/18-hole/);
  });

  test('proofSummary reads "<course> · <date> · <points> pts · gross <g>"', () => {
    const snapshot = courseSnapshot(course, null);
    const { line, gross, points } = proofSummary({
      snapshot, playedOn: '2025-10-04', strokes: full(5), leagueHandicap: 18,
    });
    expect(gross).toBe(90);
    expect(line).toBe(`Golf Olivar · Sat 4 Oct · ${points} pts · gross 90`);
  });

  test('proofSummary also returns the net differential (course-level slope/rating here)', () => {
    // 18.0 x 120/113 + (71.5 - 72) = 19.1 - 0.5 = 18.6 -> 19; all bogeys, nothing capped.
    // (113/120) x (90 - 71.5) = 17.4; 17.4 - 18 = -0.6.
    const { netDifferential } = proofSummary({
      snapshot: courseSnapshot(course, null), playedOn: '2025-10-04', strokes: full(5), leagueHandicap: 18,
    });
    expect(netDifferential).toBe(-0.6);
  });
});

describe('drafts', () => {
  test('save, load and clear one draft per card', async () => {
    await saveDraft('L1', 'c1', { strokes: { 1: 5 } });
    expect(await loadDraft('L1', 'c1')).toEqual({ strokes: { 1: 5 } });
    expect(await loadDraft('L1', null)).toBeNull();
    await clearDraft('L1', 'c1');
    expect(await loadDraft('L1', 'c1')).toBeNull();
  });
});

describe('submitOffAppCard', () => {
  const base = {
    leagueId: 'L1',
    snapshot: courseSnapshot(course, null),
    playedOn: '2025-10-04',
    strokes: full(5),
    gross: 90,
    points: 30,
    playingHandicap: 18,
    photoUri: 'file:///p.jpg',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    store.submitLeagueCard.mockResolvedValue({ id: 'c1', status: 'submitted' });
    store.addUnannouncedLeagueCard.mockResolvedValue({ id: 'new1', status: 'submitted' });
    store.uploadLeagueProof.mockResolvedValue('L1/c1.jpg');
    store.attachLeagueProof.mockResolvedValue();
  });

  test('announced card: submit, upload, attach, in that order', async () => {
    const order = [];
    store.submitLeagueCard.mockImplementation(async () => { order.push('submit'); });
    store.uploadLeagueProof.mockImplementation(async () => { order.push('upload'); return 'L1/c1.jpg'; });
    store.attachLeagueProof.mockImplementation(async () => { order.push('attach'); });

    const id = await submitOffAppCard({ ...base, cardId: 'c1', markerName: 'Lucía' });

    expect(order).toEqual(['submit', 'upload', 'attach']);
    expect(id).toBe('c1');
    expect(store.submitLeagueCard).toHaveBeenCalledWith({
      cardId: 'c1', holes: holesPayload(full(5)), gross: 90, points: 30, playingHandicap: 18, playedOn: '2025-10-04',
    });
    expect(store.uploadLeagueProof).toHaveBeenCalledWith('L1', 'c1', 'file:///p.jpg');
    expect(store.attachLeagueProof).toHaveBeenCalledWith('c1', 'L1/c1.jpg', 'photo', 'Lucía');
    expect(store.addUnannouncedLeagueCard).not.toHaveBeenCalled();
  });

  test('unannounced card: add, upload with the new id, attach', async () => {
    store.uploadLeagueProof.mockResolvedValue('L1/new1.jpg');
    const id = await submitOffAppCard({ ...base, cardId: null });

    expect(id).toBe('new1');
    expect(store.addUnannouncedLeagueCard).toHaveBeenCalledWith({
      leagueId: 'L1',
      course: base.snapshot,
      teeTime: null,
      playedOn: '2025-10-04',
      holes: holesPayload(full(5)),
      gross: 90,
      points: 30,
      playingHandicap: 18,
    });
    expect(store.submitLeagueCard).not.toHaveBeenCalled();
    expect(store.uploadLeagueProof).toHaveBeenCalledWith('L1', 'new1', 'file:///p.jpg');
    expect(store.attachLeagueProof).toHaveBeenCalledWith('new1', 'L1/new1.jpg', 'photo', null);
  });

  test('an official result is attached with kind "official" and no marker name', async () => {
    await submitOffAppCard({
      ...base, cardId: 'c1', kind: 'official', markerName: 'Lucía',
    });
    expect(store.attachLeagueProof).toHaveBeenCalledWith('c1', 'L1/c1.jpg', 'official', null);
  });

  test('a failed upload is retried without creating the card twice', async () => {
    store.uploadLeagueProof.mockRejectedValueOnce(new Error('Upload failed'));
    store.uploadLeagueProof.mockResolvedValueOnce('L1/new1.jpg');
    const progress = {};

    await expect(submitOffAppCard({ ...base, cardId: null, progress })).rejects.toThrow('Upload failed');
    expect(progress).toMatchObject({ cardId: 'new1', submitted: true });

    await submitOffAppCard({ ...base, cardId: null, progress });
    expect(store.addUnannouncedLeagueCard).toHaveBeenCalledTimes(1);
    expect(store.uploadLeagueProof).toHaveBeenCalledTimes(2);
    expect(store.attachLeagueProof).toHaveBeenCalledWith('new1', 'L1/new1.jpg', 'photo', null);
  });

  test('a server refusal at submit stops the sequence', async () => {
    store.submitLeagueCard.mockRejectedValue(new Error('This is your October card, but the date is in November. Check the date.'));
    await expect(submitOffAppCard({ ...base, cardId: 'c1' })).rejects.toThrow(/Check the date/);
    expect(store.uploadLeagueProof).not.toHaveBeenCalled();
    expect(store.attachLeagueProof).not.toHaveBeenCalled();
  });
});
