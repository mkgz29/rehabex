const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export const hasCloudinaryConfig = Boolean(cloudName && uploadPreset);

export async function uploadImageToCloudinary(file: File) {
  if (!hasCloudinaryConfig) {
    throw new Error('Faltan las variables de Cloudinary para subir imagenes.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('No se pudo subir la imagen. Revisa la configuracion de Cloudinary.');
  }

  const payload = await response.json();
  return payload.secure_url as string;
}
