import {
  captureException, captureMessage, installReporter, getRecentEvents,
  _resetErrorReportingForTests, MAX_REPORT_EVENTS,
} from '../errorReporting';

describe('errorReporting', () => {
  beforeEach(() => {
    _resetErrorReportingForTests();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  test('captureException records level, message, code and context, and returns the event', () => {
    const err = Object.assign(new Error('boom'), { code: 'X1' });
    const event = captureException(err, { where: 'drain' });

    expect(event).toMatchObject({ level: 'error', message: 'boom', code: 'X1', context: { where: 'drain' } });
    expect(typeof event.at).toBe('number');
    expect(getRecentEvents()).toHaveLength(1);
  });

  test('captureMessage records a warn-level event with no code', () => {
    captureMessage('reconcile skipped', { tournamentId: 't1' });
    const [event] = getRecentEvents();
    expect(event).toMatchObject({ level: 'warn', message: 'reconcile skipped', context: { tournamentId: 't1' } });
  });

  test('a nullish/string error is captured without throwing', () => {
    expect(() => captureException(null)).not.toThrow();
    expect(() => captureException('plain string')).not.toThrow();
    const events = getRecentEvents();
    expect(events[1].message).toBe('plain string');
  });

  test('the in-memory ring buffer is capped at MAX_REPORT_EVENTS (oldest dropped)', () => {
    for (let i = 0; i < MAX_REPORT_EVENTS + 10; i++) captureMessage(`e${i}`);
    const events = getRecentEvents();
    expect(events).toHaveLength(MAX_REPORT_EVENTS);
    // Oldest (e0..e9) evicted; newest retained.
    expect(events[0].message).toBe('e10');
    expect(events[events.length - 1].message).toBe(`e${MAX_REPORT_EVENTS + 9}`);
  });

  test('installReporter forwards each event to the sink with the original error', () => {
    const sink = jest.fn();
    installReporter(sink);
    const err = new Error('boom');
    captureException(err, { a: 1 });

    expect(sink).toHaveBeenCalledTimes(1);
    const [event, original] = sink.mock.calls[0];
    expect(event).toMatchObject({ level: 'error', message: 'boom' });
    expect(original).toBe(err);
  });

  test('a throwing sink never propagates (reporting must not mask the original failure)', () => {
    installReporter(() => { throw new Error('sink exploded'); });
    expect(() => captureException(new Error('boom'))).not.toThrow();
    // The event is still buffered even though the sink threw.
    expect(getRecentEvents()).toHaveLength(1);
  });

  test('getRecentEvents returns a copy — mutating it does not corrupt the buffer', () => {
    captureMessage('one');
    const snapshot = getRecentEvents();
    snapshot.push({ bogus: true });
    expect(getRecentEvents()).toHaveLength(1);
  });
});
