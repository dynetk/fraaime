import { clerkMiddleware } from "@clerk/nextjs/server";
import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  const local =
    process.env.FRAAIME_LOCAL_MODE === "1" &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== "production";
  if (local) {
    if (!["127.0.0.1", "localhost", "[::1]"].includes(request.nextUrl.hostname))
      return new NextResponse("Local mode is loopback only", { status: 403 });
    return NextResponse.next();
  }
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return NextResponse.next();
  return clerkMiddleware()(request, event);
}
export const config = {
  matcher: ["/((?!_next|favicon.ico|\\.well-known/workflow/).*)"],
};
