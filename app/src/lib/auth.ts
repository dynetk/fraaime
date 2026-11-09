import { auth, currentUser } from "@clerk/nextjs/server";
import { localMode, adminEmails } from "./config";
import { database } from "./db";
import { Actor, HttpError, permitted } from "./access";
export async function actor(): Promise<Actor> {
  if (localMode())
    return {
      email: process.env.FRAAIME_LOCAL_EMAIL || "developer@localhost",
      role: "admin",
    };
  if (!(await auth()).userId) throw new HttpError(401, "Please sign in.");
  const user = await currentUser();
  const primary = user?.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId,
  );
  if (!primary || primary.verification?.status !== "verified")
    throw new HttpError(403, "A verified email address is required.");
  const email = primary.emailAddress.toLowerCase();
  if (adminEmails().includes(email)) return { email, role: "admin" };
  const { rows } = await (
    await database()
  ).query<{ role: Actor["role"] }>(
    "SELECT role FROM invitations WHERE email=$1",
    [email],
  );
  if (!rows[0])
    throw new HttpError(
      403,
      "This pilot is invitation only. Ask your Fraaime administrator for access.",
    );
  return { email, role: rows[0].role };
}
export async function projectAccess(
  projectId: string,
  user: Actor,
  action: "read" | "edit" | "review" | "manage" = "read",
) {
  const db = await database();
  const { rows } = await db.query<{
    id: string;
    name: string;
    owner_email: string;
    head_id: string | null;
    membership: string | null;
  }>(
    "SELECT p.*, m.role AS membership FROM projects p LEFT JOIN memberships m ON m.project_id=p.id AND m.email=$2 WHERE p.id=$1 AND p.deleted_at IS NULL",
    [projectId, user.email],
  );
  const p = rows[0];
  if (!p || !permitted(user, p.owner_email, p.membership, action))
    throw new HttpError(404, "Project not found or access denied.");
  return p;
}
