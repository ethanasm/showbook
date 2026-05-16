// No-op media library for the web target.

const PermissionStatus = {
  GRANTED: 'granted',
  DENIED: 'denied',
  UNDETERMINED: 'undetermined',
};

async function requestPermissionsAsync(_writeOnly) {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never', accessPrivileges: 'all' };
}

async function getPermissionsAsync(_writeOnly) {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never', accessPrivileges: 'all' };
}

async function getAssetsAsync(_options) {
  return { assets: [], endCursor: '', hasNextPage: false, totalCount: 0 };
}

async function createAssetAsync(_localUri) {
  return null;
}

async function saveToLibraryAsync(_localUri) {
  /* no-op */
}

module.exports = {
  PermissionStatus,
  requestPermissionsAsync,
  getPermissionsAsync,
  getAssetsAsync,
  createAssetAsync,
  saveToLibraryAsync,
};
