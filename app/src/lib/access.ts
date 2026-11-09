export type Actor = { email: string; role: "admin" | "reviewer" | "customer" };
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function permitted(
  actor: Actor,
  owner: string,
  membership: string | null,
  action: "read" | "edit" | "review" | "manage",
) {
  if (actor.role === "admin") return true;
  if (action === "manage") return actor.email === owner;
  if (actor.email !== owner && !membership) return false;
  if (action === "review")
    return (
      actor.role === "reviewer" &&
      (actor.email === owner || membership === "reviewer")
    );
  return true;
}
