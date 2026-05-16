// No-op notifications for the web target.

const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

const AndroidImportance = {
  UNSPECIFIED: 0,
  NONE: 1,
  MIN: 2,
  LOW: 3,
  DEFAULT: 4,
  HIGH: 5,
  MAX: 6,
};

async function requestPermissionsAsync(_options) {
  return {
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
    ios: { status: 'authorized' },
  };
}

async function getPermissionsAsync() {
  return {
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
    ios: { status: 'authorized' },
  };
}

async function getExpoPushTokenAsync(_options) {
  return { type: 'expo', data: 'ExponentPushToken[web-shim]' };
}

async function scheduleNotificationAsync(_options) {
  return 'web-shim-id';
}

async function cancelAllScheduledNotificationsAsync() {
  /* no-op */
}

async function setNotificationChannelAsync(_id, _channel) {
  return null;
}

function setNotificationHandler(_handler) {
  /* no-op */
}

function addNotificationReceivedListener(_listener) {
  return { remove() {} };
}

function addNotificationResponseReceivedListener(_listener) {
  return { remove() {} };
}

module.exports = {
  PermissionStatus,
  AndroidImportance,
  requestPermissionsAsync,
  getPermissionsAsync,
  getExpoPushTokenAsync,
  scheduleNotificationAsync,
  cancelAllScheduledNotificationsAsync,
  setNotificationChannelAsync,
  setNotificationHandler,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
};
