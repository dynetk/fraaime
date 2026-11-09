export function localMode() {
  return (
    process.env.FRAAIME_LOCAL_MODE === "1" &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== "production"
  );
}
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}
export function limit(name: string, fallback: number) {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`Invalid configuration: ${name}`);
  return n;
}
export function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
