module.exports = {
  lockAsync: jest.fn(),
  unlockAsync: jest.fn(),
  addOrientationChangeListener: jest.fn(() => ({ remove: jest.fn() })),
  removeOrientationChangeListener: jest.fn(),
  OrientationLock: {
    PORTRAIT: 'PORTRAIT',
    LANDSCAPE: 'LANDSCAPE',
    ALL: 'ALL',
  },
};
