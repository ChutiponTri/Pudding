import 'server-only';
import { webUrl } from '@/lib/line/groupLink';
import { bubble, button, COLORS, fit, text, type BareAction, type FlexAction, type FlexMessage } from '@/lib/line/flexKit';

/**
 * LINE Flex cards the bot sends: the work card (new homework / new quiz), the
 * group menu, the "for teachers" connect card, the new-student welcome, the
 * classroom opened / join cards, check-in, reminder, results, and the removed /
 * reconnected notices. Other replies with buttons use textCard (flexKit). Header art lives in public/cards/line (built
 * from the mockups in public/cards by scripts/build-line-cards.mjs); the text
 * and buttons are real Flex parts so they can be tapped and filled in.
 *
 * Light purple is the theme; connect is green, disconnect red.
 */

/** Bump after rebuilding the images: LINE caches them by URL. */
const CARD_IMAGE_VERSION = '3';

export { COLORS, type FlexMessage } from '@/lib/line/flexKit';

/** Header art: the image file's own aspect ratio, so nothing is cropped. */
const HEROES = {
  'new-assignment': '1040:433',
  'new-quiz': '1040:352',
  'new-student': '1040:309',
  'first-conn': '1040:572',
  menu: '1040:265',
  'open-class': '1040:810',
  'join-class': '1040:667',
  remind: '1040:400',
  'score-announce': '1040:364',
} as const;

function hero(name: keyof typeof HEROES, action?: FlexAction) {
  return {
    type: 'image',
    url: webUrl(`/cards/line/${name}.jpg?v=${CARD_IMAGE_VERSION}`),
    size: 'full',
    aspectRatio: HEROES[name],
    aspectMode: 'cover',
    ...(action ? { action } : {}),
  };
}

/** Rounded tile with its own text colour (the menu's light purple buttons). */
function tile(label: string, action: BareAction, options: { bg?: string; color?: string; flex?: number } = {}) {
  return {
    type: 'box',
    layout: 'vertical',
    flex: options.flex ?? 1,
    backgroundColor: options.bg || COLORS.lavender,
    cornerRadius: 'md',
    paddingAll: '12px',
    justifyContent: 'center',
    action: { ...action, label: fit(label, 40) },
    contents: [text(label, { size: 'sm', weight: 'bold', align: 'center', color: options.color || COLORS.lavenderText, wrap: false })],
  };
}

const row = (...contents: unknown[]) => ({ type: 'box', layout: 'horizontal', spacing: 'sm', contents });

function sectionLabel(label: string) {
  return {
    type: 'box',
    layout: 'horizontal',
    margin: 'lg',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        backgroundColor: COLORS.purple,
        cornerRadius: 'xxl',
        paddingStart: '12px',
        paddingEnd: '12px',
        paddingTop: '3px',
        paddingBottom: '3px',
        contents: [text(label, { size: 'xs', weight: 'bold', color: '#FFFFFF', wrap: false })],
      },
    ],
  };
}


// ---------------------------------------------------------------------------
// Work card (reply to the teacher's shared work link, or a scheduled push)
// ---------------------------------------------------------------------------

export type WorkCardInput = {
  isExam: boolean;
  /** "#งานที่ 3": the work's place among the classroom's homework (or quizzes). */
  number?: number;
  /** Subject and teacher: "ภาษาไทย · ครูต้น". */
  byline: string;
  title: string;
  rows: Array<{ label: string; value: string }>;
  /** Small note under the rows (e.g. a retake's "เฉพาะ 3 คน"). */
  note?: string;
  /** Opens the work in the student LIFF app. */
  openUrl: string;
  /** Opens the student's list of work (their hand-in status). */
  statusUrl?: string | null;
  retake?: boolean;
};

export function workCard(input: WorkCardInput): FlexMessage {
  const kind = input.retake ? 'สอบซ่อม' : input.isExam ? 'ข้อสอบ' : 'งาน';
  const tag = input.number ? `#${kind}ที่ ${input.number}` : `#${kind}ใหม่`;
  const body: unknown[] = [
    {
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        text(tag, { size: 'sm', weight: 'bold', color: COLORS.amber, flex: 0, wrap: false }),
        text(input.byline, { size: 'sm', color: COLORS.muted, wrap: false }),
      ],
    },
    text(input.title, { size: 'xl', weight: 'bold', color: COLORS.purpleDark, margin: 'sm' }),
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      margin: 'md',
      contents: input.rows.map((item) => ({
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          text(`${item.label}:`, { size: 'sm', color: COLORS.muted, flex: 0, wrap: false }),
          text(item.value, { size: 'sm', weight: 'bold', color: COLORS.lavenderText }),
        ],
      })),
    },
  ];
  if (input.note) body.push(text(input.note, { size: 'xs', color: COLORS.muted, margin: 'md' }));

  const footer: unknown[] = [button(input.isExam ? '📝 ทำแบบทดสอบ' : '📤 ส่งงาน', { type: 'uri', uri: input.openUrl })];
  if (input.statusUrl) {
    footer.push(statusLink(input.statusUrl));
  }

  const due = input.rows.map((item) => `${item.label}: ${item.value}`).join('\n');
  return {
    type: 'flex',
    altText: fit(`${input.isExam ? '📝 ข้อสอบใหม่' : '📋 งานใหม่'}: ${input.title}${due ? `\n${due}` : ''}`, 400),
    contents: bubble({
      hero: hero(input.isExam ? 'new-quiz' : 'new-assignment', { type: 'uri', label: 'เปิด', uri: input.openUrl }),
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', paddingTop: '0px', contents: footer },
    }),
  };
}

// ---------------------------------------------------------------------------
// Group menu + "for teachers" connect card (the bot's first reply in a group)
// ---------------------------------------------------------------------------

/** The teacher LIFF page each menu button opens (/liff/teacher?view=…). */
export type TeacherView =
  | 'home'
  | 'attendance'
  | 'invite'
  | 'classroom'
  | 'status'
  | 'create'
  | 'publish'
  | 'grade'
  | 'results'
  | 'remind'
  | 'help'
  | 'guide';

/** The teacher LIFF page for this group; opened from the group, so it can post cards back into it. */
export function liffTeacherUrl(ref: string, view: TeacherView) {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  const query = `?g=${encodeURIComponent(ref)}&view=${view}`;
  return liffId ? `https://liff.line.me/${liffId}/teacher${query}` : webUrl(`/liff/teacher${query}`);
}

/**
 * The teacher's menu for the group. Every button opens the teacher LIFF page
 * (teachers and TAs of the linked classroom only; a student who taps one sees
 * "teachers only"). What a page posts back into the group (a work card, a
 * check-in, a reminder) goes in as a card trigger the bot answers for free.
 */
export function menuCard(ref: string): FlexMessage {
  const open = (view: TeacherView) => ({ type: 'uri' as const, uri: liffTeacherUrl(ref, view) });
  const primary = (label: string, view: TeacherView) => tile(label, open(view), { bg: COLORS.purple, color: '#FFFFFF' });
  const light = (label: string, view: TeacherView) => tile(label, open(view));
  return {
    type: 'flex',
    altText: 'เมนูครูประจำไลน์กลุ่ม: เช็กชื่อ เชิญนักเรียน จัดการห้องเรียน งาน และคำสั่งอื่น ๆ',
    contents: bubble({
      hero: hero('menu', { ...open('home'), label: 'เมนูครู' }),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          row(primary('📋 เช็กชื่อ', 'attendance'), primary('👥 เชิญนักเรียน', 'invite')),
          primary('🏫 จัดการห้องเรียน', 'classroom'),
          primary('📊 เช็กสถานะ', 'status'),
          sectionLabel('⭐ งาน'),
          row(light('✏️ สร้าง', 'create'), light('📢 เผยแพร่', 'publish')),
          row(light('✅ ตรวจงาน', 'grade'), light('📈 ประกาศผล', 'results')),
          light('🔔 ทวงงาน', 'remind'),
          sectionLabel('⭐ อื่น ๆ'),
          light('📖 คำสั่งพิเศษ', 'help'),
          light('📣 แนะนำนักเรียน / วิธีส่งงาน', 'guide'),
          text('💡 กดค้างที่การ์ดนี้ แล้วเลือก “ประกาศ” เพื่อปักหมุดเมนูไว้บนสุดของกลุ่ม', { size: 'xxs', color: COLORS.muted, margin: 'lg', align: 'center' }),
        ],
      },
    }),
  };
}

/** "สำหรับครู": opens the LIFF connect page for this group (teachers only). */
export function firstConnCard(connectUrl: string): FlexMessage {
  return {
    type: 'flex',
    altText: `สำหรับคุณครู: เปิดใช้งาน Pudding สำหรับห้องเรียนนี้ ${connectUrl}`,
    contents: bubble({
      hero: hero('first-conn', { type: 'uri', label: 'เปิดใช้งาน', uri: connectUrl }),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'xs',
        contents: [
          text('เฉพาะคุณครูเท่านั้น', { size: 'lg', weight: 'bold', color: COLORS.rose, align: 'center' }),
          text('For teachers only', { size: 'sm', color: COLORS.rose, align: 'center' }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        paddingTop: '0px',
        contents: [button('⚙️ เปิดใช้งานสำหรับห้องเรียนนี้', { type: 'uri', uri: connectUrl }, COLORS.green)],
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// New student
// ---------------------------------------------------------------------------

export function welcomeCard(input: {
  /** The new member's LINE name, when one person joined. */
  name?: string | null;
  classroomTitle: string;
  subject?: string | null;
  openWork: number;
  /** Join form (invite code) / the classroom in the student LIFF app. */
  url: string;
}): FlexMessage {
  const greeting = `ยินดีต้อนรับ${input.name ? `คุณ${input.name}` : 'เพื่อนใหม่'}\nสู่ห้องเรียน ${input.classroomTitle}! 🎉`;
  const contents: unknown[] = [
    text(greeting, { size: 'md', weight: 'bold', color: COLORS.purpleDark }),
    text(
      `ห้องนี้ใช้ Pudding ${input.subject ? `ในวิชา ${input.subject} ` : ''}สำหรับเช็กชื่อ ส่งงาน และทำแบบทดสอบผ่าน LINE`,
      { size: 'sm', color: COLORS.muted, margin: 'md' }
    ),
    text('กดปุ่มด้านล่าง กรอกชื่อเพื่อขอเข้าห้องเรียน แล้วรอคุณครูอนุมัติ จากนั้นดูงานและส่งงานได้จากการ์ดในกลุ่มนี้ หรือจากปุ่มด้านล่างได้เลย', {
      size: 'sm',
      color: COLORS.muted,
      margin: 'md',
    }),
  ];
  if (input.openWork > 0) {
    contents.push(text(`✨ มี ${input.openWork} งานรอคุณอยู่ ✨`, { size: 'md', weight: 'bold', color: COLORS.purpleDark, align: 'center', margin: 'lg' }));
  }
  return {
    type: 'flex',
    altText: fit(`${greeting.replace('\n', ' ')} กดเพื่อเข้าห้องเรียน: ${input.url}`, 400),
    contents: bubble({
      hero: hero('new-student'),
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        paddingTop: '0px',
        contents: [button('🏆 ดูงานของคุณ', { type: 'uri', uri: input.url }, COLORS.amber)],
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Removed / reconnected notices (text-only cards)
// ---------------------------------------------------------------------------

function noticeCard(title: string, color: string, lines: string[], altText: string, action?: { label: string; uri: string; color?: string }): FlexMessage {
  return {
    type: 'flex',
    altText: fit(altText, 400),
    contents: bubble(
      {
        body: {
          type: 'box',
          layout: 'vertical',
          paddingAll: '20px',
          spacing: 'sm',
          contents: [
            text(title, { size: 'lg', weight: 'bold', color }),
            ...lines.map((line, index) => text(line, { size: 'sm', color: COLORS.muted, margin: index ? 'md' : 'sm' })),
          ],
        },
        ...(action
          ? {
              footer: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '16px',
                paddingTop: '0px',
                contents: [button(action.label, { type: 'uri', uri: action.uri }, action.color || color)],
              },
            }
          : {}),
      },
      'kilo'
    ),
  };
}

/** Sent to the classroom's teachers (1:1 chat) when the bot is removed from the group. */
export function removedCard(classroomTitle: string, groupName?: string | null): FlexMessage {
  const lines = [
    `ห้องเรียน “${classroomTitle}” ถูกตัดการเชื่อมต่อ เนื่องจากบอทถูกนำออกจากกลุ่ม LINE${groupName ? ` “${groupName}”` : ''}`,
    'หากไม่ได้ตั้งใจ เพิ่มบอทกลับเข้ากลุ่มเดิมอีกครั้ง ระบบจะเชื่อมต่อห้องเรียนให้อัตโนมัติ',
  ];
  return noticeCard('บอทถูกนำออกจากกลุ่ม', COLORS.red, lines, `บอทถูกนำออกจากกลุ่ม: ${lines.join(' ')}`);
}

/** Reply in the group when the bot is added back and the classroom links again by itself. */
export function reconnectedCard(classroomTitle: string): FlexMessage {
  const line = `ห้องเรียน “${classroomTitle}” กลับมาเชื่อมต่อแล้ว ใช้งานได้ตามปกติค่ะ`;
  return noticeCard('เชื่อมต่อกลับแล้ว!', COLORS.green, [line], `เชื่อมต่อกลับแล้ว: ${line}`);
}

// ---------------------------------------------------------------------------
// Cards without header art yet: a coloured title band instead
// (attendance, invite, remind, results). Swap in hero() once the art exists.
// ---------------------------------------------------------------------------

function band(title: string, subtitle: string, bg: string, color: string) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: bg,
    paddingAll: '18px',
    paddingBottom: '14px',
    contents: [
      text(title, { size: 'xl', weight: 'bold', color }),
      text(subtitle, { size: 'sm', color, margin: 'xs' }),
    ],
  };
}

function infoRows(rows: Array<{ label: string; value: string }>) {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'md',
    contents: rows.map((item) => ({
      type: 'box',
      layout: 'baseline',
      spacing: 'sm',
      contents: [
        text(`${item.label}:`, { size: 'sm', color: COLORS.muted, flex: 0, wrap: false }),
        text(item.value, { size: 'sm', weight: 'bold', color: COLORS.lavenderText }),
      ],
    })),
  };
}

const footerButton = (label: string, uri: string, color: string) => ({
  type: 'box',
  layout: 'vertical',
  paddingAll: '16px',
  paddingTop: '0px',
  contents: [button(label, { type: 'uri', uri }, color)],
});

/** "เช็กชื่อ": a check-in period is open. */
export function attendanceCard(input: { classroomTitle: string; sessionTitle: string; onTimeUntil: string; lateUntil: string; url: string }): FlexMessage {
  return {
    type: 'flex',
    altText: fit(`⏰ เช็กชื่อ ${input.sessionTitle} (${input.classroomTitle}) ตรงเวลาถึง ${input.onTimeUntil} น.`, 400),
    contents: bubble({
      header: band('⏰ เช็กชื่อกัน!', input.classroomTitle, COLORS.lavender, COLORS.purpleDark),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          text(input.sessionTitle, { size: 'lg', weight: 'bold', color: COLORS.purpleDark }),
          infoRows([
            { label: 'ตรงเวลาถึง', value: `${input.onTimeUntil} น.` },
            { label: 'เช็กชื่อได้ (สาย) ถึง', value: `${input.lateUntil} น.` },
          ]),
          text('📷 สแกน QR บนหน้าจอของคุณครูเพื่อเช็กชื่อ (เช็กชื่อแทนเพื่อนไม่ได้)', { size: 'xs', color: COLORS.muted, margin: 'lg' }),
        ],
      },
      footer: footerButton('📷 สแกน QR เช็กชื่อ', input.url, COLORS.green),
    }),
  };
}

/** "เข้าร่วมห้องเรียน": the classroom's join code and button (invite, "พุดดิ้ง เข้าห้อง"). */
export function inviteCard(input: { classroomTitle: string; inviteCode?: string | null; url: string }): FlexMessage {
  const body: unknown[] = [
    text(input.classroomTitle, { size: 'lg', weight: 'bold', color: COLORS.purpleDark, align: 'center' }),
    text('เข้าร่วมกลุ่มห้องเรียนของเรา เพื่อไม่พลาดทุกกิจกรรมและประกาศสำคัญ!', { size: 'sm', color: COLORS.muted, align: 'center', margin: 'sm' }),
  ];
  if (input.inviteCode) {
    body.push({
      type: 'box',
      layout: 'vertical',
      margin: 'lg',
      backgroundColor: COLORS.lavender,
      cornerRadius: 'md',
      paddingAll: '10px',
      contents: [
        text('รหัสเข้าห้อง', { size: 'xs', color: COLORS.muted, align: 'center' }),
        text(input.inviteCode, { size: 'xxl', weight: 'bold', color: COLORS.purple, align: 'center' }),
      ],
    });
  }
  body.push(text('กดปุ่ม กรอกชื่อ แล้วรอคุณครูอนุมัติ', { size: 'xs', color: COLORS.muted, align: 'center', margin: 'md' }));
  return {
    type: 'flex',
    altText: fit(`👥 เข้าร่วมห้องเรียน ${input.classroomTitle}${input.inviteCode ? ` รหัส ${input.inviteCode}` : ''}`, 400),
    contents: bubble({
      hero: hero('join-class', { type: 'uri', label: 'เข้าร่วม', uri: input.url }),
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: body },
      footer: footerButton('👥 เข้าร่วมห้องเรียน', input.url, COLORS.purple),
    }),
  };
}

/**
 * "เปิดห้องเรียน": the group is now the classroom's (posted when a teacher
 * links it), and "พุดดิ้ง หน้าหลัก". The button opens the classroom in the
 * student LIFF app (classmates who have not joined can ask to join there).
 */
export function openClassCard(input: { classroomTitle: string; subject?: string | null; teacherName?: string | null; url: string; note?: string }): FlexMessage {
  const byline = [input.subject, input.teacherName ? `ครู${input.teacherName}` : ''].filter(Boolean).join(' · ');
  return {
    type: 'flex',
    altText: fit(`🏫 เปิดห้องเรียน ${input.classroomTitle}: ${input.url}`, 400),
    contents: bubble({
      hero: hero('open-class', { type: 'uri', label: 'เข้าสู่ห้องเรียน', uri: input.url }),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        contents: [
          text(input.classroomTitle, { size: 'lg', weight: 'bold', color: COLORS.purpleDark, align: 'center' }),
          ...(byline ? [text(byline, { size: 'sm', color: COLORS.muted, align: 'center', margin: 'xs' })] : []),
          text(input.note || 'ห้องเรียนนี้ใช้ Pudding แล้ว 🎉 กดปุ่มด้านล่างเพื่อเข้าห้องเรียน ดูงาน และเช็กชื่อ', {
            size: 'sm',
            color: COLORS.muted,
            align: 'center',
            margin: 'md',
          }),
        ],
      },
      footer: footerButton('🏠 เข้าสู่ห้องเรียน', input.url, COLORS.purple),
    }),
  };
}

/** Small rounded label above a card's title ("#งานที่ 1  คณิต"). */
function badge(label: string, align: 'start' | 'center' = 'start') {
  return {
    type: 'box',
    layout: 'horizontal',
    justifyContent: align === 'center' ? 'center' : 'flex-start',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        backgroundColor: COLORS.lavender,
        cornerRadius: 'xxl',
        paddingStart: '12px',
        paddingEnd: '12px',
        paddingTop: '4px',
        paddingBottom: '4px',
        contents: [text(label, { size: 'xs', weight: 'bold', color: COLORS.lavenderText, wrap: false })],
      },
    ],
  };
}

/** The underlined "ดูสถานะการส่งงาน" link under a card's button. */
function statusLink(uri: string, color = COLORS.amber) {
  return {
    type: 'box',
    layout: 'vertical',
    paddingTop: '6px',
    action: { type: 'uri', label: 'ดูสถานะการส่งงาน', uri },
    contents: [text('ดูสถานะการส่งงาน', { size: 'sm', color, align: 'center', decoration: 'underline', weight: 'bold' })],
  };
}

const workTag = (isExam: boolean, number?: number) => `#${isExam ? 'ข้อสอบ' : 'งาน'}${number ? `ที่ ${number}` : ''}`;

/**
 * "ทวงงาน" ("ส่งให้ครูหน่อยน้า~"): the bot's answer to the teacher's
 * reminder picture: the work, its deadline, and who has not handed it in.
 * The @mentions follow in a separate text message (see the webhook).
 */
export function remindCard(input: {
  isExam: boolean;
  number?: number;
  subject?: string;
  title: string;
  due: string;
  /** Homework: "ปิดรับส่งงาน" (late work accepted until then). */
  closes?: string;
  /** "[123] ชื่อ" of each student who has not handed in (last 3 digits of the student number). */
  names: string[];
  total: number;
  url: string;
  statusUrl?: string | null;
}): FlexMessage {
  const MAX_NAMES = 25;
  const shown = input.names.slice(0, MAX_NAMES).join('\n') + (input.names.length > MAX_NAMES ? `\n…และอีก ${input.names.length - MAX_NAMES} คน` : '');
  const footer: unknown[] = [button(input.isExam ? '📝 ทำข้อสอบ' : '📤 ส่งงาน', { type: 'uri', uri: input.url })];
  if (input.statusUrl) footer.push(statusLink(input.statusUrl));
  return {
    type: 'flex',
    altText: fit(`🔔 ส่งให้ครูหน่อยน้า~ ${input.title}: ยังไม่ส่ง ${input.names.length} จาก ${input.total} คน`, 400),
    contents: bubble({
      hero: hero('remind', { type: 'uri', label: 'ส่งงาน', uri: input.url }),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          badge([workTag(input.isExam, input.number), input.subject].filter(Boolean).join('  ')),
          text(input.title, { size: 'xl', weight: 'bold', color: COLORS.purpleDark, margin: 'md' }),
          ...[
            { label: input.isExam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง', value: input.due },
            ...(input.closes ? [{ label: 'ปิดรับส่งงาน', value: input.closes }] : []),
          ].map((row) => ({
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'sm',
            contents: [
              text(row.label, { size: 'sm', color: COLORS.muted, flex: 0, wrap: false }),
              text(row.value, { size: 'sm', weight: 'bold', color: '#E8780C' }),
            ],
          })),
          { type: 'separator', margin: 'lg', color: '#E4D9FB' },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            margin: 'lg',
            contents: [
              text('ยังไม่ส่ง:', { size: 'sm', weight: 'bold', color: COLORS.purpleDark, flex: 0, wrap: false }),
              text(`${input.names.length} จาก ${input.total} คน`, { size: 'sm', weight: 'bold', color: '#E8780C' }),
            ],
          },
          text(shown || '-', { size: 'sm', color: COLORS.purpleDark, margin: 'sm' }),
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', paddingTop: '0px', contents: footer },
    }),
  };
}

/** "ประกาศผลแล้วน้า~": the work is graded; each student opens their own result. */
export function resultsCard(input: {
  isExam: boolean;
  number?: number;
  byline?: string;
  title: string;
  url: string;
  statusUrl?: string | null;
}): FlexMessage {
  const footer: unknown[] = [button('🏆 ดูผลลัพธ์ของฉัน', { type: 'uri', uri: input.url }, '#5B5BD6')];
  if (input.statusUrl) footer.push(statusLink(input.statusUrl, COLORS.purple));
  return {
    type: 'flex',
    altText: fit(`📣 ประกาศผลแล้วน้า~ ${input.title}: ตรวจเรียบร้อยแล้ว กดดูผลของตัวเองได้เลย`, 400),
    contents: bubble({
      hero: hero('score-announce', { type: 'uri', label: 'ดูผลลัพธ์', uri: input.url }),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          badge([workTag(input.isExam, input.number), input.byline].filter(Boolean).join('  '), 'center'),
          text(input.title, { size: 'xxl', weight: 'bold', color: COLORS.purpleDark, align: 'center', margin: 'md' }),
          text('✅ ตรวจเรียบร้อยแล้ว', { size: 'lg', weight: 'bold', color: COLORS.purpleDark, align: 'center', margin: 'md' }),
          text(`สำหรับทุกคนที่ส่ง${input.isExam ? 'ข้อสอบ' : 'งาน'} 💗`, { size: 'sm', weight: 'bold', color: COLORS.purpleDark, align: 'center' }),
          { type: 'separator', margin: 'lg', color: '#E4D9FB' },
          text('กดปุ่มด้านล่าง มาดูผลของตัวเองกันเลย!', { size: 'sm', color: COLORS.rose, align: 'center', margin: 'lg', weight: 'bold' }),
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', paddingTop: '0px', contents: footer },
    }),
  };
}
