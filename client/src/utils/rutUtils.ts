/**
 * Convierte un RUT chileno al formato de email interno usado por Firebase Auth.
 * Ej: "12.345.678-9" → "123456789@drmotors.internal"
 */
export const rutToEmail = (rut: string): string => {
  const clean = rut.replace(/\./g, '').replace(/-/g, '').toLowerCase();
  return `${clean}@drmotors.internal`;
};
