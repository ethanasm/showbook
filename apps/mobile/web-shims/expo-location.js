// No-op location for the web target.

const Accuracy = {
  Lowest: 1,
  Low: 2,
  Balanced: 3,
  High: 4,
  Highest: 5,
  BestForNavigation: 6,
};

const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

async function requestForegroundPermissionsAsync() {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

async function getForegroundPermissionsAsync() {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

async function getCurrentPositionAsync(_options) {
  return {
    coords: {
      latitude: 40.7128,
      longitude: -74.006,
      altitude: null,
      accuracy: 1,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  };
}

async function geocodeAsync(_address) {
  return [];
}

async function reverseGeocodeAsync(_location) {
  return [];
}

module.exports = {
  Accuracy,
  PermissionStatus,
  requestForegroundPermissionsAsync,
  getForegroundPermissionsAsync,
  getCurrentPositionAsync,
  geocodeAsync,
  reverseGeocodeAsync,
};
