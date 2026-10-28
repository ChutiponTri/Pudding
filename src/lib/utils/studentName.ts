/**
 * A name or surname must contain at least one letter (Thai or Latin). Catches
 * a student number or roll number typed into the name fields, e.g. "101".
 * Student numbers themselves (3+ digits) belong in student_id.
 */
export function isValidPersonName(value: string | undefined | null): boolean {
  return /[\p{L}]/u.test((value || '').trim());
}

/** Thai error for invalid name fields, or null when both are fine. */
export function personNameError(firstName: string, lastName: string): string | null {
  if (!firstName.trim() || !lastName.trim()) return 'กรุณากรอกชื่อและนามสกุล';
  if (!isValidPersonName(firstName)) return 'ชื่อต้องเป็นตัวอักษร ห้ามใส่ตัวเลขหรือรหัสนักเรียน';
  if (!isValidPersonName(lastName)) return 'นามสกุลต้องเป็นตัวอักษร ห้ามใส่ตัวเลขหรือรหัสนักเรียน (ใส่รหัสในช่องรหัสนักเรียน)';
  return null;
}
