import { redirect } from "next/navigation";

/**
 * Sign-up now runs inside /sign-in (Clerk's sign-in-or-up flow: a new LINE
 * account is created on first sign-in). Kept so old /sign-up links still work.
 */
export default function SignUpPage() {
  redirect("/sign-in");
}
