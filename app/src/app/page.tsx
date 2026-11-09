import Studio from "@/components/Studio";
import { localMode } from "@/lib/config";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!localMode()) {
    if (
      !process.env.CLERK_SECRET_KEY ||
      !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    )
      return (
        <main className="setup">
          <h1>Fraaime Project Studio</h1>
          <p>
            Configure Clerk authentication and the database before opening this
            pilot.
          </p>
          <p>
            See the application README for setup instructions. No public project
            access is enabled.
          </p>
        </main>
      );
    if (!(await auth()).userId) redirect("/sign-in");
  }
  return <Studio />;
}
