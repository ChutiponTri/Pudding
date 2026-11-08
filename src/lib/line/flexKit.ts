/**
 * Flex message building blocks shared by the bot's cards (flex.ts) and the
 * generic "text with buttons" card every other reply uses (messaging.ts).
 * No imports, so messaging.ts can use it without an import cycle.
 */

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
};

export type FlexMessage = { type: 'flex'; altText: string; contents: Record<string, unknown>; quickReply?: unknown };

export type FlexAction =
  | { type: 'uri'; label: string; uri: string }
  | { type: 'postback'; label: string; data: string; displayText?: string }
  | { type: 'message'; label: string; text: string };
/** An action before its label is added (Omit on each member of the union). */
export type BareAction = FlexAction extends infer A ? (A extends FlexAction ? Omit<A, 'label'> : never) : never;

export const fit = (value: string, max: number) => ([...value].length > max ? `${[...value].slice(0, max - 1).join('')}…` : value);

export const text = (value: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text: value || ' ', wrap: true, ...extra });

/** Solid button (LINE draws the label in white). */
export function button(label: string, action: BareAction, color = COLORS.purple) {
  return { type: 'button', style: 'primary', color, height: 'md', action: { ...action, label: fit(label, 40) } };
}

/** Light purple button with dark text (secondary choices). */
export function softButton(label: string, action: BareAction) {
  return { type: 'button', style: 'secondary', color: COLORS.lavender, height: 'sm', action: { ...action, label: fit(label, 40) } };
}

export function bubble(contents: Record<string, unknown>, size: 'kilo' | 'mega' = 'mega') {
  return { type: 'bubble', size, styles: { body: { backgroundColor: '#FFFFFF' } }, ...contents };
}

/** LINE's limits for one bubble: keep the text and the button list comfortably inside them. */
const MAX_CARD_TEXT = 1800;
const MAX_CARD_BUTTONS = 12;

/**
 * A bot reply as one card: the first line as its title, the rest as the
 * body, and a button per action under it (the first one solid, the rest
 * light). Used for every reply that has buttons, in groups and 1:1 chats.
 */
export function textCard(
  message: string,
  actions: Array<{ label: string; action: BareAction }>,
  options: { altText?: string; title?: string } = {}
): FlexMessage {
  const lines = message.trim().split('\n');
  const title = options.title ?? (lines.length > 1 ? lines.shift() || '' : '');
  const body = fit(lines.join('\n').trim(), MAX_CARD_TEXT);
  const contents: unknown[] = [];
  if (title) contents.push(text(title, { size: 'md', weight: 'bold', color: COLORS.purpleDark }));
  if (body) contents.push(text(body, { size: 'sm', color: '#3F3A4F', margin: title ? 'md' : 'none' }));
  const shown = actions.slice(0, MAX_CARD_BUTTONS);
  return {
    type: 'flex',
    altText: fit(options.altText || message || title || 'Pudding', 400),
    contents: bubble({
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: contents.length ? contents : [text(' ')] },
      ...(shown.length
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              paddingAll: '14px',
              paddingTop: '0px',
              contents: shown.map((item, index) => (index === 0 ? button(item.label, item.action) : softButton(item.label, item.action))),
            },
          }
        : {}),
    }),
  };
}
