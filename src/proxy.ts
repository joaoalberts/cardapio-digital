import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionValue } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const user = await readSessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  // Verificação rápida; a página do painel confere de novo no servidor.
  if (!user && pathname.startsWith("/painel")) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && (pathname === "/entrar" || pathname === "/cadastro")) {
    const url = request.nextUrl.clone();
    url.pathname = "/painel";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/painel/:path*", "/entrar", "/cadastro"],
};
