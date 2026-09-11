// expo-task-manager binds to a native module at import time
// (requireNativeModule('ExpoTaskManager')), which Jest has no answer for.
// lib/roundTracking defines its task at module scope, so anything that pulls
// the hook tree in would throw without this. Tests that care about the task
// executor read it back from defineTask.mock.calls.
module.exports = {
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
  unregisterTaskAsync: jest.fn().mockResolvedValue(),
  unregisterAllTasksAsync: jest.fn().mockResolvedValue(),
};
