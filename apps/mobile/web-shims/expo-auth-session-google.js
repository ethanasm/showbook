// No-op Google auth session for the web target.
//
// The app calls Google.useIdTokenAuthRequest() during render and reads
// `response.params.id_token` from the second tuple element after the
// user taps "Sign in with Google". In the web verification target we
// rely on the EXPO_PUBLIC_E2E_MODE=1 bypass in lib/auth.ts, which
// short-circuits before promptAsync is ever called — so this shim only
// needs to construct without throwing.

function useIdTokenAuthRequest(_config) {
  const request = null;
  const response = null;
  const promptAsync = async (_options) => ({ type: 'dismiss' });
  return [request, response, promptAsync];
}

function useAuthRequest(_config) {
  return useIdTokenAuthRequest(_config);
}

module.exports = {
  useIdTokenAuthRequest,
  useAuthRequest,
};
