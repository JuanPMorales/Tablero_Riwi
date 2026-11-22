const get = id => document.getElementById(id);
const form = get('account-form');
const submit = get('submit-account');
const toggle = get('toggle-account');
const status = get('login-status');
const password = get('password');
const confirmation = get('confirmation');
const documentField = get('document');
const visibility = get('show-password');
let register = false;

function setStatus(message, heading) {
  status.replaceChildren();
  status.hidden = !message;
  status.toggleAttribute('data-error', Boolean(heading));
  if (heading) {
    const title = document.createElement('strong');
    title.textContent = heading;
    status.append(title);
  }
  status.append(message);
}

function setPasswordVisible(visible) {
  password.type = visible ? 'text' : 'password';
  visibility.textContent = visible ? 'Ocultar' : 'Mostrar';
  visibility.setAttribute('aria-pressed', String(visible));
}

function confirmPassword(showError = false) {
  const mismatch = register && password.value !== confirmation.value;
  confirmation.setCustomValidity(mismatch ? 'Las contraseñas no coinciden.' : '');
  get('confirmation-error').hidden = !mismatch || !showError;
  confirmation.toggleAttribute('aria-invalid', mismatch && showError);
}

documentField.addEventListener('invalid', () => {
  get('document-hint').hidden = documentField.validity.valueMissing;
  documentField.toggleAttribute('aria-invalid', !documentField.validity.valueMissing);
});
documentField.addEventListener('input', () => {
  if (!documentField.validity.valid) return;
  get('document-hint').hidden = true;
  documentField.removeAttribute('aria-invalid');
});
password.addEventListener('input', () => confirmPassword(Boolean(confirmation.value)));
confirmation.addEventListener('input', () => confirmPassword(Boolean(confirmation.value)));
confirmation.addEventListener('invalid', () => confirmPassword(true));
visibility.onclick = () => setPasswordVisible(password.type === 'password');
toggle.onclick = () => {
  register = !register;
  document.body.classList.toggle('auth-register', register);
  setStatus('');
  const heading = get('auth-heading');
  heading.replaceChildren(register ? 'Tu siguiente capítulo' : 'Pequeños pasos.', document.createElement('br'), register ? 'empieza aquí.' : 'Grandes ideas.');
  get('login-heading').children[0].textContent = register ? 'Crea tu cuenta' : 'Qué bueno verte de nuevo';
  get('login-heading').children[1].textContent = register ? 'Tu futuro empieza hoy.' : 'Hola de nuevo.';
  get('login-caption').children[0].textContent = register ? 'Empieza tu camino en tecnología.' : 'Continúa donde dejaste tu aprendizaje.';
  get('login-caption').children[1].textContent = register ? 'Crea tu cuenta y da el primer paso.' : 'Retoma tu camino de aprendizaje.';
  submit.textContent = register ? 'Crear cuenta  →' : 'Iniciar sesión  →';
  get('toggle-account-label').textContent = register ? '¿Ya tienes una cuenta?' : '¿Primera vez por aquí?';
  toggle.textContent = register ? 'Iniciar sesión' : 'Crear cuenta';
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 12 : 1;
  password.value = confirmation.value = '';
  get('password-hint').hidden = get('confirmation-field').hidden = !register;
  confirmation.required = register;
  setPasswordVisible(false);
  confirmPassword();
};
form.onsubmit = async event => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  submit.disabled = toggle.disabled = true;
  form.setAttribute('aria-busy', 'true');
  const buttonLabel = submit.textContent;
  submit.textContent = register ? 'Creando tu cuenta…' : 'Ingresando…';
  setStatus(register ? 'Estamos preparando tu espacio de estudio.' : '');
  try {
    const result = await fetch('/api/auth/' + (register ? 'register' : 'login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const payload = await result.json();
    if (!result.ok) throw new Error(payload.error);
    location.replace('/');
  } catch (error) {
    setStatus(error.message, register ? 'No pudimos crear tu cuenta' : 'No pudimos iniciar sesión');
    submit.textContent = buttonLabel;
    submit.disabled = toggle.disabled = false;
    form.removeAttribute('aria-busy');
  }
};
