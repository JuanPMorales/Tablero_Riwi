const get = id => document.getElementById(id);
const form = get('account-form');
const submit = get('submit-account');
const toggle = get('toggle-account');
const status = get('login-status');
const password = get('password');
let register = false;

toggle.onclick = () => {
  register = !register;
  status.textContent = '';
  get('login-heading').textContent = register ? 'Crear cuenta' : 'Iniciar sesión';
  submit.textContent = register ? 'Crear cuenta' : 'Entrar';
  toggle.textContent = register ? 'Ya tengo cuenta' : 'Crear una cuenta';
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 12 : 1;
  password.value = '';
  get('password-hint').hidden = !register;
};
form.onsubmit = async event => {
  event.preventDefault();
  submit.disabled = toggle.disabled = true;
  status.removeAttribute('data-error');
  status.textContent = register ? 'Creando cuenta…' : 'Ingresando…';
  try {
    const result = await fetch('/api/auth/' + (register ? 'register' : 'login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const payload = await result.json();
    if (!result.ok) throw new Error(payload.error);
    location.replace('/');
  } catch (error) {
    status.setAttribute('data-error', '');
    status.textContent = error.message;
    submit.disabled = toggle.disabled = false;
  }
};
