import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { Role } from '@prisma/client';

const signOpts: SignOptions = { expiresIn: env.jwtExpires as SignOptions['expiresIn'] };

export interface StaffTokenPayload {
  kind: 'staff';
  sub: string; // userId
  role: Role;
  branchId: string | null;
  name: string;
}

export interface PatientTokenPayload {
  kind: 'patient';
  sub: string; // patientAccountId
  patientId: string;
  name: string;
}

export type TokenPayload = StaffTokenPayload | PatientTokenPayload;

export function signStaff(payload: Omit<StaffTokenPayload, 'kind'>): string {
  return jwt.sign({ ...payload, kind: 'staff' }, env.jwtSecret, signOpts);
}

export function signPatient(payload: Omit<PatientTokenPayload, 'kind'>): string {
  return jwt.sign({ ...payload, kind: 'patient' }, env.jwtPatientSecret, signOpts);
}

export function verifyStaff(token: string): StaffTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as StaffTokenPayload;
  if (decoded.kind !== 'staff') throw new Error('Wrong token kind');
  return decoded;
}

export function verifyPatient(token: string): PatientTokenPayload {
  const decoded = jwt.verify(token, env.jwtPatientSecret) as PatientTokenPayload;
  if (decoded.kind !== 'patient') throw new Error('Wrong token kind');
  return decoded;
}
