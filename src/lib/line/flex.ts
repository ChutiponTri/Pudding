import 'server-only';
import { webUrl } from '@/lib/line/groupLink';

/**
 * LINE Flex cards the bot sends: the work card (new homework / new quiz), the
 * group menu, the "for teachers" connect card, the new-student welcome, and the
 * removed / reconnected notices. Header art lives in public/cards/line (built
 * from the mockups in public/cards by scripts/build-line-cards.mjs); the text
 * and buttons are real Flex parts so they can be tapped and filled in.
 *
 * Light purple is the theme; connect is green, disconnect red.
 */

/** Bump after rebuilding the images: LINE caches them by URL. */
const CARD_IMAGE_VERSION = '1';

export const COLORS = {
  purple: '#7C3AED',
  purpleDark: '#3B1D6E',
  lavender: '#EFE7FF',
  lavenderText: '#5B21B6',
  muted: '#6E6487',
  amber: '#E0A100',
  green: '#22B35E',
  red: '#E5484D',
  rose: '#E53E62',
  line: '#E9E1FA',
};

export type FlexMessage = { type: 'flex'; altText: string; contents: Record<string, unknown> };
type FlexAction =
  | { type: 'uri'; label: string; uri: string }
  | { type: 'postback'; label: string; data: string; displayText?: string }
  | { type: 'message'; label: string; text: string };
/** An action before its label is added (Omit on each member of the union). */
type BareAction = FlexAction extends infer A ? (A extends FlexAction ? Omit<A, 'label'> : never) : never;

const fit = (value: string, max: number) => ([...value].length > max ? `${[...value].slice(0, max - 1).join('')}…` : value);

/** Header art: the image file's own aspect ratio, so nothing is cropped. */
const HEROES = {
  'new-assignment': '1040:424',
  'new-quiz': '1040:371',
  'new-student': '1040:338',
  'first-conn': '1040:572',
  menu: '1040:317',
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

const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text: value || ' ', wrap: true, ...extra });

/** Solid button (LINE draws the label in white). */
function button(label: string, action: BareAction, color = COLORS.purple) {
  return { type: 'button', style: 'primary', color, height: 'md', action: { ...action, label: fit(label, 40) } };
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

function bubble(contents: Record<string, unknown>, size: 'kilo' | 'mega' = 'mega') {
  return { type: 'bubble', size, styles: { body: { backgroundColor: '#FFFFFF' } }, ...contents };
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
    footer.push({
      type: 'box',
      layout: 'vertical',
      paddingTop: '6px',
      action: { type: 'uri', label: 'ดูสถานะการส่งงาน', uri: input.statusUrl },
      contents: [text('ดูสถานะการส่งงาน', { size: 'sm', color: COLORS.amber, align: 'center', decoration: 'underline', weight: 'bold' })],
    });
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

/** Postback data of the menu's in-group buttons (see the webhook). */
export const MENU_POSTBACK = 'pudding-menu';
export type MenuAction = 'attendance' | 'invite' | 'status' | 'publish' | 'remind' | 'help' | 'guide';
export const menuPostback = (action: MenuAction) => ({ type: 'postback' as const, data: `${MENU_POSTBACK}=${action}` });

/** Teacher pages (web) the menu opens; /api/line/menu finds the group's classroom. */
export type MenuPage = 'classroom' | 'create' | 'grade' | 'results';
export const menuPageUrl = (ref: string, to: MenuPage) =>
  webUrl(`/api/line/menu?g=${encodeURIComponent(ref)}&to=${to}&openExternalBrowser=1`);

/**
 * The teacher's menu for the group. In-group buttons are postbacks without
 * display text: tapping posts nothing, and only the classroom's teachers and
 * TAs get the bot's (free) reply. Page buttons open the teacher website.
 */
export function menuCard(ref: string): FlexMessage {
  const primary = (label: string, action: BareAction) => tile(label, action, { bg: COLORS.purple, color: '#FFFFFF' });
  return {
    type: 'flex',
    altText: 'เมนูครูประจำไลน์กลุ่ม: เช็กชื่อ เชิญนักเรียน จัดการห้องเรียน งาน และคำสั่งอื่น ๆ',
    contents: bubble({
      hero: hero('menu'),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '16px',
        contents: [
          row(primary('📋 เช็กชื่อ', menuPostback('attendance')), primary('👥 เชิญนักเรียน', menuPostback('invite'))),
          primary('🏫 จัดการห้องเรียน', { type: 'uri', uri: menuPageUrl(ref, 'classroom') }),
          primary('📊 เช็กสถานะ', menuPostback('status')),
          sectionLabel('⭐ งาน'),
          row(tile('✏️ สร้าง', { type: 'uri', uri: menuPageUrl(ref, 'create') }), tile('📢 เผยแพร่', menuPostback('publish'))),
          row(tile('✅ ตรวจงาน', { type: 'uri', uri: menuPageUrl(ref, 'grade') }), tile('📈 ประกาศผล', { type: 'uri', uri: menuPageUrl(ref, 'results') })),
          tile('🔔 ทวงงาน', menuPostback('remind')),
          sectionLabel('⭐ อื่น ๆ'),
          tile('📖 คำสั่งพิเศษ', menuPostback('help')),
          tile('📣 แนะนำนักเรียน / วิธีส่งงาน', menuPostback('guide')),
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
