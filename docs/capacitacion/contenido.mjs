// Contenido de la capacitación. Edita SOLO este archivo para cambiar textos:
// el diseño vive en generar.mjs y no hay que tocarlo.
//
// Estructura de un módulo:
//   num      → número de módulo (define el orden de la capacitación)
//   titulo   → nombre del módulo
//   bajada   → una línea que resume para qué sirve
//   roles    → ['Recepción', 'Esteticista', 'Administración']
//   duracion → tiempo estimado de la sesión de capacitación
//   proposito→ párrafo corto: qué resuelve este módulo en el día a día
//   pasos    → [{ t: 'Título del paso', d: 'Qué hace la persona' }]
//   ojo      → advertencias reales (errores que cuestan dinero o tiempo)
//   atajos   → tips y respuestas a dudas frecuentes

export const marca = {
  sistema: 'Li Estetic Connect',
  negocio: 'Li Estetic Center',
  lema: 'Transformando Tu Cuerpo',
  pie: 'Uso interno confidencial · Li Estetic Center',
};

export const modulos = [
  {
    num: 1,
    titulo: 'Entrar al sistema',
    bajada: 'Tu usuario, tu sucursal y qué ves según tu rol.',
    roles: ['Recepción', 'Esteticista', 'Administración'],
    duracion: '15 min',
    proposito:
      'Cada persona entra con su propio correo y contraseña. El sistema muestra únicamente lo que corresponde a tu rol y a tu sucursal: no verás pacientes ni cobros de otra estética. Esto protege los datos de las clientas y deja registro de quién hizo cada cosa.',
    pasos: [
      { t: 'Abre el sistema', d: 'Entra a sistema.liesteticcenter.com desde el navegador del celular o la computadora.' },
      { t: 'Elige tu rol', d: 'Toca Administradora, Recepcionista o Esteticista, según tu puesto.' },
      { t: 'Escribe tus credenciales', d: 'Tu correo y tu contraseña. Los campos salen vacíos siempre: nadie más puede entrar con tu usuario.' },
      { t: 'Selecciona tu sucursal', d: 'Si eres Recepción o Esteticista, elige la estética donde trabajas. La Administradora ve las tres.' },
      { t: 'Entra', d: 'Toca "Ingresar al sistema". Llegarás a tu panel: la agenda si eres Esteticista, la vista general si eres Administradora.' },
    ],
    ojo: [
      'Nunca compartas tu contraseña ni dejes la sesión abierta en un equipo de uso común.',
      'Si el sistema dice "Credenciales inválidas", revisa el correo antes de asumir que es la contraseña.',
      'Si olvidaste tu contraseña, la Administradora te asigna una nueva desde Equipo. Nadie puede recuperarla: se genera una nueva.',
    ],
    atajos: [
      'La campana (arriba a la derecha) muestra tus avisos: citas asignadas, mensajes y fichas listas.',
      'En el celular, el menú se abre con el botón de las tres líneas.',
    ],
  },

  {
    num: 2,
    titulo: 'Agenda y citas',
    bajada: 'Agendar, confirmar por WhatsApp y recordar.',
    roles: ['Recepción', 'Administración', 'Esteticista'],
    duracion: '30 min',
    proposito:
      'Toda cita queda registrada con su esteticista, su servicio y un código único de turno. El sistema controla la disponibilidad real: cada sucursal tiene varias esteticistas y solo se bloquea el horario cuando todas están ocupadas.',
    pasos: [
      { t: 'Toca "Agendar cita"', d: 'Arriba a la derecha en la Agenda.' },
      { t: 'Elige el tipo de clienta', d: 'Cliente nuevo (se crea la paciente ahí mismo) o Recurrente (la buscas por nombre o teléfono).' },
      { t: 'Selecciona el servicio', d: 'Sale del catálogo. Si el servicio no tiene precio fijo, se define al cobrar.' },
      { t: 'Indica el paquete, si aplica', d: 'Si la clienta tiene paquetes comprados, elige de cuál es esta sesión. Así se descuenta sola al cerrar el turno.' },
      { t: 'Fecha, hora y duración', d: 'Indica cuánto durará el proceso (puede pasar de una hora). La esteticista queda reservada todo ese tiempo.' },
      { t: 'Asigna la esteticista', d: 'Si ya tiene una cita que se solapa, el sistema te avisa y te deja elegir otra.' },
      { t: 'Confirma y envía el WhatsApp', d: 'Al guardar aparece el botón verde "Enviar confirmación por WhatsApp": se abre el chat con el mensaje ya escrito, solo tocas Enviar.' },
    ],
    ojo: [
      'Entre pacientes se dejan 30 minutos libres. El sistema lo exige y no deja agendar encima.',
      'El código de turno es único por cita y no se puede reutilizar: evita que otra persona use el cupo.',
      'Cancelar una cita exige escribir el motivo. La clienta recibe el aviso por correo y en su portal.',
    ],
    atajos: [
      'El botón "Recordar" envía el recordatorio por WhatsApp, correo o portal. El WhatsApp también se abre con el mensaje listo.',
      'La vista de mes te deja navegar días sin perder el filtro de sucursal.',
    ],
  },

  {
    num: 3,
    titulo: 'Pacientes y ficha clínica',
    bajada: 'El expediente digital y cómo se completa entre todas.',
    roles: ['Recepción', 'Esteticista', 'Administración'],
    duracion: '35 min',
    proposito:
      'La ficha reemplaza al papel. Se llena por partes: Recepción captura los datos personales y la Esteticista la parte clínica. La clienta también puede completarla desde su portal antes de llegar, lo que ahorra tiempo en cabina.',
    pasos: [
      { t: 'Busca a la clienta', d: 'En Pacientes, escribe nombre o teléfono. La lista muestra el estado de su ficha.' },
      { t: 'Lee el estado de la ficha', d: 'Pendiente (sin llenar), Paso 1 OK (datos personales listos) o Completa (con la parte clínica).' },
      { t: 'Abre la ficha', d: 'Toca la fila y luego "Llenar ficha" o "Abrir ficha".' },
      { t: 'Completa lo que te toca', d: 'Recepción: datos personales y contacto. Esteticista: antecedentes, medicamentos, fototipo, talla y peso, y la firma.' },
      { t: 'Guarda', d: 'La ficha guarda por pasos: si te interrumpen, no pierdes lo escrito.' },
    ],
    ojo: [
      'La cédula, la dirección y toda la información clínica se guardan cifradas. No las compartas por WhatsApp ni por correo.',
      'Una clienta sigue marcada como "Nueva" hasta que su ficha esté completa: reserva tiempo extra para llenarla.',
      'El fototipo (Fitzpatrick I–VI) define la intensidad del tratamiento: si dudas, consúltalo antes de aplicar.',
    ],
    atajos: [
      'El botón de acceso genera un QR y un WhatsApp para que la clienta llene su ficha desde el celular.',
      'Desde la ficha puedes cobrar, agregar servicios o transferir la clienta a otra sucursal.',
    ],
  },

  {
    num: 4,
    titulo: 'Turno en cabina',
    bajada: 'Abrir el turno con el código, atender y cerrar.',
    roles: ['Esteticista'],
    duracion: '20 min',
    proposito:
      'El turno confirma que atendiste a la clienta correcta y mide cuánto duró el servicio. Al cerrarlo, el sistema descuenta automáticamente la sesión del paquete y habilita que la clienta te califique.',
    pasos: [
      { t: 'Pide el código de turno', d: 'La clienta lo tiene en su correo de confirmación o en su portal.' },
      { t: 'Abre el turno', d: 'En tu agenda, toca "Abrir turno" y escribe el código. Si es correcto, se abre el expediente.' },
      { t: 'Revisa el saldo', d: 'Si aparece "Saldo pendiente", la clienta debe pasar por Recepción a pagar antes de que la atiendas.' },
      { t: 'Atiende y registra', d: 'Completa lo que falte de la ficha durante o después del servicio.' },
      { t: 'Cierra el turno', d: 'Toca "Cerrar turno". El sistema descuenta una sesión del paquete y te confirma cuántas quedan.' },
    ],
    ojo: [
      'No atiendas sin abrir el turno: la sesión no se descuenta y el servicio no queda registrado.',
      'Si la clienta tiene varios paquetes y al agendar no se eligió cuál, el sistema NO descuenta y te avisa. Corrígelo con Recepción.',
      'Un código ya usado no sirve otra vez. Si falla, verifica que sea la cita de hoy.',
    ],
    atajos: [
      'El tiempo de atención se mide solo; lo ve la Administración, no afecta tu evaluación directa.',
      'Al cerrar el turno la clienta recibe la invitación para calificarte con estrellas.',
    ],
  },

  {
    num: 5,
    titulo: 'Cobro y facturación',
    bajada: 'Registrar pagos, abonos y saldos con recibo.',
    roles: ['Recepción', 'Administración'],
    duracion: '35 min',
    proposito:
      'Todo cobro genera recibo y queda en caja. El servicio se elige del catálogo (no se escribe a mano) para que la base de datos quede consistente y los reportes cuadren.',
    pasos: [
      { t: 'Abre "Registrar cobro"', d: 'Desde Facturación o desde el expediente de la clienta.' },
      { t: 'Selecciona a la clienta', d: 'Búscala por nombre o teléfono. Verás su plan y su saldo.' },
      { t: 'Elige el tipo de pago', d: 'Pago total, Abono (paga una parte) o Saldo pendiente (termina de pagar).' },
      { t: 'Elige el servicio o paquete', d: 'Del catálogo. Si no tiene precio fijo, escribe el monto del día.' },
      { t: 'Reparte el pago', d: 'Puedes dividir entre Efectivo, Transferencia, Tarjeta y Azul. La suma debe dar el total.' },
      { t: 'Valida y emite', d: 'Revisa el resumen y confirma. Se emite el recibo y se registra en caja.' },
    ],
    ojo: [
      'El ITBIS (18%) ya va incluido en el monto que escribes.',
      'En un abono, el resto queda como saldo pendiente y bloquea la próxima sesión hasta que se pague.',
      'Cuando la clienta paga, se le activa solo el acceso a su portal y le llega por correo.',
    ],
    atajos: [
      'Si la clienta tiene servicios pendientes, el cobro se arma solo con esos cargos.',
      'El recibo se imprime desde la pantalla de confirmación.',
    ],
  },

  {
    num: 6,
    titulo: 'Paquetes y combos',
    bajada: 'Varios paquetes por clienta, sesiones y saldos.',
    roles: ['Recepción', 'Esteticista', 'Administración'],
    duracion: '25 min',
    proposito:
      'Una clienta puede tener varios paquetes comprados y sin consumir al mismo tiempo. El sistema los lleva todos por separado, con sus sesiones y su saldo. Ya no hace falta grapar fichas de papel para llevar el control.',
    pasos: [
      { t: 'Abre el expediente', d: 'En Pacientes, toca a la clienta.' },
      { t: 'Mira "Paquetes activos"', d: 'Cada paquete muestra su barra de avance, cuántas sesiones quedan y si tiene saldo.' },
      { t: 'Agenda indicando el paquete', d: 'Al crear la cita, elige de cuál paquete es la sesión.' },
      { t: 'Cierra el turno', d: 'La sesión se descuenta sola de ese paquete.' },
      { t: 'Verifica', d: 'Vuelve al expediente: el contador bajó y el saldo se mantiene actualizado.' },
    ],
    ojo: [
      'Si no eliges el paquete al agendar y la clienta tiene varios, la sesión NO se descuenta. El sistema te avisa al cerrar.',
      'Cuando un paquete llega a su última sesión se cierra solo y deja de aparecer como activo.',
      'El saldo que ves en la lista de pacientes es la SUMA de todos los paquetes, no de uno solo.',
    ],
    atajos: [
      'Un paquete pagado muestra la etiqueta "Pagado"; uno con deuda muestra el monto en rojo.',
      'Para cobrar el saldo de un paquete específico, entra por el expediente y no por Facturación general.',
    ],
  },

  {
    num: 7,
    titulo: 'Inventario y equipos',
    bajada: 'Productos, insumos y control de los aparatos.',
    roles: ['Recepción', 'Esteticista', 'Administración'],
    duracion: '25 min',
    proposito:
      'El inventario es por sucursal: cada estética ve y mueve solo su existencia. Los equipos llevan su historial de mantenimientos e incidencias para que ningún aparato se dañe por falta de seguimiento.',
    pasos: [
      { t: 'Entra a Inventario', d: 'Verás los productos e insumos de tu sucursal con su existencia actual.' },
      { t: 'Registra una entrada', d: 'Cuando llega mercancía: cantidad y comprobante. Queda la traza de quién la recibió.' },
      { t: 'Registra salida o consumo', d: 'Cuando se usa un insumo o se vende un producto. La venta también descuenta al facturar.' },
      { t: 'Revisa los equipos', d: 'En Equipos ves cada aparato con su estado.' },
      { t: 'Reporta mantenimiento o incidencia', d: 'Describe qué pasó. Queda en el historial del equipo y la Administración se entera.' },
    ],
    ojo: [
      'No muevas inventario de otra sucursal: solo puedes operar la tuya.',
      'Toda entrada necesita comprobante; sin él, el cuadre mensual no cierra.',
      'Reporta la incidencia el mismo día: un equipo con falla sin reportar puede lesionar a una clienta.',
    ],
    atajos: [
      'La Administración recibe un correo con los movimientos relevantes.',
      'Los insumos pueden llevar costo; los productos llevan precio de venta.',
    ],
  },

  {
    num: 8,
    titulo: 'Catálogo de servicios',
    bajada: 'Crear servicios, paquetes y combos del día.',
    roles: ['Administración', 'Recepción con permiso'],
    duracion: '20 min',
    proposito:
      'El catálogo alimenta la agenda y el cobro. Como la dirección cambia y arma combos a diario, el precio es opcional: puedes crear el combo sin monto y definirlo al cobrar.',
    pasos: [
      { t: 'Entra a Catálogo', d: 'Lo ve la Administración y quien tenga el permiso activado.' },
      { t: 'Crea el ítem', d: 'Elige el tipo: Servicio, Paquete, Combo, Producto o Insumo.' },
      { t: 'Nombre y sesiones', d: 'Para paquetes, indica cuántas sesiones incluye.' },
      { t: 'Precio (opcional)', d: 'Déjalo vacío si el monto se define al cobrar. Aparecerá como "Sin precio".' },
      { t: 'Guarda', d: 'Queda disponible al instante para agendar y cobrar.' },
    ],
    ojo: [
      'El catálogo es COMÚN a las tres estéticas: lo que cambies afecta a todas.',
      'No borres un servicio con historial: se desactiva (deja de mostrarse) pero conserva los cobros pasados.',
      'Si vas a crear combos del día, usa nombres claros con fecha o temporada para no confundir a Recepción.',
    ],
    atajos: [
      'La Administración concede el permiso en Equipo → Editar → "Puede gestionar el catálogo".',
      'Un ítem sin precio deja el monto vacío al cobrar, para que escribas el del día.',
    ],
  },

  {
    num: 9,
    titulo: 'Chat de equipo y mensajes',
    bajada: 'Instrucciones internas, archivos y etiquetar clientas.',
    roles: ['Recepción', 'Esteticista', 'Administración'],
    duracion: '20 min',
    proposito:
      'El chat interno reemplaza los grupos de WhatsApp para temas de trabajo. Puedes dirigir el mensaje a quien corresponde, etiquetar a una clienta para abrir su expediente de un toque, y enviar fotos, videos o documentos.',
    pasos: [
      { t: 'Entra al chat', d: 'En Mensajes (pestaña Equipo) o en Chat equipo.' },
      { t: 'Elige el destinatario', d: 'Arriba dice "Para:". Selecciona Todos, Admin, Recepción o Esteticista.' },
      { t: 'Etiqueta a la clienta', d: 'Con el botón 🏷 buscas a la paciente. Quien lea el mensaje abre su ficha de un toque.' },
      { t: 'Adjunta si hace falta', d: 'Con 📎 envías foto, video o documento (hasta 8 MB).' },
      { t: 'Envía', d: 'A quien corresponda le llega el aviso en su campana.' },
    ],
    ojo: [
      'No mandes datos clínicos ni fotos de clientas por WhatsApp personal: usa este chat, que es interno y controlado.',
      'Un mensaje dirigido a un rol solo lo ve ese rol y la Administración.',
      'Pide autorización a la clienta antes de tomar y compartir fotos de su tratamiento.',
    ],
    atajos: [
      'La Administración ve el chat de las tres sucursales; el personal ve el de la suya.',
      'En el celular las sucursales aparecen como botones arriba, no como barra lateral.',
    ],
  },

  {
    num: 10,
    titulo: 'Seguimiento de clientas',
    bajada: 'El tablero que se llena solo y evita perder ventas.',
    roles: ['Recepción', 'Administración'],
    duracion: '20 min',
    proposito:
      'El tablero muestra en qué punto está cada clienta: desde que escribe hasta que compra. Se alimenta solo con lo que ya haces, así que no hay que registrar nada aparte.',
    pasos: [
      { t: 'Entra a Seguimiento', d: 'Verás columnas: Nuevo mensaje, En conversación, Cotizado, Cita agendada y Vendido.' },
      { t: 'Revisa las tarjetas nuevas', d: 'Aparecen solas cuando alguien pide cita por el portal o registras una clienta nueva.' },
      { t: 'Contacta y mueve', d: 'Arrastra la tarjeta o usa el menú "Mover a" según cómo avance la conversación.' },
      { t: 'Deja que se cierre solo', d: 'Al agendar pasa a "Cita agendada"; al cobrar pasa a "Vendido".' },
      { t: 'Trabaja los estancados', d: 'Lo que lleva días en la misma columna es tu lista de llamadas del día.' },
    ],
    ojo: [
      'Una tarjeta nunca retrocede sola: si ya está en Vendido, se queda ahí aunque agendes otra cita.',
      'El tablero es por sucursal: solo ves tus clientas.',
      'No borres tarjetas para "limpiar": pierdes la traza de por qué no se cerró la venta.',
    ],
    atajos: [
      'Cada tarjeta trae el canal por donde llegó la clienta.',
      'Úsalo como guion de llamadas: empieza por "Cotizado", que es donde está el dinero más cerca.',
    ],
  },

  {
    num: 11,
    titulo: 'Cierre de caja',
    bajada: 'Conteo ciego y cuadre del día.',
    roles: ['Recepción', 'Administración'],
    duracion: '25 min',
    proposito:
      'Al final del día Recepción cuenta el efectivo sin ver el total del sistema (conteo ciego). Después la Administración compara y explica cualquier diferencia. Así el cuadre es confiable y nadie queda bajo sospecha.',
    pasos: [
      { t: 'Abre Cierre de caja', d: 'Al terminar el turno.' },
      { t: 'Cuenta y registra', d: 'Escribe lo contado por método: efectivo, transferencia, tarjeta y Azul.' },
      { t: 'Guarda el conteo', d: 'No verás el total del sistema: eso hace válido el conteo.' },
      { t: 'La Administración cuadra', d: 'Compara lo contado con lo registrado y ve si hay faltante o sobrante.' },
      { t: 'Explica la diferencia', d: 'Si hay descuadre, se escribe el comentario. Queda en el historial.' },
    ],
    ojo: [
      'Cuenta el efectivo dos veces antes de guardar: el conteo no se puede modificar después.',
      'Un descuadre sin comentario queda abierto y se arrastra al reporte del mes.',
      'No cierres caja con cobros sin registrar: primero emite todos los recibos.',
    ],
    atajos: [
      'El botón "Nuevo cuadre" abre el formulario en blanco.',
      'La Administración puede corregir el total del sistema si hubo un cobro registrado fuera de hora.',
    ],
  },

  {
    num: 12,
    titulo: 'Administración',
    bajada: 'Equipo, permisos, importar clientas y mantenimiento.',
    roles: ['Administración'],
    duracion: '30 min',
    proposito:
      'Reúne lo que solo la dirección debe tocar: crear usuarios, conceder permisos, cargar la base de clientas desde Excel y borrar datos de prueba.',
    pasos: [
      { t: 'Crea colaboradoras', d: 'Equipo → Agregar colaborador: nombre, correo, contraseña, rol y sucursal.' },
      { t: 'Concede permisos', d: 'En Editar puedes activar "Puede gestionar el catálogo" a quien ayude a crear servicios.' },
      { t: 'Importa clientas', d: 'Pacientes → Importar: descarga la plantilla, se llena en Excel y se sube. Recepción también puede, siempre en su sucursal.' },
      { t: 'Simula antes de importar', d: 'El botón "Simular" te dice duplicados y errores sin escribir nada.' },
      { t: 'Mantenimiento', d: 'Configuración → Mantenimiento de datos: borra por categoría (pacientes, mensajes, cuadres…) escribiendo BORRAR.' },
    ],
    ojo: [
      'Los correos base de Domarkt no se pueden eliminar ni desactivar: garantizan que siempre haya acceso.',
      'El borrado de mantenimiento es DEFINITIVO y aplica a las tres sucursales. No hay deshacer.',
      'Importa siempre un lote de prueba de 20 antes de cargar cientos de fichas.',
    ],
    atajos: [
      'La plantilla acepta encabezados en español: nombre, telefono, correo, sexo, nacimiento, cedula.',
      'Los duplicados se detectan por teléfono, así que puedes reimportar sin miedo a repetir clientas.',
    ],
  },
];
