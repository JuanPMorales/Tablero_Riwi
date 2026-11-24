const form = document.getElementById('access-form');
const message = document.getElementById('access-status');
const submit = document.getElementById('access-submit');
const params = new URLSearchParams(location.hash.slice(1));
let token = params.get('token'), purpose = params.get('purpose');
history.replaceState(null, '', location.pathname);
if (token) {
  document.getElementById('recovery-fields').hidden = true;
  [...document.querySelectorAll('#recovery-fields input')].forEach(input => { input.disabled = true; });
  document.getElementById('access-title').textContent = purpose === 'verify' ? 'Verificar correo' : 'Nueva contraseña';
  document.getElementById('access-description').textContent = 'El enlace es de un solo uso y vence en 15 minutos. Confirma la operación.';
  document.getElementById('reset-fields').hidden = document.getElementById('reset-fields').disabled = purpose !== 'reset';
  submit.textContent = purpose === 'verify' ? 'Confirmar correo' : 'Guardar contraseña';
} else fetch('/api/privacy').then(response => response.json()).then(policy => {
  if (!policy.mailReady) { submit.disabled = true; message.textContent = 'El servicio de correo aún no está configurado. La recuperación no está disponible por el momento.'; }
}).catch(() => { submit.disabled = true; message.textContent = 'No se pudo consultar la disponibilidad.'; });
form.onsubmit = async event => {
  event.preventDefault(); if (submit.disabled) return; submit.disabled = true;
  try {
    const response = await fetch(token ? '/api/auth/consume' : '/api/auth/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), ...(token ? { token, purpose } : {}) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    message.textContent = token ? 'Operación completada. Puedes volver al ingreso.' : result.message;
    if (token) { token = null; purpose = null; form.hidden = true; }
    form.reset();
  } catch (error) { message.textContent = error.message; }
  finally { submit.disabled = false; }
};
