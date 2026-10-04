import { auth } from "@clerk/nextjs/server";
import DashboardPage from "./dashboard/page";
import { TeacherLoggedOutView } from "@/components/TeacherLoggedOutView";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    return <DashboardPage />;
  }

  return <TeacherLoggedOutView />;
}
