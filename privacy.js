fetch('/api/privacy', { cache: 'no-store' }).then(response => response.json()).then(policy => {
  const node = document.getElementById('responsible');
  node.textContent = policy.responsible && policy.contact
    ? `Responsable: ${policy.responsible}. Contacto para tus derechos: ${policy.contact}.`
    : 'La identidad y el contacto público del responsable aún están pendientes de configuración. Consulta al administrador antes de entregar datos adicionales.';
}).catch(() => { document.getElementById('responsible').textContent = 'No se pudo consultar el contacto. Intenta más tarde.'; });
