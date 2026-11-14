const query = new URLSearchParams(location.search);
history.replaceState(null, '', location.pathname);
if (window.opener) {
  window.opener.postMessage({ type: 'riwi-google', state: query.get('state'), code: query.get('code') }, location.origin);
  window.close();
}
