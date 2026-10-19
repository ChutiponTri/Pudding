/** Choices shown to students for true/false questions. */
export const TRUE_FALSE_OPTIONS = ['ถูก', 'ผิด'] as const;

const TRUE_WORDS = new Set(['ถูก', 'จริง', 'ใช่', 'true', 't', 'yes', 'y', '1', '✓', 'o']);
const FALSE_WORDS = new Set(['ผิด', 'เท็จ', 'ไม่ใช่', 'ไม่จริง', 'false', 'f', 'no', 'n', '0', '✗', 'x']);

/**
 * Maps a true/false answer to a boolean, accepting Thai/English synonyms so
 * ideal answers typed as free text before the dedicated picker existed still
 * grade correctly. Returns null when the text is not a recognisable answer.
 */
export function parseTrueFalse(text: string | null | undefined): boolean | null {
  const value = (text || '').trim().toLowerCase();
  if (!value) return null;
  if (TRUE_WORDS.has(value)) return true;
  if (FALSE_WORDS.has(value)) return false;
  return null;
}
