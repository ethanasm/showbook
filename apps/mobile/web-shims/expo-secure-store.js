// localStorage-backed SecureStore for the web target.
//
// Lets Playwright tests pre-seed an auth session via page.addInitScript
// before the app boots:
//
//   await page.addInitScript(({ token, user }) => {
//     window.localStorage.setItem('secureStore::showbook.auth.token', token);
//     window.localStorage.setItem('secureStore::showbook.auth.user', user);
//   }, { token, user: JSON.stringify(user) });
//
// Keys are namespaced to avoid colliding with anything react-native-web
// itself might stash. Real expo-secure-store is keychain-backed on
// native — this shim is deliberately weak because it only ships to the
// web verification target.

const NAMESPACE = 'secureStore::';

function safeGet(key) {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(NAMESPACE + key)
      : null;
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(NAMESPACE + key, value);
    }
  } catch {
    /* localStorage disabled in the test browser — fall through */
  }
}

function safeDelete(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(NAMESPACE + key);
    }
  } catch {
    /* see safeSet */
  }
}

async function getItemAsync(key) {
  return safeGet(key);
}

async function setItemAsync(key, value, _options) {
  safeSet(key, value);
}

async function deleteItemAsync(key, _options) {
  safeDelete(key);
}

async function isAvailableAsync() {
  return typeof window !== 'undefined' && !!window.localStorage;
}

const WHEN_UNLOCKED = 'WHEN_UNLOCKED';
const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY';
const ALWAYS = 'ALWAYS';
const ALWAYS_THIS_DEVICE_ONLY = 'ALWAYS_THIS_DEVICE_ONLY';

module.exports = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  isAvailableAsync,
  WHEN_UNLOCKED,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  AFTER_FIRST_UNLOCK,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  ALWAYS,
  ALWAYS_THIS_DEVICE_ONLY,
};
