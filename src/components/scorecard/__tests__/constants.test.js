import { DEFAULT_SHOT, STAT_GROUP_FIELDS } from '../constants';

// DEFAULT_SHOT keys that belong to no STAT_GROUP_FIELDS group on purpose.
// None today: every shot key is in a group, so a new key must land in one.
const UNGROUPED_ON_PURPOSE = [];

const MISS_REASON_KEYS = [
  'driveStart', 'driveContact', 'driveSituation',
  'approachStart', 'approachContact', 'approachSituation',
  'shortResult', 'shortContact', 'shortSituation',
];

describe('STAT_GROUP_FIELDS', () => {
  const groupOf = (key) => Object.keys(STAT_GROUP_FIELDS)
    .filter((group) => STAT_GROUP_FIELDS[group].includes(key));

  it('puts every DEFAULT_SHOT key in exactly one group, except the allow-list', () => {
    Object.keys(DEFAULT_SHOT).forEach((key) => {
      const groups = groupOf(key);
      const expected = UNGROUPED_ON_PURPOSE.includes(key) ? 0 : 1;
      expect({ key, count: groups.length }).toEqual({ key, count: expected });
    });
  });

  it('groups the drive miss-reason keys under teeShot', () => {
    expect(STAT_GROUP_FIELDS.teeShot).toEqual(expect.arrayContaining(['driveStart', 'driveContact', 'driveSituation']));
  });

  it('groups the approach miss-reason keys under approach', () => {
    expect(STAT_GROUP_FIELDS.approach).toEqual(expect.arrayContaining(['approachStart', 'approachContact', 'approachSituation']));
  });

  it('groups the short-game miss-reason keys under shortGame', () => {
    expect(STAT_GROUP_FIELDS.shortGame).toEqual(expect.arrayContaining(['shortResult', 'shortContact', 'shortSituation']));
  });
});

describe('DEFAULT_SHOT miss reasons', () => {
  it('defaults all nine miss-reason keys to null', () => {
    MISS_REASON_KEYS.forEach((key) => {
      expect({ key, value: DEFAULT_SHOT[key] }).toEqual({ key, value: null });
    });
  });
});
