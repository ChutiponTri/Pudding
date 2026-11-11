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
const CARD_IMAGE_VERSION = '4';

export { COLORS, type FlexMessage } from '@/lib/line/flexKit';

/** Header art: the image file's own aspect ratio, so nothing is cropped. */
const HEROES = {
  'new-assignment': '1040:433',
  'new-quiz': '1040:352',
  'new-activity': '1040:365',
  'new-student': '1040:309',
  'first-conn': '1040:572',
  menu: '1040:265',
  'open-class': '1040:810',
  'join-class': '1040:667',
  remind: '1040:400',
  'score-announce': '1040:364',
  'open-for-submission': '1040:410',
  'submit-work': '1040:390',
  summary: '1040:431',
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
  survey?: boolean;
};

export function workCard(input: WorkCardInput): FlexMessage {
  const kind = input.retake ? 'สอบซ่อม' : input.isExam ? 'ข้อสอบ' : input.survey ? 'กิจกรรม' : 'งาน';
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

  const action = input.isExam ? '📝 ทำแบบทดสอบ' : input.survey ? '📋 ดูรายละเอียดกิจกรรม' : '📤 ส่งงาน';
  const footer: unknown[] = [button(action, { type: 'uri', uri: input.openUrl })];
  if (input.statusUrl) {
    footer.push(statusLink(input.statusUrl));
  }

  const due = input.rows.map((item) => `${item.label}: ${item.value}`).join('\n');
  return {
    type: 'flex',
    altText: fit(`${input.isExam ? '📝 ข้อสอบใหม่' : input.survey ? '📣 กิจกรรมใหม่' : '📋 งานใหม่'}: ${input.title}${due ? `\n${due}` : ''}`, 400),
    contents: bubble({
      hero: hero(input.isExam ? 'new-quiz' : input.survey ? 'new-activity' : 'new-assignment', { type: 'uri', label: 'เปิด', uri: input.openUrl }),
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

/**
 * The teacher LIFF page for this group; opened from the group, so it can post
 * cards back into it. With its own LIFF app (LINE_TEACHER_LIFF_ID, endpoint
 * …/liff/teacher) the link opens that page directly. Without one it goes
 * through the student app (liff.line.me/<id>/teacher → /liff → /liff/teacher),
 * and LINE can lose the "opened from this group" context on that extra page
 * load, so liff.sendMessages is not offered and the teacher has to pick the
 * group by hand.
 */
export function liffTeacherUrl(ref: string, view: TeacherView) {
  const teacherLiffId = process.env.LINE_TEACHER_LIFF_ID || process.env.NEXT_PUBLIC_LINE_TEACHER_LIFF_ID;
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  const query = `?g=${encodeURIComponent(ref)}&view=${view}`;
  if (teacherLiffId) return `https://liff.line.me/${teacherLiffId}${query}`;
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
export type WorkStatusInput = {
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
};

/**
 * One work with who has not handed it in: the reminder card ("ส่งให้ครู
 * หน่อยน้า~", answer to the teacher's ทวงงาน picture) and each page of the
 * "ส่งงาน" carousel ("พุดดิ้ง ส่งงาน") share this layout, with their own art.
 */
/**
 * Who has not handed in, sized for a phone: one name per line for a short
 * list; past 8 names, two columns (half the height), up to `maxNames`, then
 * "…และอีก N คน" (`moreNote` says where the rest are).
 */
function nameList(names: string[], maxNames: number, moreNote = ''): unknown[] {
  if (!names.length) return [];
  const shown = names.slice(0, maxNames);
  const more = names.length - shown.length;
  const tail = more > 0 ? [text(`…และอีก ${more} คน${moreNote ? ` ${moreNote}` : ''}`, { size: 'xs', color: COLORS.muted, margin: 'sm' })] : [];
  if (shown.length <= 8) return [text(shown.join('\n'), { size: 'sm', color: COLORS.purpleDark, margin: 'sm' }), ...tail];
  const rows: unknown[] = [];
  for (let i = 0; i < shown.length; i += 2) {
    rows.push({
      type: 'box',
      layout: 'horizontal',
      spacing: 'md',
      margin: i ? 'xs' : 'sm',
      contents: [
        text(shown[i], { size: 'xs', color: COLORS.purpleDark, flex: 1, wrap: false }),
        // An empty cell keeps the last odd name in the left column.
        text(shown[i + 1] || ' ', { size: 'xs', color: COLORS.purpleDark, flex: 1, wrap: false }),
      ],
    });
  }
  return [...rows, ...tail];
}

function workStatusBubble(art: 'remind' | 'submit-work', input: WorkStatusInput, maxNames: number, moreNote = '') {
  const footer: unknown[] = [button(input.isExam ? '📝 ทำข้อสอบ' : '📤 ส่งงาน', { type: 'uri', uri: input.url })];
  if (input.statusUrl) footer.push(statusLink(input.statusUrl));
  return bubble({
    hero: hero(art, { type: 'uri', label: 'ส่งงาน', uri: input.url }),
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
            text(input.names.length ? `${input.names.length} จาก ${input.total} คน` : 'ส่งครบแล้ว 🎉', { size: 'sm', weight: 'bold', color: '#E8780C' }),
          ],
        },
        ...nameList(input.names, maxNames, moreNote),
      ],
    },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', paddingTop: '0px', contents: footer },
  });
}

/** "ทวงงาน": the bot's answer to the teacher's reminder picture (the @mentions follow in a text message). */
export function remindCard(input: WorkStatusInput): FlexMessage {
  return {
    type: 'flex',
    altText: fit(`🔔 ส่งให้ครูหน่อยน้า~ ${input.title}: ยังไม่ส่ง ${input.names.length} จาก ${input.total} คน`, 400),
    // The @mention messages after the card list everyone, so the card keeps to 20 names.
    contents: workStatusBubble('remind', input, 20, '(รายชื่อครบในข้อความถัดไป)'),
  };
}

/** "พุดดิ้ง ส่งงาน": one page per open work (most urgent first), each with its ส่งงาน button. */
export function submitCarousel(works: WorkStatusInput[]): FlexMessage {
  const pages = works.slice(0, 10);
  return {
    type: 'flex',
    altText: fit(`📤 ส่งงาน: ${pages.map((work) => work.title).join(', ')}`, 400),
    contents: pages.length === 1
      ? workStatusBubble('submit-work', pages[0], 20)
      : { type: 'carousel', contents: pages.map((work) => workStatusBubble('submit-work', work, 12)) },
  };
}

export type OpenWorkRow = {
  isExam: boolean;
  title: string;
  /** "เหลือ 2 วัน" / "เลยกำหนดแล้ว (ส่งช้าได้)". */
  left: string;
  /** "กำหนดส่ง 15 พ.ย. 2569" / "ปิดรับคำตอบ …". */
  due: string;
  /** 🔴 under a day, 🟡 under three days, 🟢 later. */
  urgency: string;
  url: string;
};

/**
 * "พุดดิ้ง งาน" ("งานที่เปิดรับ"): every work still taking hand-ins, quizzes
 * then homework, most urgent first; each row opens that work.
 */
export function openWorkCard(input: { classroomTitle: string; rows: OpenWorkRow[]; total: number; url: string }): FlexMessage {
  const MAX_ROWS = 8;
  const row = (item: OpenWorkRow) => ({
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    paddingAll: '10px',
    backgroundColor: '#FAF7FF',
    cornerRadius: 'md',
    action: { type: 'uri', label: 'เปิดงาน', uri: item.url },
    contents: [
      {
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          text(item.urgency, { size: 'sm', flex: 0, wrap: false }),
          text(item.title, { size: 'sm', weight: 'bold', color: COLORS.purpleDark }),
        ],
      },
      text(`${item.left} • ${item.due}`, { size: 'xs', color: '#E8780C', margin: 'xs' }),
    ],
  });
  const section = (label: string, items: OpenWorkRow[]) =>
    items.length ? [text(`${label} (${items.length})`, { size: 'sm', weight: 'bold', color: COLORS.lavenderText, margin: 'lg' }), ...items.map(row)] : [];
  const shown = input.rows.slice(0, MAX_ROWS);
  const exams = shown.filter((item) => item.isExam);
  const homework = shown.filter((item) => !item.isExam);
  return {
    type: 'flex',
    altText: fit(`📚 งานที่เปิดรับ ${input.classroomTitle}: ${input.rows.map((item) => item.title).join(', ')}`, 400),
    contents: bubble({
      hero: hero('open-for-submission', { type: 'uri', label: 'ดูงานทั้งหมด', uri: input.url }),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        contents: [
          badge(input.classroomTitle),
          text(`ทั้งหมด ${input.total} รายการ`, { size: 'md', weight: 'bold', color: COLORS.purpleDark, margin: 'md' }),
          ...section('📝 ข้อสอบ', exams),
          ...section('📋 การบ้าน', homework),
          ...(input.total > shown.length ? [text(`…และอีก ${input.total - shown.length} รายการ ดูได้ในแอป`, { size: 'xs', color: COLORS.muted, margin: 'md' })] : []),
          text('🔴 ไม่ถึง 1 วัน  🟡 ไม่ถึง 3 วัน  🟢 มากกว่านั้น • แตะงานเพื่อเปิด', { size: 'xxs', color: COLORS.muted, margin: 'lg' }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        paddingTop: '0px',
        contents: [button('📚 ดูงานทั้งหมด', { type: 'uri', uri: input.url })],
      },
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

// ---------------------------------------------------------------------------
// Daily summary (pushed to the teacher's 1:1 chat with the bot, see dailySummary.ts)
// ---------------------------------------------------------------------------

/** Cut from the summary mockup by scripts/build-line-cards.mjs. */
const cardAsset = (file: string) => webUrl(`/cards/line/${file}?v=${CARD_IMAGE_VERSION}`);

export type SummaryRow = {
  /** The row's icon: the mockup's calendar, or an emoji on a white tile. */
  icon: { image: 'calendar' } | { emoji: string };
  /** "งานที่ส่งวันนี้: 2 ชิ้น". */
  title: string;
  /** Second line in orange ("รอตรวจ: 1 ชิ้น"). */
  detail?: string;
  url: string;
  /** Button label; default "ดูรายการ". */
  label?: string;
};

const SUMMARY = {
  rowBg: '#F6EAFE',
  rowText: '#5A1580',
  heading: '#520772',
  button: '#A961D0',
  orange: '#E8780C',
  underline: '#FDE68A',
};

function summaryIcon(icon: SummaryRow['icon']) {
  if ('image' in icon) {
    return { type: 'image', url: cardAsset(`icon-${icon.image}.png`), size: '40px', aspectRatio: '1:1', aspectMode: 'fit', flex: 0 };
  }
  return {
    type: 'box',
    layout: 'vertical',
    flex: 0,
    width: '40px',
    height: '40px',
    cornerRadius: '12px',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    contents: [text(icon.emoji, { size: 'lg', align: 'center', wrap: false })],
  };
}

function summaryRow(row: SummaryRow) {
  const label = row.label || 'ดูรายการ';
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    margin: 'md',
    paddingAll: '12px',
    paddingStart: '14px',
    backgroundColor: SUMMARY.rowBg,
    cornerRadius: '16px',
    alignItems: 'center',
    action: { type: 'uri', label: fit(label, 40), uri: row.url },
    contents: [
      summaryIcon(row.icon),
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          text(row.title, { size: 'sm', weight: 'bold', color: SUMMARY.rowText }),
          ...(row.detail ? [text(row.detail, { size: 'xs', weight: 'bold', color: SUMMARY.orange, margin: 'xs' })] : []),
        ],
      },
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        backgroundColor: SUMMARY.button,
        cornerRadius: 'xxl',
        paddingTop: '8px',
        paddingBottom: '8px',
        paddingStart: '12px',
        paddingEnd: '12px',
        contents: [text(`${label} ›`, { size: 'xs', weight: 'bold', color: '#FFFFFF', wrap: false })],
      },
    ],
  };
}

/** A heading with the mockup's star and yellow underline ("ภารกิจ"). */
function summaryHeading(label: string, first: boolean) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    alignItems: 'center',
    margin: first ? 'none' : 'xl',
    contents: [
      { type: 'image', url: cardAsset('icon-star.png'), size: '26px', aspectRatio: '1:1', aspectMode: 'fit', flex: 0 },
      {
        type: 'box',
        layout: 'vertical',
        flex: 0,
        contents: [
          text(label, { size: 'lg', weight: 'bold', color: SUMMARY.heading, wrap: false }),
          { type: 'box', layout: 'vertical', height: '5px', cornerRadius: '3px', backgroundColor: SUMMARY.underline, contents: [] },
        ],
      },
    ],
  };
}

/**
 * "สรุปประจำวัน": the teacher's day at a glance, one row per thing that needs
 * them (hand-ins to grade, rooms to remind, students waiting to join). Only
 * rows with something in them are passed in, so the card grows and shrinks
 * with the day; a day with nothing is not sent at all.
 */
export function dailySummaryCard(input: { sections: Array<{ heading: string; rows: SummaryRow[] }>; url: string; altText: string }): FlexMessage {
  const sections = input.sections.filter((section) => section.rows.length);
  return {
    type: 'flex',
    altText: fit(input.altText, 400),
    contents: bubble({
      hero: hero('summary', { type: 'uri', label: 'เปิด Pudding', uri: input.url }),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '18px',
        paddingBottom: '4px',
        contents: sections.flatMap((section, index) => [summaryHeading(section.heading, index === 0), ...section.rows.map(summaryRow)]),
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '0px',
        contents: [{ type: 'image', url: cardAsset('summary-footer.jpg'), size: 'full', aspectRatio: '1040:144', aspectMode: 'cover' }],
      },
    }),
  };
}
