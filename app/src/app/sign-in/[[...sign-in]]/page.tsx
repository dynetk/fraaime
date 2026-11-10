import Brand from "@/components/Brand";
import { SignIn } from "@clerk/nextjs";
import { localMode } from "@/lib/config";
export default function Page() {
  return (
    <main className="setup">
      <Brand />
      <div className="eyebrow">AI-POWERED STRUCTURAL FRAMING</div>
      <h1>Your project workspace.</h1>
      <p>
        Review your plans, refine your framing, and build with a clearer
        picture.
      </p>
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
