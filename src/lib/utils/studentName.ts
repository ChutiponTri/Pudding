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

type StudentProfile = { first_name?: string | null; last_name?: string | null; student_id?: string | null; institution?: string | null };

/**
 * Why a student may not request to join a classroom yet, or null when their
 * profile is complete: real name and surname, a student number (3+ chars, not
 * the LINE id placeholder) and a school.
 */
export function studentProfileError(profile: StudentProfile | null | undefined): string | null {
  const firstName = (profile?.first_name || '').trim();
  const lastName = (profile?.last_name || '').trim();
  const studentId = (profile?.student_id || '').trim();
  if (firstName === 'นักเรียน') return 'กรุณากรอกชื่อจริงก่อนขอเข้าห้องเรียน';
  const nameError = personNameError(firstName, lastName);
  if (nameError) return nameError;
  if (studentId.length < 3 || studentId.startsWith('U')) return 'กรุณากรอกรหัสนักเรียน (อย่างน้อย 3 หลัก) ก่อนขอเข้าห้องเรียน';
  if (!(profile?.institution || '').trim()) return 'กรุณาเลือกสถานศึกษาก่อนขอเข้าห้องเรียน';
  return null;
}
