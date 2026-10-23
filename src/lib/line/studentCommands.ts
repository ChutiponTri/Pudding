/**
 * Commands typed in a classroom's LINE group to post a link for the class. They
 * start with "พุดดิ้ง" or "pudding" (with or without "#"), e.g. "พุดดิ้ง เช็คชื่อ".
 * Only the classroom's teachers and TAs get an answer (students are ignored so
 * they cannot flood the group). The answer is a reply, which does not count
 * toward the LINE message quota (pushed messages do).
 */

export type StudentCommand = 'help' | 'attendance' | 'submit' | 'join' | 'works' | 'home' | 'status';

const KEYWORD = /^#?\s*(?:pudding|พุดดิ้ง|พุดดิง|พุดดิ่ง)\s*(.*)$/i;

/**
 * Checked in this order, so the more specific wins: "ลิงก์เช็คชื่อ" is
 * attendance (not home) and "ส่งงาน" is submit (not the works list).
 */
const COMMAND_WORDS: Array<[StudentCommand, string[]]> = [
  ['attendance', ['เช็คชื่อ', 'เช็กชื่อ', 'เชคชื่อ', 'มาเรียน', 'attendance', 'checkin', 'check-in']],
  ['submit', ['ส่งงาน', 'ส่งการบ้าน', 'ทำข้อสอบ', 'submit']],
  ['join', ['เข้าห้อง', 'เข้าร่วม', 'รหัส', 'join', 'code', 'invite']],
  ['works', ['งาน', 'การบ้าน', 'ข้อสอบ', 'ค้าง', 'work', 'list', 'todo']],
  ['home', ['หน้าหลัก', 'ลิงก์', 'ลิงค์', 'เปิด', 'ห้องเรียน', 'home', 'link', 'app']],
  ['status', ['สถานะ', 'status']],
  // Anything else (เมนู, ช่วย, คำสั่ง, …) falls through to help.
];

/** Old phrases that still work without the keyword. */
const BARE_JOIN = /^(?:#pudding\s+)?(?:join|code|ขอรหัส|ขอรหัสเข้าห้อง|รหัสเข้าห้อง|เข้าห้อง)$/i;

/** The command in a group message, or null when the message is not for the bot. */
export function parseStudentCommand(text: string): StudentCommand | null {
  const message = text.trim();
  if (BARE_JOIN.test(message)) return 'join';
  const match = message.match(KEYWORD);
  if (!match) return null;
  const rest = match[1].toLowerCase().replace(/\s+/g, '');
  if (!rest) return 'help';
  for (const [command, words] of COMMAND_WORDS) {
    if (words.some((word) => rest.includes(word))) return command;
  }
  return 'help';
}

export function studentHelpText(classroomTitle?: string | null): string {
  return `🍮 คำสั่ง Pudding${classroomTitle ? `\n📘 ${classroomTitle}` : ''}
สำหรับคุณครูและ TA พิมพ์ "พุดดิ้ง" ตามด้วยคำสั่ง
บอทจะตอบให้ทุกคนในกลุ่มเห็น เช่น

• พุดดิ้ง เช็คชื่อ → ลิงก์เช็คชื่อคาบที่เปิดอยู่
• พุดดิ้ง งาน → สรุปงาน/ข้อสอบที่ยังเปิดรับ และเวลาที่เหลือ
• พุดดิ้ง ส่งงาน → ลิงก์ส่งของแต่ละงาน
• พุดดิ้ง เข้าห้อง → รหัสและลิงก์เข้าห้องเรียน
• พุดดิ้ง หน้าหลัก → เปิดห้องเรียนใน Pudding

พิมพ์ "pudding" แทน "พุดดิ้ง" ก็ได้
(ข้อความจากนักเรียน บอทจะไม่ตอบ)`;
}
