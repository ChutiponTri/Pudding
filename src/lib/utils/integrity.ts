/**
 * When a quiz submission is flagged for leaving the screen. Quizzes allow no
 * photos or file uploads, so there is no legitimate reason to leave: a quick
 * trip to an AI chat app takes only seconds, and even that must stand out.
 * Homework is not tracked at all.
 */
export const SUSPICIOUS_AWAY_SECONDS = 10;
export const SUSPICIOUS_TAB_SWITCHES = 2;

export function isSuspiciousActivity(tabSwitchCount: number, awaySeconds: number): boolean {
  return tabSwitchCount >= SUSPICIOUS_TAB_SWITCHES || awaySeconds >= SUSPICIOUS_AWAY_SECONDS;
}
