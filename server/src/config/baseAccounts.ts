// Correos base del sistema (nuestros, de Domarkt): siempre presentes como administradores
// y NO se pueden eliminar ni desactivar desde la interfaz de Equipo. Sirven para
// administrar y hacer cambios pase lo que pase con el resto de usuarios.
export const BASE_ADMIN_EMAILS = ['dominicanmarketingrd@gmail.com', 'infodomarkt@gmail.com'];

export const isBaseAdmin = (email?: string | null) =>
  !!email && BASE_ADMIN_EMAILS.includes(email.toLowerCase());
