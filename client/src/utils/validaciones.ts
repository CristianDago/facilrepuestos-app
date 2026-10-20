// Valida email
export const validarEmail = (email: string): boolean => {
  if (!email) return true; // opcional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

// Valida teléfono chileno
// Acepta: 9XXXXXXXX, 56 9XXXXXXXX, +56 9XXXXXXXX, 9 XXXX XXXX
export const validarTelefonoChileno = (tel: string): boolean => {
  if (!tel) return true; // opcional
  const limpio = tel.replace(/[\s\-\+]/g, '');
  // Formatos válidos: 9XXXXXXXX (9 dígitos), 569XXXXXXXX (11 dígitos)
  return /^9\d{8}$/.test(limpio) || /^569\d{8}$/.test(limpio);
};

// Formatea teléfono a +56 9 XXXX XXXX
export const formatearTelefonoChileno = (tel: string): string => {
  const limpio = tel.replace(/[\s\-\+]/g, '');
  let numero = limpio;
  if (limpio.startsWith('569')) numero = limpio.slice(2); // quitar 56
  if (numero.startsWith('9') && numero.length === 9) {
    return `+56 ${numero[0]} ${numero.slice(1, 5)} ${numero.slice(5)}`;
  }
  return tel;
};

// Mensaje de error teléfono
export const errorTelefono = 'Ingresa un teléfono válido: 9 XXXX XXXX';

// Mensaje de error email
export const errorEmail = 'Ingresa un correo electrónico válido';

// Formatea RUT chileno con puntos y guión: 12.345.678-9
export const formatRut = (value: string): string => {
  const clean = value.replace(/[^0-9kK]/g, '');
  if (clean.length <= 1) return clean;
  const body = clean.slice(0, -1);
  const dv   = clean.slice(-1).toUpperCase();
  return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${dv}`;
};