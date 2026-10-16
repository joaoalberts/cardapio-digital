import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type CSSProperties } from "react";
import { getPublicMenu } from "@/lib/menu/data";
import { fontVariables } from "@/lib/menu/fonts";
import { DEFAULT_FONT_THEME, isFontTheme } from "@/lib/menu/font-themes";
import { isValidSlug } from "@/lib/slug";
import "@/styles/font-themes.css";
import "../apareca.css";

// Termos de uso de imagem e política de privacidade do "Apareça na TV!".
// RASCUNHO para o João revisar (não é parecer jurídico). O restaurante é o controlador dos dados
// e o João (Cardápio Digital) é o operador (resposta do João ao plano, 16/10). Revisão jurídica
// antes de ligar em produção.

export const metadata: Metadata = { title: "Termos do Apareça na TV", robots: { index: false, follow: false } };

export default function TermosPage({ params }: PageProps<"/[slug]/apareca/termos">) {
  return (
    <Suspense fallback={<div className="apa apa-boot" aria-busy="true" />}>
      <Termos params={params} />
    </Suspense>
  );
}

async function Termos({ params }: { params: PageProps<"/[slug]/apareca/termos">["params"] }) {
  const slug = (await params).slug.toLowerCase();
  if (!isValidSlug(slug)) notFound();
  const menu = await getPublicMenu(slug);
  if (!menu) notFound();
  const r = menu.restaurant;
  const casa = r.name;

  return (
    <div className={fontVariables}>
      <div
        className="apa"
        data-font={isFontTheme(r.font_theme) ? r.font_theme : DEFAULT_FONT_THEME}
        style={{ "--accent": r.brand_color ?? undefined } as CSSProperties}
      >
        <main className="apa-page apa-terms">
          <header className="apa-top">
            <a className="apa-back" href={`/${slug}`} aria-label="Voltar ao cardápio">
              <svg viewBox="0 0 24 24" className="apa-ic" aria-hidden>
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </a>
            <span className="apa-house">
              <span>{casa}</span>
            </span>
          </header>

          <article className="apa-card apa-doc">
            <h1 className="fd">Termos de uso de imagem e política de privacidade</h1>
            <p className="apa-fine">Apareça na TV · {casa}</p>

            <h2>O que é</h2>
            <p>
              O &ldquo;Apareça na TV!&rdquo; deixa você gravar um vídeo de 6 segundos pelo celular para ele passar na TV do salão de {casa}.
              Participar é opcional e gratuito.
            </p>

            <h2>Uso da sua imagem</h2>
            <p>
              Ao marcar o aceite, você autoriza {casa} a mostrar o seu vídeo e o nome ou @ que você escreveu na TV da casa,
              sem pagamento, só durante o prazo abaixo. O vídeo passa na TV sem som. Antes de ir para a TV, todo vídeo é olhado pela
              equipe da casa, que pode não exibi-lo sem precisar explicar o motivo.
            </p>
            <p>Não grave outras pessoas sem a autorização delas. Crianças só com o responsável junto.</p>

            <h2>O que guardamos</h2>
            <ul>
              <li>o vídeo que você gravou;</li>
              <li>o nome ou @ que você escreveu, se escreveu;</li>
              <li>um identificador anônimo deste celular, criado pelo cardápio, que não revela quem você é;</li>
              <li>a mesa de onde o vídeo foi enviado;</li>
              <li>a data e a hora em que você aceitou estes termos.</li>
            </ul>
            <p>
              Não pedimos telefone, e-mail nem documento. A miniatura que aparece na sua tela fica só no seu celular.
            </p>

            <h2>Por quanto tempo</h2>
            <p>
              O vídeo e os dados acima são apagados 6 horas depois do envio, ou no prazo que a casa escolher, que nunca passa de 7 dias.
              Depois disso, fica só a contagem de vídeos por dia, sem nada que identifique você.
            </p>

            <h2>Onde ficam</h2>
            <p>
              O vídeo fica no Mux, o serviço que converte e entrega os vídeos para a TV. Os dados ficam no banco do Cardápio Digital
              (NocoDB). {casa} é a responsável pelos dados (controladora) e o Cardápio Digital apenas opera o sistema para ela.
            </p>

            <h2>Análise automática</h2>
            <p>
              Se a casa ligar a análise automática, três quadros (imagens paradas) do seu vídeo são enviados a um serviço de
              inteligência artificial (Anthropic) só para a moderação, isto é, para conferir se o vídeo pode passar na TV. Esses
              quadros não são usados para mais nada.
            </p>

            <h2>Baixar o seu vídeo</h2>
            <p>
              Você pode baixar o seu vídeo, sem moldura e com som, enquanto ele estiver guardado. O link de download é pessoal: não o
              compartilhe. O vídeo aprovado passa nas TVs da casa, para quem estiver no salão.
            </p>

            <h2>Como pedir a remoção</h2>
            <p>
              Fale com a equipe da casa a qualquer momento: ela tira o vídeo da TV na hora e ele é apagado. Você também pode pedir
              informações sobre os seus dados, como garante a Lei Geral de Proteção de Dados (LGPD).
            </p>
          </article>
        </main>
      </div>
    </div>
  );
}
