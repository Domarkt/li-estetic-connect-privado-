import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';

const prisma = new PrismaClient();

const hash = (p: string) => bcrypt.hash(p, 10);

async function main() {
  console.log('Sembrando Li Estetic Connect…');

  // Limpieza (orden por dependencias)
  await prisma.$transaction([
    prisma.purchaseRequest.deleteMany(),
    prisma.patientAccount.deleteMany(),
    prisma.redemption.deleteMany(),
    prisma.pointsEntry.deleteMany(),
    prisma.reward.deleteMany(),
    prisma.pointsRule.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.invoiceItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.invoiceSequence.deleteMany(),
    prisma.chargeItem.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.treatment.deleteMany(),
    prisma.clinicalRecord.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.therapistProfile.deleteMany(),
    prisma.branchGoal.deleteMany(),
    prisma.catalogItem.deleteMany(),
    prisma.user.deleteMany(),
    prisma.branch.deleteMany(),
  ]);

  // ── Sucursales ──
  const [e1, e2, e3] = await Promise.all([
    prisma.branch.create({
      data: {
        code: 'e1', name: 'Estética 1', place: 'Plaza San Vicente, 1er nivel',
        dotColor: '#B31C86', address: 'Plaza San Vicente, 1er nivel, Santo Domingo Este',
        monthlyGoal: 600000, dailyGoal: 25000, perAsesorGoal: 8333,
      },
    }),
    prisma.branch.create({
      data: {
        code: 'e2', name: 'Estética 2', place: 'Plaza Baró, 2do nivel',
        dotColor: '#2C7FB8', address: 'Plaza Baró, 2do nivel, Santo Domingo',
        monthlyGoal: 500000, dailyGoal: 20833, perAsesorGoal: 6944,
      },
    }),
    prisma.branch.create({
      data: {
        code: 'e3', name: 'Estética 3', place: 'Rómulo Betancour, Plaza Oliver Marín, 2do nivel',
        dotColor: '#1F9D6B', address: 'Av. Rómulo Betancourt, Plaza Oliver Marín, 2do nivel',
        monthlyGoal: 400000, dailyGoal: 16667, perAsesorGoal: 5556,
      },
    }),
  ]);
  const byCode: Record<string, string> = { e1: e1.id, e2: e2.id, e3: e3.id };

  const staffPw = await hash(env.seedStaffPassword);

  // ── Usuarios (personal) ──
  const admin = await prisma.user.create({
    data: { name: 'Directora LI', email: 'direccion@liestetic.do', passwordHash: staffPw, role: 'ADMIN', branchId: null, avatarColor: '#C9880E' },
  });
  const recepSV = await prisma.user.create({
    data: { name: 'Recepción SV', email: 'recepcion.sv@liestetic.do', passwordHash: staffPw, role: 'RECEPCIONISTA', branchId: e1.id, avatarColor: '#2C7FB8' },
  });
  const recepBaro = await prisma.user.create({
    data: { name: 'Recepción Baró', email: 'recepcion.baro@liestetic.do', passwordHash: staffPw, role: 'RECEPCIONISTA', branchId: e2.id, avatarColor: '#245E85' },
  });

  // Esteticistas (con perfil de puntos)
  const therapistSeed = [
    { name: 'Yerlin Peña', email: 'yerlin@liestetic.do', branch: 'e1', points: 1240, monthSales: 118000, color: '#B31C86' },
    { name: 'Katherine Gómez', email: 'katherine@liestetic.do', branch: 'e3', points: 1385, monthSales: 132000, color: '#1F9D6B' },
    { name: 'Carla Ruiz', email: 'carla@liestetic.do', branch: 'e2', points: 1180, monthSales: 121000, color: '#2C7FB8' },
    { name: 'Massiel Díaz', email: 'massiel@liestetic.do', branch: 'e1', points: 960, monthSales: 92000, color: '#8E1268' },
    { name: 'Dahiana Cruz', email: 'dahiana@liestetic.do', branch: 'e2', points: 845, monthSales: 84000, color: '#245E85' },
    { name: 'Paola Núñez', email: 'paola@liestetic.do', branch: 'e3', points: 1020, monthSales: 101000, color: '#17805A' },
  ];
  const therapists: Record<string, { id: string; monthSales: number; points: number }> = {};
  for (const t of therapistSeed) {
    const u = await prisma.user.create({
      data: {
        name: t.name, email: t.email, passwordHash: staffPw, role: 'ESTETICISTA',
        branchId: byCode[t.branch], avatarColor: t.color,
        therapistProfile: { create: { points: t.points, monthSales: t.monthSales } },
      },
    });
    therapists[t.name] = { id: u.id, monthSales: t.monthSales, points: t.points };
  }

  // ── Catálogo ──
  const catalogSeed = [
    { kind: 'SERVICIO', name: 'Reducción de medidas', price: 18000, sessions: 10, category: 'Corporal' },
    { kind: 'SERVICIO', name: 'Tratamiento anti-celulitis', price: 22000, sessions: 10, category: 'Corporal' },
    { kind: 'PAQUETE', name: 'Transformación Total', price: 25000, sessions: 12, category: 'Premium' },
    { kind: 'SERVICIO', name: 'Masaje reductor', price: 1800, sessions: 1, category: 'Corporal' },
    { kind: 'SERVICIO', name: 'Radiofrecuencia corporal', price: 4000, sessions: 1, category: 'Corporal' },
    { kind: 'SERVICIO', name: 'Cavitación', price: 3500, sessions: 1, category: 'Corporal' },
    { kind: 'SERVICIO', name: 'Depilación láser (zona)', price: 3500, sessions: 1, category: 'Facial' },
    { kind: 'SERVICIO', name: 'Limpieza facial profunda', price: 2500, sessions: 1, category: 'Facial' },
    { kind: 'SERVICIO', name: 'Lifting facial', price: 12000, sessions: 6, category: 'Facial' },
    { kind: 'COMBO', name: 'Combo Verano: Reducción + Radiofrecuencia', price: 20000, sessions: 14, tag: 'Ahorro RD$2,000' },
    { kind: 'COMBO', name: 'Combo Novia: Facial + Lifting + Depilación', price: 18000, sessions: 13, tag: 'Popular' },
    { kind: 'COMBO', name: 'Combo Detox Total', price: 15000, sessions: 12 },
    { kind: 'PRODUCTO', name: 'Crema reafirmante corporal', price: 1200, sessions: 1, stock: 24 },
    { kind: 'PRODUCTO', name: 'Gel reductor frío', price: 950, sessions: 1, stock: 18 },
    { kind: 'PRODUCTO', name: 'Sérum facial vitamina C', price: 1800, sessions: 1, stock: 12 },
    { kind: 'PRODUCTO', name: 'Protector solar SPF 50', price: 900, sessions: 1, stock: 30 },
  ] as const;
  const catalog: Record<string, string> = {};
  for (const c of catalogSeed) {
    const item = await prisma.catalogItem.create({
      data: { kind: c.kind, name: c.name, price: c.price, sessions: c.sessions, category: (c as { category?: string }).category ?? null, stock: (c as { stock?: number }).stock ?? null, tag: (c as { tag?: string }).tag ?? null },
    });
    catalog[c.name] = item.id;
  }

  // ── Pacientes + ficha + tratamiento ──
  const patientSeed = [
    { name: 'María Pérez', branch: 'e1', phone: '809-555-0101', age: 32, since: 'Hoy', color: '#B31C86', ficha: 'PENDIENTE', skin: null, motivo: ['Adiposidad localizada'], plan: null, total: 0, done: 0, balance: 0, therapist: 'Yerlin Peña' },
    { name: 'Ana Batista', branch: 'e1', phone: '809-555-0142', age: 34, since: 'Ene 2026', color: '#8E1268', ficha: 'COMPLETA', skin: 'III', motivo: ['Adiposidad localizada', 'Celulitis'], plan: 'Reducción de medidas', total: 10, done: 4, balance: 0, therapist: 'Yerlin Peña', account: true },
    { name: 'María Fernández', branch: 'e2', phone: '829-555-0198', age: 29, since: 'Hoy', color: '#2C7FB8', ficha: 'PENDIENTE', skin: null, motivo: ['Flaccidez'], plan: null, total: 0, done: 0, balance: 0, therapist: 'Carla Ruiz' },
    { name: 'Rosa Jiménez', branch: 'e1', phone: '809-555-0177', age: 41, since: 'Nov 2025', color: '#8E1268', ficha: 'COMPLETA', skin: 'IV', motivo: ['Arrugas', 'Manchas'], plan: 'Lifting facial', total: 6, done: 5, balance: 2000, therapist: 'Massiel Díaz' },
    { name: 'Laura Peralta', branch: 'e3', phone: '849-555-0110', age: 26, since: 'Feb 2026', color: '#1F9D6B', ficha: 'COMPLETA', skin: 'II', motivo: ['Depilación'], plan: 'Transformación Total', total: 12, done: 2, balance: 12500, therapist: 'Katherine Gómez' },
    { name: 'Sofía Reyes', branch: 'e2', phone: '809-555-0165', age: 38, since: 'Dic 2025', color: '#245E85', ficha: 'COMPLETA', skin: 'III', motivo: ['Adiposidad localizada'], plan: 'Tratamiento anti-celulitis', total: 10, done: 8, balance: 0, therapist: 'Dahiana Cruz' },
    { name: 'Gabriela Mena', branch: 'e3', phone: '829-555-0133', age: 31, since: 'Ene 2026', color: '#17805A', ficha: 'COMPLETA', skin: 'IV', motivo: ['Estrías', 'Flaccidez'], plan: 'Reducción de medidas', total: 10, done: 6, balance: 0, therapist: 'Paola Núñez' },
    { name: 'Carmen Santos', branch: 'e1', phone: '809-555-0120', age: 45, since: 'Oct 2025', color: '#C9880E', ficha: 'COMPLETA', skin: 'V', motivo: ['Rosácea'], plan: 'Limpieza facial profunda', total: 4, done: 4, balance: 0, therapist: 'Yerlin Peña' },
  ] as const;

  const patientIds: Record<string, string> = {};
  for (const p of patientSeed) {
    const isComplete = p.ficha === 'COMPLETA';
    const patient = await prisma.patient.create({
      data: {
        branchId: byCode[p.branch], name: p.name, phone: p.phone, age: p.age,
        avatarColor: p.color, type: isComplete ? 'RECURRENTE' : 'NUEVO',
        clinicalRecord: {
          create: {
            status: p.ficha,
            motivos: [...p.motivo],
            fototipo: p.skin,
            tratamiento: p.plan,
            therapistId: therapists[p.therapist]?.id ?? null,
            completedAt: isComplete ? new Date() : null,
          },
        },
      },
    });
    patientIds[p.name] = patient.id;

    if (p.plan && p.total > 0) {
      const planItem = catalogSeed.find((c) => c.name === p.plan);
      await prisma.treatment.create({
        data: {
          patientId: patient.id, catalogItemId: catalog[p.plan] ?? null, name: p.plan,
          totalSessions: p.total, doneSessions: p.done,
          price: planItem?.price ?? p.balance, balance: p.balance,
          expiresAt: new Date('2026-09-12'),
        },
      });
    }

    if ((p as { account?: boolean }).account) {
      await prisma.patientAccount.create({
        data: { patientId: patient.id, login: p.phone, passwordHash: await hash(env.seedPatientPassword) },
      });
    }
  }

  // ── Citas de hoy (agenda) ──
  const now = new Date();
  const at = (h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const apptSeed = [
    { patient: 'María Pérez', branch: 'e1', therapist: 'Yerlin Peña', service: 'Valoración inicial', h: 12, m: 0, type: 'NUEVO', status: 'SIN_CONFIRMAR' },
    { patient: 'Ana Batista', branch: 'e1', therapist: 'Yerlin Peña', service: 'Reducción de medidas · sesión 5', h: 10, m: 30, type: 'RECURRENTE', status: 'CONFIRMADA' },
    { patient: 'María Fernández', branch: 'e2', therapist: 'Carla Ruiz', service: 'Valoración de flaccidez', h: 11, m: 0, type: 'NUEVO', status: 'SIN_CONFIRMAR' },
    { patient: 'Rosa Jiménez', branch: 'e1', therapist: 'Massiel Díaz', service: 'Lifting facial · sesión 6', h: 14, m: 0, type: 'RECURRENTE', status: 'CONFIRMADA' },
    { patient: 'Laura Peralta', branch: 'e3', therapist: 'Katherine Gómez', service: 'Transformación Total · sesión 3', h: 15, m: 30, type: 'RECURRENTE', status: 'CONFIRMADA' },
    { patient: 'Carmen Santos', branch: 'e1', therapist: 'Yerlin Peña', service: 'Limpieza facial', h: 16, m: 0, type: 'RECURRENTE', status: 'SIN_CONFIRMAR' },
  ] as const;
  const apptCode = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join(''); };
  for (const a of apptSeed) {
    await prisma.appointment.create({
      data: {
        branchId: byCode[a.branch], patientId: patientIds[a.patient],
        therapistId: therapists[a.therapist]?.id ?? null,
        serviceName: a.service, startsAt: at(a.h, a.m), durationMin: 60,
        patientType: a.type, status: a.status, code: apptCode(),
      },
    });
  }

  // ── Secuencias de factura por sucursal ──
  for (const id of Object.values(byCode)) {
    await prisma.invoiceSequence.create({ data: { branchId: id, lastNumber: 2218 } });
  }

  // ── Facturas demo ──
  const invoiceSeed = [
    { number: 'F-2219', patient: 'Ana Batista', branch: 'e1', concept: 'Paquete Reducción de medidas', total: 18000, method: 'TRANSFERENCIA' },
    { number: 'F-2218', patient: 'Rosa Jiménez', branch: 'e1', concept: 'Sesión Lifting facial', total: 2000, method: 'EFECTIVO' },
    { number: 'F-2217', patient: 'Sofía Reyes', branch: 'e2', concept: 'Anti-celulitis (2da cuota)', total: 11000, method: 'TARJETA' },
    { number: 'F-2216', patient: 'Laura Peralta', branch: 'e3', concept: 'Transformación Total (anticipo)', total: 12500, method: 'TRANSFERENCIA' },
    { number: 'F-2215', patient: 'Gabriela Mena', branch: 'e3', concept: 'Radiofrecuencia + masaje', total: 5800, method: 'AZUL' },
    { number: 'F-2214', patient: 'Carmen Santos', branch: 'e1', concept: 'Limpieza facial', total: 2500, method: 'EFECTIVO' },
  ] as const;
  for (const inv of invoiceSeed) {
    const itbis = Math.round(inv.total - inv.total / 1.18); // ITBIS incluido 18%
    await prisma.invoice.create({
      data: {
        number: inv.number, branchId: byCode[inv.branch], patientId: patientIds[inv.patient] ?? null,
        cashierId: inv.branch === 'e1' ? recepSV.id : inv.branch === 'e2' ? recepBaro.id : admin.id,
        concept: inv.concept, subtotal: inv.total - itbis, itbis, total: inv.total,
        method: inv.method, status: 'PAGADA',
        items: { create: { name: inv.concept, qty: 1, unitPrice: inv.total, total: inv.total } },
      },
    });
  }

  // ── Reglas de puntos ──
  const earn = [
    ['1ª venta antes de 11 AM (>RD$3,000)', 50],
    ['Supera meta personal antes de 4 PM', 75],
    ['Venta de paquete premium (>RD$15,000)', 150],
    ['Cliente nuevo referido (que compra)', 30],
    ['Reseña 5★ con mención al asesor', 25],
    ['Venta adicional fuera de horario', 60],
  ] as const;
  const deduct = [
    ['Llegada tarde (1–14 min)', -30],
    ['Llegada tarde (15+ min)', -100],
    ['Cliente esperando >5 min', -50],
    ['Uso de celular en área de atención', -100],
    ['Reporte diario incompleto', -50],
    ['Ausencia injustificada', -300],
  ] as const;
  await prisma.pointsRule.createMany({
    data: [
      ...earn.map(([label, points], i) => ({ label, points, isEarn: true, sortOrder: i })),
      ...deduct.map(([label, points], i) => ({ label, points, isEarn: false, sortOrder: i })),
    ],
  });

  // ── Premios ──
  await prisma.reward.createMany({
    data: [
      { label: 'Kit de productos premium', cost: 1000 },
      { label: 'Facial o masaje para familiar', cost: 1500 },
      { label: 'Día libre pagado', cost: 3000 },
      { label: 'Día de Spa en Li Estetic', cost: 3500 },
      { label: 'Cena para 2 · restaurante', cost: 4000 },
      { label: 'Bono económico RD$5,000', cost: 4000 },
    ],
  });

  // ── Ledger de puntos (ejemplo para Yerlin) ──
  const yerlin = therapists['Yerlin Peña'];
  await prisma.pointsEntry.createMany({
    data: [
      { userId: yerlin.id, points: 150, reason: 'VENTA', label: 'Venta paquete premium — Transformación Total' },
      { userId: yerlin.id, points: 50, reason: 'PUNTUALIDAD', label: '1ª venta antes de 11 AM' },
      { userId: yerlin.id, points: 75, reason: 'META', label: 'Superó meta personal antes de 4 PM' },
      { userId: yerlin.id, points: -30, reason: 'DEDUCCION', label: 'Llegada tarde (1–14 min)' },
      { userId: yerlin.id, points: 25, reason: 'RESENA', label: 'Reseña 5★ con mención' },
    ],
  });

  // ── Conversaciones omnicanal ──
  const convSeed = [
    { channel: 'INSTAGRAM', name: 'Wanda Rodríguez', branch: 'e1', unread: 2, color: '#B31C86', last: '¿El paquete de reducción incluye radiofrecuencia?', msgs: [['Hola! Vi sus resultados en Instagram 😍', false], ['¿El paquete de reducción incluye radiofrecuencia?', false]] },
    { channel: 'WHATSAPP', name: 'Elena Martínez', branch: 'e1', unread: 1, color: '#1F9D6B', last: 'Perfecto, ¿tienen espacio el viernes?', msgs: [['Buenas, quiero info de depilación láser', false], ['¡Hola Elena! La zona de axilas está en RD$3,500 por sesión 💜', true], ['Perfecto, ¿tienen espacio el viernes?', false]] },
    { channel: 'MESSENGER', name: 'Priscila Gómez', branch: 'e2', unread: 0, color: '#2C7FB8', last: 'Gracias, lo voy a pensar 🙏', msgs: [['Me interesa el tratamiento anti-celulitis', false], ['Son 10 sesiones por RD$22,000, incluye valoración gratis', true], ['Gracias, lo voy a pensar 🙏', false]] },
    { channel: 'TIKTOK', name: 'Yudelka Frías', branch: 'e3', unread: 3, color: '#8E1268', last: 'Vi tu video del before/after 🔥', msgs: [['Vi tu video del before/after 🔥', false], ['¿Cuánto cuesta la Transformación Total?', false], ['Estoy en Rómulo Betancourt', false]] },
  ] as const;
  for (const c of convSeed) {
    await prisma.conversation.create({
      data: {
        branchId: byCode[c.branch], channel: c.channel, contactName: c.name,
        avatarColor: c.color, unread: c.unread, lastMessage: c.last,
        messages: { create: c.msgs.map(([body, fromMe]) => ({ body: body as string, fromMe: fromMe as boolean })) },
      },
    });
  }

  // ── Leads (pipeline) ──
  const leadSeed = [
    { name: 'Wanda Rodríguez', branch: 'e1', stage: 'NUEVO_MENSAJE', channel: 'INSTAGRAM', summary: 'Interesada en paquete de reducción' },
    { name: 'Elena Martínez', branch: 'e1', stage: 'NUEVO_MENSAJE', channel: 'WHATSAPP', summary: 'Depilación láser axilas' },
    { name: 'Priscila Gómez', branch: 'e2', stage: 'EN_CONVERSACION', channel: 'MESSENGER', summary: 'Anti-celulitis 10 sesiones' },
    { name: 'Yudelka Frías', branch: 'e3', stage: 'COTIZADO', channel: 'TIKTOK', summary: 'Transformación Total' },
    { name: 'Mariana Tavárez', branch: 'e2', stage: 'COTIZADO', channel: 'INSTAGRAM', summary: 'Combo Novia' },
    { name: 'María Fernández', branch: 'e2', stage: 'CITA_AGENDADA', summary: 'Valoración de flaccidez' },
    { name: 'Ana Batista', branch: 'e1', stage: 'VENDIDO', summary: 'Paquete Reducción de medidas' },
  ] as const;
  for (const l of leadSeed) {
    await prisma.lead.create({
      data: { branchId: byCode[l.branch], name: l.name, stage: l.stage, channel: (l as { channel?: string }).channel as never ?? null, summary: l.summary },
    });
  }

  console.log('✔ Seed completo.');
  console.log('  Personal:  direccion@liestetic.do / recepcion.sv@liestetic.do / yerlin@liestetic.do  (pw:', env.seedStaffPassword + ')');
  console.log('  Paciente:  809-555-0142  (pw:', env.seedPatientPassword + ')');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
