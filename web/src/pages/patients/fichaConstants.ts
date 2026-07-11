export const MOTIVOS = [
  'Envejecimiento', 'Arrugas', 'Manchas', 'Acné', 'Rosácea', 'Celulitis',
  'Adiposidad localizada', 'Flaccidez', 'Estrías', 'Blanqueamiento', 'Depilación', 'Otros',
];

export const ANTECEDENTES = [
  'Alergias', 'Diabetes', 'Respiratorios', 'Cardiacos', 'Digestivos', 'Estreñimiento',
  'Edemas', 'Caída de cabello', 'Porta marcapasos', 'Prótesis metálicas', 'Ant. oncológicos',
  'Herpes labiales', 'Fuma', 'Enf. renales', 'Anticonceptivo/DIU', 'Fobias', 'Alt. glandular',
  'Convulsiones', 'Cáncer', 'Várices', 'Hipertensión', 'Hipoglucemia', 'Síncope',
];

export const MEDICAMENTOS = [
  'ASA', 'Acenocumarol', 'Antibióticos aminoglucósidos', 'Vitamina E',
  'Colágeno', 'Sup. crec. pelo/piel/uñas', 'Vitamina A', 'Ginkgo Biloba',
];

export const FOTOTIPOS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

// Escala de Fitzpatrick — ayuda para que el paciente identifique su tipo de piel.
export const FOTOTIPO_DESC: Record<string, string> = {
  I: 'Piel muy clara. Siempre se quema, nunca se broncea. Cabello rubio/pelirrojo, ojos claros.',
  II: 'Piel clara. Se quema con facilidad, se broncea muy poco.',
  III: 'Piel media/trigueña clara. Se quema moderado, se broncea de a poco.',
  IV: 'Piel morena clara (latina/mediterránea). Se quema poco, se broncea fácil.',
  V: 'Piel morena oscura. Rara vez se quema, muy pigmentada.',
  VI: 'Piel negra. Nunca se quema, tono muy oscuro.',
};
