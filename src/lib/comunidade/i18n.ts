// Textos da Comunidade no cardápio (balão, camada, Palco, Mural, "Pedir também") nas 6
// línguas do cardápio. O texto dos pratos vem do banco; aqui só rótulos e avisos.
// Regras: sem CAIXA ALTA e sem seta no fim de botão (o teste confere o pt-BR).
import { KNOWN_LANGS } from "@/lib/menu/i18n";

export const CMU_LANGS = KNOWN_LANGS;
export type CmuLang = (typeof KNOWN_LANGS)[number];

// [pt-BR, en, es, fr, it, de]
const L6 = (a: [string, string, string, string, string, string]) =>
  Object.fromEntries(KNOWN_LANGS.map((l, i) => [l, a[i]])) as Record<CmuLang, string>;

export const CMU_TEXTS = {
  // ---------- Balão na capa ----------
  pollOpen: L6(["Enquete aberta", "Poll open", "Encuesta abierta", "Sondage ouvert", "Sondaggio aperto", "Umfrage läuft"]),
  liveOnTv: L6(["Ao vivo no telão", "Live on the big screen", "En vivo en la pantalla", "En direct sur l’écran", "In diretta sul maxischermo", "Live auf dem Bildschirm"]),
  liveNowCap: L6(["Ao vivo agora", "Live now", "En vivo ahora", "En direct", "In diretta ora", "Jetzt live"]),
  tapToVote: L6(["toque para votar", "tap to vote", "toca para votar", "touchez pour voter", "tocca per votare", "tippen zum Abstimmen"]),
  muralHighlight: L6(["{name} em destaque", "{name} in the spotlight", "{name} destacado", "{name} à l’honneur", "{name} in evidenza", "{name} im Rampenlicht"]),
  muralCount: L6(["{n} fotos da casa", "{n} house photos", "{n} fotos de la casa", "{n} photos de la maison", "{n} foto della casa", "{n} Fotos vom Haus"]),
  muralCount1: L6(["1 foto da casa", "1 house photo", "1 foto de la casa", "1 photo de la maison", "1 foto della casa", "1 Foto vom Haus"]),
  highlightIs: L6(["Destaque da casa: {name}", "House pick: {name}", "Destacado de la casa: {name}", "Coup de cœur de la maison : {name}", "Consiglio della casa: {name}", "Tipp des Hauses: {name}"]),
  muralPill: L6(["Mural da casa", "House wall", "Mural de la casa", "Mur de la maison", "Bacheca della casa", "Pinnwand des Hauses"]),
  openPollAria: L6([
    "Abrir a Comunidade: enquete aberta, {q}",
    "Open the Community: poll open, {q}",
    "Abrir la Comunidad: encuesta abierta, {q}",
    "Ouvrir la Communauté : sondage ouvert, {q}",
    "Apri la Community: sondaggio aperto, {q}",
    "Community öffnen: Umfrage läuft, {q}",
  ]),
  openMuralAria: L6(["Abrir o mural de pratos", "Open the dish wall", "Abrir el mural de platos", "Ouvrir le mur des plats", "Apri la bacheca dei piatti", "Gerichte-Pinnwand öffnen"]),

  // ---------- Camada ----------
  community: L6(["Comunidade", "Community", "Comunidad", "Communauté", "Community", "Community"]),
  palco: L6(["Palco", "Stage", "Escenario", "Scène", "Palco", "Bühne"]),
  mural: L6(["Mural", "Wall", "Mural", "Mur", "Bacheca", "Pinnwand"]),
  closeAria: L6(["Fechar a Comunidade", "Close the Community", "Cerrar la Comunidad", "Fermer la Communauté", "Chiudi la Community", "Community schließen"]),
  offline: L6([
    "sem conexão, tentando de novo",
    "no connection, trying again",
    "sin conexión, reintentando",
    "pas de connexion, nouvel essai",
    "senza connessione, riprovo",
    "keine Verbindung, neuer Versuch",
  ]),
  tip: L6([
    "Vote nas enquetes da casa e veja o que está saindo agora.",
    "Vote in the house polls and see what’s coming out of the kitchen now.",
    "Vota en las encuestas de la casa y mira lo que está saliendo ahora.",
    "Votez aux sondages de la maison et voyez ce qui sort en ce moment.",
    "Vota nei sondaggi della casa e guarda cosa sta uscendo adesso.",
    "Stimm bei den Umfragen des Hauses ab und sieh, was gerade rausgeht.",
  ]),
  tipOk: L6(["Entendi", "Got it", "Entendido", "Compris", "Capito", "Verstanden"]),

  // ---------- Palco ----------
  liveNow: L6(["ao vivo agora", "live now", "en vivo ahora", "en direct", "in diretta ora", "jetzt live"]),
  paused: L6(["pausado, sem conexão", "paused, no connection", "en pausa, sin conexión", "en pause, pas de connexion", "in pausa, senza connessione", "pausiert, keine Verbindung"]),
  onTv: L6(["no telão", "on the big screen", "en la pantalla", "sur l’écran", "sul maxischermo", "auf dem Bildschirm"]),
  housePoll: L6(["Enquete da casa", "House poll", "Encuesta de la casa", "Sondage de la maison", "Sondaggio della casa", "Umfrage des Hauses"]),
  closesIn: L6(["fecha em", "closes in", "cierra en", "ferme dans", "chiude tra", "endet in"]),
  tapOption: L6(["Toque numa opção para votar", "Tap an option to vote", "Toca una opción para votar", "Touchez une option pour voter", "Tocca un’opzione per votare", "Tippe auf eine Option zum Abstimmen"]),
  beFirst: L6(["Seja o primeiro a votar", "Be the first to vote", "Sé el primero en votar", "Soyez le premier à voter", "Sii il primo a votare", "Gib die erste Stimme ab"]),
  youVoted: L6(["Você votou", "You voted", "Votaste", "Vous avez voté", "Hai votato", "Du hast abgestimmt"]),
  youVotedMark: L6(["✓ você votou", "✓ you voted", "✓ votaste", "✓ vous avez voté", "✓ hai votato", "✓ abgestimmt"]),
  resultLiveTv: L6([
    "o resultado muda ao vivo no telão",
    "the result changes live on the big screen",
    "el resultado cambia en vivo en la pantalla",
    "le résultat change en direct sur l’écran",
    "il risultato cambia in diretta sul maxischermo",
    "das Ergebnis ändert sich live auf dem Bildschirm",
  ]),
  resultLive: L6(["o resultado muda ao vivo", "the result changes live", "el resultado cambia en vivo", "le résultat change en direct", "il risultato cambia in diretta", "das Ergebnis ändert sich live"]),
  needTable: L6([
    "Leia o QR da sua mesa para votar",
    "Scan your table’s QR code to vote",
    "Escanea el QR de tu mesa para votar",
    "Scannez le QR de votre table pour voter",
    "Inquadra il QR del tuo tavolo per votare",
    "Scanne den QR-Code deines Tisches zum Abstimmen",
  ]),
  needTableSub: L6([
    "Aqui você acompanha o resultado ao vivo.",
    "Here you can follow the result live.",
    "Aquí sigues el resultado en vivo.",
    "Ici, vous suivez le résultat en direct.",
    "Qui segui il risultato in diretta.",
    "Hier siehst du das Ergebnis live.",
  ]),
  closedQ: L6(["{q} · encerrada", "{q} · closed", "{q} · cerrada", "{q} · terminé", "{q} · chiuso", "{q} · beendet"]),
  closedNoVotesQ: L6([
    "{q} · encerrada sem votos",
    "{q} · closed with no votes",
    "{q} · cerrada sin votos",
    "{q} · terminé sans votes",
    "{q} · chiuso senza voti",
    "{q} · ohne Stimmen beendet",
  ]),
  closing: L6(["Votação encerrada, o resultado já sai", "Voting closed, the result is coming", "Votación cerrada, ya sale el resultado", "Vote terminé, le résultat arrive", "Votazione chiusa, il risultato sta arrivando", "Abstimmung beendet, das Ergebnis kommt gleich"]),
  wonWith: L6(["venceu com", "won with", "ganó con", "a gagné avec", "ha vinto con", "gewann mit"]),
  pollWon: L6(["Deu na enquete", "The poll has spoken", "Ganó en la encuesta", "Le sondage a parlé", "Ha vinto il sondaggio", "Sieger der Umfrage"]),
  highlightTitle: L6(["Destaque da casa", "House pick", "Destacado de la casa", "Coup de cœur de la maison", "Consiglio della casa", "Tipp des Hauses"]),
  highlightLower: L6(["destaque da casa", "house pick", "destacado de la casa", "coup de cœur de la maison", "consiglio della casa", "Tipp des Hauses"]),
  recommends: L6([
    "Hoje a casa recomenda este.",
    "Today the house recommends this one.",
    "Hoy la casa recomienda este.",
    "Aujourd’hui, la maison recommande celui-ci.",
    "Oggi la casa consiglia questo.",
    "Heute empfiehlt das Haus dieses Gericht.",
  ]),
  nextAt: L6(["A seguir, às {t}", "Next, at {t}", "A continuación, a las {t}", "Ensuite, à {t}", "A seguire, alle {t}", "Als Nächstes um {t}"]),
  muralNow: L6(["No mural agora", "On the wall now", "En el mural ahora", "Sur le mur en ce moment", "In bacheca ora", "Jetzt an der Pinnwand"]),
  voteErr: L6([
    "Não deu para votar agora. Tente de novo.",
    "Couldn’t vote right now. Try again.",
    "No se pudo votar ahora. Inténtalo de nuevo.",
    "Impossible de voter pour l’instant. Réessayez.",
    "Non è stato possibile votare ora. Riprova.",
    "Abstimmen ging gerade nicht. Versuch es noch mal.",
  ]),
  voteTooMany: L6([
    "Esta mesa já votou bastante nesta enquete.",
    "This table has already voted a lot in this poll.",
    "Esta mesa ya votó mucho en esta encuesta.",
    "Cette table a déjà beaucoup voté à ce sondage.",
    "Questo tavolo ha già votato molto in questo sondaggio.",
    "Dieser Tisch hat bei dieser Umfrage schon oft abgestimmt.",
  ]),
  voteTable: L6([
    "Esta mesa não está mais valendo. Leia o QR da mesa de novo.",
    "This table is no longer valid. Scan the table’s QR code again.",
    "Esta mesa ya no es válida. Escanea de nuevo el QR de la mesa.",
    "Cette table n’est plus valable. Scannez à nouveau le QR de la table.",
    "Questo tavolo non è più valido. Inquadra di nuovo il QR del tavolo.",
    "Dieser Tisch gilt nicht mehr. Scanne den QR-Code des Tisches erneut.",
  ]),
  voteClosed: L6(["Esta enquete já fechou.", "This poll has already closed.", "Esta encuesta ya cerró.", "Ce sondage est déjà terminé.", "Questo sondaggio è già chiuso.", "Diese Umfrage ist schon beendet."]),

  // ---------- Mural ----------
  muralHead: L6(["Agora na cozinha", "Now in the kitchen", "Ahora en la cocina", "En cuisine maintenant", "Ora in cucina", "Gerade in der Küche"]),
  muralHeadSub: L6(["fotos da casa", "house photos", "fotos de la casa", "photos de la maison", "foto della casa", "Fotos vom Haus"]),
  byHouse: L6(["da casa", "from the house", "de la casa", "de la maison", "della casa", "vom Haus"]),
  unavailableToday: L6(["indisponível hoje", "unavailable today", "no disponible hoy", "indisponible aujourd’hui", "non disponibile oggi", "heute nicht verfügbar"]),
  unavailable: L6(["indisponível", "unavailable", "no disponible", "indisponible", "non disponibile", "nicht verfügbar"]),
  muralEnd: L6(["Fotos postadas pela casa.", "Photos posted by the house.", "Fotos publicadas por la casa.", "Photos publiées par la maison.", "Foto pubblicate dalla casa.", "Fotos vom Haus gepostet."]),
  seeMore: L6(["Ver mais", "See more", "Ver más", "Voir plus", "Vedi altro", "Mehr anzeigen"]),
  emptyLead: L6([
    "A casa ainda não postou fotos hoje. Enquanto isso, o destaque da casa:",
    "The house hasn’t posted photos yet today. Meanwhile, the house pick:",
    "La casa aún no publicó fotos hoy. Mientras tanto, el destacado de la casa:",
    "La maison n’a pas encore publié de photos aujourd’hui. En attendant, son coup de cœur :",
    "La casa non ha ancora pubblicato foto oggi. Nel frattempo, il consiglio della casa:",
    "Das Haus hat heute noch keine Fotos gepostet. Bis dahin der Tipp des Hauses:",
  ]),
  emptyNone: L6([
    "A casa ainda não postou fotos hoje.",
    "The house hasn’t posted photos yet today.",
    "La casa aún no publicó fotos hoy.",
    "La maison n’a pas encore publié de photos aujourd’hui.",
    "La casa non ha ancora pubblicato foto oggi.",
    "Das Haus hat heute noch keine Fotos gepostet.",
  ]),
  fromMenu: L6(["do cardápio de hoje", "from today’s menu", "de la carta de hoy", "de la carte du jour", "dal menù di oggi", "von der heutigen Karte"]),
  emptyNote: L6([
    "Quando a cozinha postar, as fotos aparecem aqui na hora.",
    "When the kitchen posts, the photos show up here right away.",
    "Cuando la cocina publique, las fotos aparecen aquí al instante.",
    "Quand la cuisine publiera, les photos apparaîtront ici aussitôt.",
    "Quando la cucina pubblica, le foto compaiono qui subito.",
    "Sobald die Küche postet, erscheinen die Fotos sofort hier.",
  ]),
  photoOpen: L6(["Ver a foto de {name}", "See the photo of {name}", "Ver la foto de {name}", "Voir la photo de {name}", "Vedi la foto di {name}", "Foto von {name} ansehen"]),
  photoClose: L6(["Fechar a foto", "Close the photo", "Cerrar la foto", "Fermer la photo", "Chiudi la foto", "Foto schließen"]),

  // ---------- Pedir também ----------
  buyAlso: L6(["Pedir também", "Order this too", "Pedir también", "Commander aussi", "Ordina anche tu", "Auch bestellen"]),
  inOrder: L6(["já no pedido", "already in your order", "ya en el pedido", "déjà dans la commande", "già nell’ordine", "schon in der Bestellung"]),

  // ---------- Hora relativa ----------
  relNow: L6(["agora", "now", "ahora", "à l’instant", "ora", "gerade eben"]),
  relMin: L6(["há {n} min", "{n} min ago", "hace {n} min", "il y a {n} min", "{n} min fa", "vor {n} Min."]),
  relH: L6(["há {n} h", "{n} h ago", "hace {n} h", "il y a {n} h", "{n} h fa", "vor {n} Std."]),
  relD: L6(["há {n} d", "{n} d ago", "hace {n} d", "il y a {n} j", "{n} g fa", "vor {n} T."]),

  // ---------- Modelos de enquete (o painel usa o pt-BR como pergunta) ----------
  tplDessert: L6(["Qual sobremesa sai hoje?", "Which dessert wins tonight?", "¿Qué postre sale hoy?", "Quel dessert ce soir ?", "Quale dolce esce stasera?", "Welches Dessert gewinnt heute?"]),
  tplDrink: L6(["Qual drink sai hoje?", "Which drink wins tonight?", "¿Qué trago sale hoy?", "Quel cocktail ce soir ?", "Quale drink esce stasera?", "Welcher Drink gewinnt heute?"]),
  tplMusic: L6(["Qual a próxima música?", "What should play next?", "¿Cuál es la próxima canción?", "Quelle est la prochaine chanson ?", "Qual è la prossima canzone?", "Welcher Song kommt als Nächstes?"]),
} satisfies Record<string, Record<CmuLang, string>>;

export type CmuKey = keyof typeof CMU_TEXTS;

export function ct(key: CmuKey, lang: string): string {
  const row = CMU_TEXTS[key] as Record<string, string>;
  return row[lang] ?? row[lang.slice(0, 2)] ?? row["pt-BR"];
}

// Texto com variáveis: ctf("muralCount", lang, { n: 5 }) → "5 fotos da casa".
export function ctf(key: CmuKey, lang: string, vars: Record<string, string | number>): string {
  return ct(key, lang).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}
