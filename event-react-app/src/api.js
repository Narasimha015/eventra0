const base = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
function report(state,message=''){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('eventra-api-status',{detail:{state,message}}))}

export async function api(path, { method = 'GET', token, body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      credentials: 'include',
      signal,
    });
  } catch (error) {
    report('offline',error?.name === 'AbortError' ? 'Request cancelled' : 'Unable to reach the Eventra API.');
    throw new Error(error?.name === 'AbortError' ? 'Request cancelled' : 'Unable to reach the Eventra API.', { cause: error });
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: { message: text || 'Invalid server response' } }; }
  if (!response.ok) {
    if(response.status===401)report('unauthorized',data.error?.message||'Session expired. Sign in again.');
    else if(response.status>=500)report('error',data.error?.message||'The Eventra API returned a server error.');
    const error = new Error(data.error?.message || data.error || `Request failed (${response.status})`);
    error.status=response.status;error.code=data.error?.code||'REQUEST_FAILED';error.details=data.error?.details;
    throw error;
  }
  report('connected');
  return Object.hasOwn(data,'data') ? data.data : data;
}
