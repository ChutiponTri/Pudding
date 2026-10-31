'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { Loader2, LogOut } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetFooter } from '@/components/ModalSheet';
import { InstitutionSearchSelect } from '@/components/InstitutionSearchSelect';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { canonicalInstitution } from '@/lib/data/thaiInstitutions';
import {
  TEACHER_NAME_PLACEHOLDER,
  TEACHER_PROFILE_UPDATED_EVENT,
  isTeacherProfileComplete,
  teacherAccessOf,
  type TeacherProfileFields as ProfileValues,
} from '@/lib/utils/teacherProfile';
import {
  TEACHER_ACCESS_RECHECK_EVENT,
  rememberApprovedHere,
  setTeacherAccessState,
  useTeacherAccess,
  wasApprovedHere,
} from '@/lib/hooks/useTeacherAccess';

/** The only page a teacher who is not approved yet may see. */
export const PENDING_APPROVAL_PATH = '/pending-approval';
const AUTH_PATH = /^\/(sign-in|sign-up)(\/|$)/;
import type { User } from '@/types/database';

const inputClass =
  'w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm sm:text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400';

/** First name, last name and institution inputs, shared by the sign-in gate and the profile editor. */
export function TeacherProfileFields({
  firstName,
  lastName,
  institution,
  onFirstName,
  onLastName,
  onInstitution,
}: {
  firstName: string;
  lastName: string;
  institution: string;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
  onInstitution: (value: string) => void;
}) {
  const { tr } = useLanguage();
  return (
    <>
      <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="teacher-first-name" className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {tr('ชื่อ', 'First name')} <span className="text-rose-500">*</span>
          </label>
          <input
            id="teacher-first-name"
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => onFirstName(e.target.value)}
            placeholder={tr('เช่น สมหญิง', 'e.g. Jane')}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="teacher-last-name" className="text-xs font-bold text-slate-700 dark:text-slate-300">
            {tr('นามสกุล', 'Last name')} <span className="text-rose-500">*</span>
          </label>
          <input
            id="teacher-last-name"
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => onLastName(e.target.value)}
            placeholder={tr('เช่น ใจดี', 'e.g. Smith')}
            className={inputClass}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
          {tr('สถานศึกษา / สถาบัน', 'Institution')} <span className="text-rose-500">*</span>
        </label>
        <InstitutionSearchSelect
          value={institution}
          onChange={onInstitution}
          placeholder={tr('ค้นหาชื่อสถานศึกษา...', 'Search school name...')}
          required
        />
      </div>
    </>
  );
}

/** Values to start the form with: never the "คุณครู" placeholder. */
export function profileFormValues(profile: ProfileValues | null | undefined, fallback?: { firstName?: string | null; lastName?: string | null } | null) {
  const first = profile?.first_name?.trim() || '';
  return {
    firstName: (first && first !== TEACHER_NAME_PLACEHOLDER ? first : '') || fallback?.firstName?.trim() || '',
    lastName: profile?.last_name?.trim() || fallback?.lastName?.trim() || '',
    institution: profile?.institution?.trim() || '',
  };
}

/** Lets other parts of the page (e.g. the dashboard header) pick up a saved profile. */
export function announceTeacherProfile(profile: User) {
  window.dispatchEvent(new CustomEvent(TEACHER_PROFILE_UPDATED_EVENT, { detail: profile }));
}

/**
 * Signed-in teachers must have a first name, last name and institution before
 * using any page. On sign-in this syncs the users row with Clerk; if anything
 * is missing it shows a popup above everything else that cannot be dismissed
 * (only signing out leaves it).
 *
 * Then the admin must approve the account: until then every page is covered
 * and the teacher is sent to /pending-approval (the server refuses their
 * requests anyway). A browser that last saw the teacher approved shows pages
 * at once while the check runs.
 */
export function TeacherProfileGate() {
  const { isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const pathname = usePathname();
  const router = useRouter();
  const { access, userId: checkedUserId } = useTeacherAccess();
  // Read after mount so server and first client render match.
  const [approvedHere, setApprovedHere] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApprovedHere(user?.id ? wasApprovedHere(user.id) : null);
  }, [user?.id]);
  const { tr, language } = useLanguage();
  const [required, setRequired] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [institution, setInstitution] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  });

  const requiredRef = useRef(required);
  useEffect(() => {
    requiredRef.current = required;
  });

  /*
   * Checks the profile on sign-in, whenever Clerk's copy of the name or
   * institution changes, and when the tab regains focus (at most every 15 s),
   * so a name removed in the Clerk dashboard or the database brings the popup
   * back without signing out.
   */
  const clerkInstitution = user?.publicMetadata?.institution;
  const clerkProfileKey = `${user?.id}|${user?.firstName ?? ''}|${user?.lastName ?? ''}|${typeof clerkInstitution === 'string' ? clerkInstitution : ''}`;
  useEffect(() => {
    if (!isSignedIn || !userRef.current) return;
    let cancelled = false;
    let inFlight = false;
    let lastCheck = 0;

    const check = () => {
      const clerkUser = userRef.current;
      if (!clerkUser || inFlight) return;
      inFlight = true;
      lastCheck = Date.now();
      dataService
        .syncClerkUser({
          id: clerkUser.id,
          firstName: clerkUser.firstName,
          lastName: clerkUser.lastName,
          imageUrl: clerkUser.imageUrl,
          email: clerkUser.primaryEmailAddress?.emailAddress,
        })
        .then((profile) => {
          if (cancelled || !profile) return;
          announceTeacherProfile(profile);
          const nextAccess = teacherAccessOf(profile);
          setTeacherAccessState({ userId: clerkUser.id, access: nextAccess, profile });
          if (nextAccess !== 'incomplete') rememberApprovedHere(clerkUser.id, nextAccess === 'ok');
          if (isTeacherProfileComplete(profile)) {
            setRequired(false);
            return;
          }
          // Don't wipe what the teacher is already typing into an open popup.
          if (!requiredRef.current) {
            const values = profileFormValues(profile, clerkUser);
            setFirstName(values.firstName);
            setLastName(values.lastName);
            setInstitution(values.institution);
          }
          setRequired(true);
        })
        .catch((err: unknown) => console.error('Error syncing clerk user:', err))
        .finally(() => {
          inFlight = false;
        });
    };

    const onFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck > 15_000) check();
    };
    check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener(TEACHER_ACCESS_RECHECK_EVENT, check);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener(TEACHER_ACCESS_RECHECK_EVENT, check);
    };
  }, [isSignedIn, clerkProfileKey]);

  // Saved from another place (e.g. the dashboard's profile editor).
  useEffect(() => {
    const onUpdated = (event: Event) => {
      if (isTeacherProfileComplete((event as CustomEvent<User>).detail)) setRequired(false);
    };
    window.addEventListener(TEACHER_PROFILE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(TEACHER_PROFILE_UPDATED_EVENT, onUpdated);
  }, []);

  const onAuthPage = AUTH_PATH.test(pathname);
  const onPendingPage = pathname === PENDING_APPROVAL_PATH;
  const knownAccess = isSignedIn && checkedUserId === user?.id ? access : null;
  const blocked = knownAccess === 'pending' || knownAccess === 'rejected';

  // Not approved: only the waiting page. Approved: the waiting page has nothing to say.
  useEffect(() => {
    if (onAuthPage) return;
    if (blocked && !onPendingPage) router.replace(PENDING_APPROVAL_PATH);
    else if (knownAccess === 'ok' && onPendingPage) router.replace('/');
  }, [blocked, knownAccess, onAuthPage, onPendingPage, router]);

  if (!isSignedIn || onAuthPage) return null;
  if (!required) {
    // Cover the page while it is (or may be) off limits: known to be blocked, or
    // not checked yet in a browser that has never seen this teacher approved.
    const cover = !onPendingPage && (blocked || (knownAccess === null && approvedHere === false));
    return cover ? (
      <div className="fixed inset-0 z-[85] bg-slate-50 dark:bg-slate-950 flex items-center justify-center" aria-busy="true">
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      </div>
    ) : null;
  }

  const canSave = Boolean(firstName.trim() && lastName.trim() && institution.trim()) && !saving;

  const save = async () => {
    if (!user || !canSave) return;
    const profile = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      institution: canonicalInstitution(institution) || institution.trim(),
    };
    if (profile.first_name === TEACHER_NAME_PLACEHOLDER) {
      setError(tr('กรุณากรอกชื่อจริง', 'Please enter your real first name'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ok = await dataService.updateTeacherProfile(user.id, profile);
      if (!ok) throw new Error(tr('ข้อมูลไม่ครบ กรุณาตรวจสอบอีกครั้ง', 'Some details are missing; please check again'));
      // The server already updated Clerk; refresh this browser's copy (navbar name, greeting).
      await user.reload().catch(() => undefined);
      announceTeacherProfile({ id: user.id, role: 'teacher', ...profile } as User);
      // While the profile was incomplete the server refused this page's other
      // requests; load the page again now that they are allowed.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง', 'Save failed, please try again'));
    } finally {
      setSaving(false);
    }
  };

  return (
    // Above every other popup and the sidebar; there is no way to close it.
    <ModalSheet onClose={() => undefined} size="sm:max-w-md" zIndex="z-[90]" labelledBy="teacher-profile-gate-title">
      <div className="shrink-0 text-center space-y-2 px-4 sm:px-6 pt-3 sm:pt-6 pb-1">
        <div className="w-14 h-14 rounded-2xl bg-linear-to-br from-amber-300 to-amber-500 text-3xl flex items-center justify-center mx-auto shadow-lg shadow-amber-500/25">
          🍮
        </div>
        <h3 id="teacher-profile-gate-title" className="text-lg font-black text-slate-900 dark:text-white">
          {language === 'th' ? 'ยินดีต้อนรับสู่ Pudding!' : 'Welcome to Pudding!'}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
          {tr(
            'กรอกชื่อ นามสกุล และสถานศึกษาก่อนเริ่มใช้งาน เพื่อให้นักเรียนและเพื่อนครูค้นหาคุณเจอ',
            'Add your first name, last name and institution before you start, so students and co-teachers can find you.'
          )}
        </p>
      </div>

      <ModalSheetBody className="space-y-4">
        <TeacherProfileFields
          firstName={firstName}
          lastName={lastName}
          institution={institution}
          onFirstName={setFirstName}
          onLastName={setLastName}
          onInstitution={setInstitution}
        />
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      </ModalSheetBody>

      <ModalSheetFooter className="flex-col-reverse items-stretch sm:flex-col-reverse">
        <button
          type="button"
          onClick={() => signOut({ redirectUrl: '/' })}
          className="inline-flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          {tr('ไม่ใช่บัญชีของคุณ? ออกจากระบบ', 'Not your account? Sign out')}
        </button>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold shadow-xs cursor-pointer disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {tr('บันทึกและเริ่มใช้งาน', 'Save & get started')}
        </button>
      </ModalSheetFooter>
    </ModalSheet>
  );
}
