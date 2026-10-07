import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Destino dos links de e-mail (confirmação e nova senha): troca o código pela sessão.
// "next" só aceita um caminho deste site.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");
  const dest = next && /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/painel";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, request.url));
  }
  return NextResponse.redirect(new URL("/entrar", request.url));
}
