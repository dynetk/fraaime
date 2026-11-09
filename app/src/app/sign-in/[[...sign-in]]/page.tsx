import { SignIn } from "@clerk/nextjs";
import { localMode } from "@/lib/config";
export default function Page() {
  return (
    <main className="setup">
      <a className="wordmark" href="/">
        fraaime®
      </a>
      <h1>Your project workspace.</h1>
      {localMode() ? (
        <>
          <p>Local development uses a loopback-only test identity.</p>
          <a href="/">Return to studio</a>
        </>
      ) : process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
        <SignIn forceRedirectUrl="/" />
      ) : (
        <p>Sign-in has not been configured yet.</p>
      )}
    </main>
  );
}
