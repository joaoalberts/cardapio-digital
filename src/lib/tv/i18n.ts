// Textos do telão (TV do salão) nas 6 línguas do cardápio. O texto dos pratos vem do banco;
// aqui só rótulos e avisos. Regras: sem CAIXA ALTA e sem seta no fim (o teste confere o pt-BR).
import { KNOWN_LANGS } from "@/lib/menu/i18n";

export const TV_LANGS = KNOWN_LANGS;
export type TvLang = (typeof KNOWN_LANGS)[number];

// [pt-BR, en, es, fr, it, de]
const L6 = (a: [string, string, string, string, string, string]) =>
  Object.fromEntries(KNOWN_LANGS.map((l, i) => [l, a[i]])) as Record<TvLang, string>;

export const TV_TEXTS = {
  highlightTitle: L6(["Destaque da casa", "House pick", "Destacado de la casa", "Coup de cœur de la maison", "Consiglio della casa", "Tipp des Hauses"]),
  tvPoint: L6(["Aponte a câmera", "Point your camera", "Apunta la cámara", "Visez avec l’appareil", "Inquadra con la fotocamera", "Kamera draufhalten"]),
  tvQrSub: L6(["o cardápio da casa no seu celular", "the house menu on your phone", "la carta de la casa en tu celular", "la carte de la maison sur votre téléphone", "il menù della casa sul tuo telefono", "die Karte des Hauses auf deinem Handy"]),
  tvOrderQr: L6(["peça pelo QR da sua mesa", "order with your table’s QR code", "pide con el QR de tu mesa", "commandez avec le QR de votre table", "ordina con il QR del tuo tavolo", "bestell über den QR-Code deines Tisches"]),
  tvConnecting: L6(["conectando…", "connecting…", "conectando…", "connexion…", "connessione…", "verbinde…"]),
  tvPairKicker: L6(["Cardápio Digital, telão", "Cardápio Digital, big screen", "Cardápio Digital, pantalla", "Cardápio Digital, écran", "Cardápio Digital, maxischermo", "Cardápio Digital, Bildschirm"]),
  tvPairTitle: L6(["Parear esta TV", "Pair this TV", "Vincular esta TV", "Associer cette TV", "Abbina questa TV", "Diesen Fernseher koppeln"]),
  tvPairWait: L6([
    "esperando o painel · o código muda a cada 10 min",
    "waiting for the panel · the code changes every 10 min",
    "esperando el panel · el código cambia cada 10 min",
    "en attente du panneau · le code change toutes les 10 min",
    "in attesa del pannello · il codice cambia ogni 10 min",
    "warte auf das Panel · der Code ändert sich alle 10 Min.",
  ]),
  tvPairBusy: L6([
    "Muitos códigos pedidos na última hora. A TV tenta de novo a cada minuto; o código pode levar até 1 hora para aparecer.",
    "Too many codes requested in the last hour. The screen tries again every minute; the code may take up to 1 hour to show up.",
    "Demasiados códigos pedidos en la última hora. La pantalla vuelve a intentarlo cada minuto; el código puede tardar hasta 1 hora en aparecer.",
    "Trop de codes demandés au cours de la dernière heure. L’écran réessaie chaque minute ; le code peut mettre jusqu’à 1 heure à s’afficher.",
    "Troppi codici richiesti nell’ultima ora. Lo schermo riprova ogni minuto; il codice può impiegare fino a 1 ora per comparire.",
    "In der letzten Stunde wurden zu viele Codes angefragt. Der Bildschirm versucht es jede Minute erneut; der Code kann bis zu 1 Stunde brauchen.",
  ]),
  // {c} = "TVs", em destaque; os nomes do painel (Conectar) ficam como no painel.
  tvPairHelp: L6([
    "No painel do restaurante, abra {c}, digite este código e aperte Conectar.",
    "In the restaurant panel, open {c}, type this code and press Conectar.",
    "En el panel del restaurante, abre {c}, escribe este código y pulsa Conectar.",
    "Dans le panneau du restaurant, ouvrez {c}, saisissez ce code et appuyez sur Conectar.",
    "Nel pannello del ristorante, apri {c}, digita questo codice e premi Conectar.",
    "Öffne im Restaurant-Panel {c}, gib diesen Code ein und tippe auf Conectar.",
  ]),
} satisfies Record<string, Record<TvLang, string>>;

export type TvKey = keyof typeof TV_TEXTS;

export function tt(key: TvKey, lang: string): string {
  const row = TV_TEXTS[key] as Record<string, string>;
  return row[lang] ?? row[lang.slice(0, 2)] ?? row["pt-BR"];
}
