const CLOUD_NAME   = 'dndahyjf0';
const UPLOAD_PRESET = 'drmotors';

const BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;

export interface CloudinaryResult {
  secure_url: string;
  public_id:  string;
}

// Subir imagen (foto de perfil, foto de vehículo)
export async function uploadImagen(file: File, folder = 'drmotors'): Promise<CloudinaryResult> {
  const formData = new FormData();
  formData.append('file',           file);
  formData.append('upload_preset',  UPLOAD_PRESET);
  formData.append('folder',         folder);

  const res = await fetch(`${BASE_URL}/image/upload`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) throw new Error('Error subiendo imagen a Cloudinary');
  return res.json();
}

// Subir archivo raw (PDF de liquidaciones)
export async function uploadPDF(file: File, folder = 'drmotors/liquidaciones'): Promise<CloudinaryResult> {
  const formData = new FormData();
  formData.append('file',          file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder',        folder);
  formData.append('resource_type', 'raw');

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body:   formData,
  });
  if (!res.ok) throw new Error('Error subiendo PDF a Cloudinary');
  return res.json();
}
