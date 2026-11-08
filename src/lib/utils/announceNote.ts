/**
 * What "ประกาศคะแนน" did to the scores, for the teacher's notice: students who
 * handed in nothing got an official 0 (so every student sees a result), and
 * handed-in work not fully graded yet stays hidden until it is.
 * Empty when there is nothing to say.
 */
export function announceNote(result: { zeroed?: number; ungraded?: number }, th = true): string {
  const parts: string[] = [];
  if (result.zeroed) parts.push(th ? `ให้ 0 คะแนนนักเรียนที่ไม่ส่ง ${result.zeroed} คน` : `Gave 0 to ${result.zeroed} who handed in nothing`);
  if (result.ungraded)
    parts.push(th ? `ยังตรวจไม่เสร็จ ${result.ungraded} คน (นักเรียนจะเห็นคะแนนเมื่อตรวจเสร็จ)` : `${result.ungraded} still to grade (shown once graded)`);
  return parts.join(' • ');
}
