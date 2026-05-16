// No-op image picker for the web target.

const MediaTypeOptions = { All: 'All', Images: 'Images', Videos: 'Videos' };
const MediaType = { Images: 'images', Videos: 'videos' };
const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

async function launchImageLibraryAsync(_options) {
  return { canceled: true, assets: null };
}

async function launchCameraAsync(_options) {
  return { canceled: true, assets: null };
}

async function requestMediaLibraryPermissionsAsync() {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

async function requestCameraPermissionsAsync() {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

async function getMediaLibraryPermissionsAsync() {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

async function getCameraPermissionsAsync() {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

module.exports = {
  MediaTypeOptions,
  MediaType,
  PermissionStatus,
  launchImageLibraryAsync,
  launchCameraAsync,
  requestMediaLibraryPermissionsAsync,
  requestCameraPermissionsAsync,
  getMediaLibraryPermissionsAsync,
  getCameraPermissionsAsync,
};
