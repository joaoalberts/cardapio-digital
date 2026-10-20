// Textos da interface do cardápio nos idiomas que o sistema conhece.
// O texto dos pratos vem do banco; aqui só botões, avisos e rótulos.
export const KNOWN_LANGS = ["pt-BR", "en", "es", "fr", "it", "de"] as const;

export const LANG_NAME: Record<string, string> = {
  "pt-BR": "Português",
  en: "English",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  de: "Deutsch",
};

export const LANG_FLAG: Record<string, string> = {
  "pt-BR": "br",
  en: "us",
  es: "es",
  fr: "fr",
  it: "it",
  de: "de",
};

const L6 = (a: [string, string, string, string, string, string]) =>
  Object.fromEntries(KNOWN_LANGS.map((l, i) => [l, a[i]])) as Record<string, string>;

const STRINGS = {
  featured: L6(["Destaques", "Highlights", "Destacados", "Coups de cœur", "In evidenza", "Empfehlungen"]),
  serves: L6(["Serve {n}", "Serves {n}", "Para {n}", "Pour {n}", "Per {n}", "Für {n}"]),
  from: L6(["a partir de", "from", "desde", "à partir de", "da", "ab"]),
  info: L6(["Informações", "Information", "Información", "Informations", "Informazioni", "Informationen"]),
  wifi: L6(["Wi-Fi", "Wi-Fi", "Wi-Fi", "Wi-Fi", "Wi-Fi", "WLAN"]),
  password: L6(["Senha", "Password", "Contraseña", "Mot de passe", "Password", "Passwort"]),
  items: L6(["itens", "items", "platos", "plats", "piatti", "Gerichte"]),
  video: L6(["vídeo", "video", "vídeo", "vidéo", "video", "Video"]),
  viewList: L6(["Ver lista", "View list", "Ver lista", "Voir la liste", "Vedi lista", "Liste"]),
  listTitle: L6(["Cardápio em lista", "Full menu", "Carta completa", "Carte complète", "Menù completo", "Speisekarte"]),
  share: L6(["Compartilhar", "Share", "Compartir", "Partager", "Condividi", "Teilen"]),
  copied: L6(["Link copiado", "Link copied", "Enlace copiado", "Lien copié", "Link copiato", "Link kopiert"]),
  end: L6(["Fim do cardápio", "End of the menu", "Fin de la carta", "Fin de la carte", "Fine del menù", "Ende der Karte"]),
  lang: L6(["Idioma", "Language", "Idioma", "Langue", "Lingua", "Sprache"]),
  now: L6(["Cardápio em português", "Menu in English", "Carta en español", "Carte en français", "Menù in italiano", "Speisekarte auf Deutsch"]),
  back: L6(["Voltar", "Back", "Volver", "Retour", "Indietro", "Zurück"]),
  pause: L6(["Pausar", "Pause", "Pausar", "Pause", "Pausa", "Pausieren"]),
  resume: L6(["Continuar", "Resume", "Continuar", "Reprendre", "Riprendi", "Fortsetzen"]),
  close: L6(["Fechar", "Close", "Cerrar", "Fermer", "Chiudi", "Schließen"]),
  empty: L6([
    "O cardápio está sendo preparado.",
    "The menu is being prepared.",
    "La carta se está preparando.",
    "La carte est en préparation.",
    "Il menù è in preparazione.",
    "Die Speisekarte wird vorbereitet.",
  ]),
  open: L6(["Aberto", "Open", "Abierto", "Ouvert", "Aperto", "Geöffnet"]),
  closed: L6(["Fechado", "Closed", "Cerrado", "Fermé", "Chiuso", "Geschlossen"]),
  until: L6(["até {t}", "until {t}", "hasta las {t}", "jusqu’à {t}", "fino alle {t}", "bis {t}"]),
  opensAt: L6(["abre às {t}", "opens at {t}", "abre a las {t}", "ouvre à {t}", "apre alle {t}", "öffnet um {t}"]),
  opensOn: L6(["abre {d} às {t}", "opens {d} at {t}", "abre el {d} a las {t}", "ouvre {d} à {t}", "apre {d} alle {t}", "öffnet {d} um {t}"]),
  tomorrow: L6(["amanhã", "tomorrow", "mañana", "demain", "domani", "morgen"]),
  oAdd: L6(["Adicionar", "Add", "Añadir", "Ajouter", "Aggiungi", "Hinzufügen"]),
  oNote: L6(["Observação", "Note", "Nota", "Remarque", "Nota", "Hinweis"]),
  oChoose: L6(["Escolher tamanho e sabores", "Choose size and flavors", "Elegir tamaño y sabores", "Choisir taille et saveurs", "Scegli formato e gusti", "Größe und Sorten wählen"]),
  oInOrder: L6(["{n} no pedido", "{n} in order", "{n} en el pedido", "{n} dans la commande", "{n} nell'ordine", "{n} in der Bestellung"]),
  oItems: L6(["{n} itens", "{n} items", "{n} artículos", "{n} articles", "{n} articoli", "{n} Artikel"]),
  oItem1: L6(["1 item", "1 item", "1 artículo", "1 article", "1 articolo", "1 Artikel"]),
  oAdded: L6(["Adicionado", "Added", "Añadido", "Ajouté", "Aggiunto", "Hinzugefügt"]),
  oSize: L6(["Tamanho", "Size", "Tamaño", "Taille", "Formato", "Größe"]),
  oFlavors: L6(["Sabores", "Flavors", "Sabores", "Saveurs", "Gusti", "Sorten"]),
  oWhole: L6(["Inteira", "Whole", "Entera", "Entière", "Intera", "Ganz"]),
  oHalf: L6(["Meio a meio", "Half and half", "Mitad y mitad", "Moitié-moitié", "Metà e metà", "Halb und halb"]),
  oHalfAvg: L6(["Média de {a} e {b} = {c}", "Average of {a} and {b} = {c}", "Promedio de {a} y {b} = {c}", "Moyenne de {a} et {b} = {c}", "Media di {a} e {b} = {c}", "Durchschnitt aus {a} und {b} = {c}"]),
  oHalfPick: L6(["Escolha a outra metade abaixo.", "Pick the other half below.", "Elige la otra mitad abajo.", "Choisissez l'autre moitié ci-dessous.", "Scegli l'altra metà qui sotto.", "Wähle unten die andere Hälfte."]),
  oHalfNeed: L6(["Escolha o 2º sabor", "Pick the 2nd flavor", "Elige el 2º sabor", "Choisissez la 2e saveur", "Scegli il 2º gusto", "2. Sorte wählen"]),
  oNoteHint: L6(["Vai junto com este item para a cozinha.", "Goes to the kitchen with this item.", "Va a la cocina con este artículo.", "Part en cuisine avec cet article.", "Va in cucina con questo articolo.", "Geht mit diesem Artikel an die Küche."]),
  oNotePh: L6(["Ex.: sem cebola, molho à parte", "E.g. no onion, sauce on the side", "Ej.: sin cebolla, salsa aparte", "Ex. : sans oignon, sauce à part", "Es.: senza cipolla, salsa a parte", "Z. B. ohne Zwiebeln, Soße extra"]),
  oSave: L6(["Salvar", "Save", "Guardar", "Enregistrer", "Salva", "Speichern"]),
  oCart: L6(["Carrinho", "Cart", "Carrito", "Panier", "Carrello", "Warenkorb"]),
  oMine: L6(["Meus pedidos", "My orders", "Mis pedidos", "Mes commandes", "I miei ordini", "Meine Bestellungen"]),
  oYour: L6(["Seu pedido", "Your order", "Tu pedido", "Votre commande", "Il tuo ordine", "Deine Bestellung"]),
  oEdit: L6(["Editar", "Edit", "Editar", "Modifier", "Modifica", "Bearbeiten"]),
  oEditNote: L6(["Editar ou pôr observação", "Edit or add a note", "Editar o añadir nota", "Modifier ou ajouter une remarque", "Modifica o aggiungi nota", "Bearbeiten oder Hinweis hinzufügen"]),
  oRemove: L6(["Remover", "Remove", "Quitar", "Retirer", "Rimuovi", "Entfernen"]),
  oRemoved: L6(["{name} removido", "{name} removed", "{name} quitado", "{name} retiré", "{name} rimosso", "{name} entfernt"]),
  oUndo: L6(["Desfazer", "Undo", "Deshacer", "Annuler", "Annulla", "Rückgängig"]),
  oMore: L6(["Adicionar mais itens", "Add more items", "Añadir más", "Ajouter d'autres articles", "Aggiungi altro", "Mehr hinzufügen"]),
  oTotal: L6(["Total", "Total", "Total", "Total", "Totale", "Summe"]),
  oPayHere: L6(["Você paga a conta direto com o restaurante.", "You pay the bill directly to the restaurant.", "Pagas la cuenta directamente al restaurante.", "Vous réglez l'addition directement au restaurant.", "Il conto si paga direttamente al ristorante.", "Du bezahlst direkt beim Restaurant."]),
  oSlide: L6(["Deslize para enviar à cozinha", "Slide to send to the kitchen", "Desliza para enviar a la cocina", "Glissez pour envoyer en cuisine", "Scorri per inviare in cucina", "Zum Senden an die Küche schieben"]),
  oSending: L6(["Enviando…", "Sending…", "Enviando…", "Envoi…", "Invio…", "Wird gesendet…"]),
  oSent: L6(["Pedido enviado", "Order sent", "Pedido enviado", "Commande envoyée", "Ordine inviato", "Bestellung gesendet"]),
  oSentShort: L6(["Enviado", "Sent", "Enviado", "Envoyé", "Inviato", "Gesendet"]),
  oSentBody: L6(["A cozinha já recebeu o pedido {n} da {table}.", "The kitchen got order {n} from {table}.", "La cocina recibió el pedido {n} de {table}.", "La cuisine a reçu la commande {n} de {table}.", "La cucina ha ricevuto l'ordine {n} di {table}.", "Die Küche hat Bestellung {n} von {table} erhalten."]),
  oProgress: L6(["Ver andamento", "See progress", "Ver progreso", "Voir l'avancement", "Vedi stato", "Status ansehen"]),
  oBack: L6(["Voltar ao cardápio", "Back to menu", "Volver a la carta", "Retour au menu", "Torna al menù", "Zurück zur Karte"]),
  oOrderN: L6(["Pedido {n}", "Order {n}", "Pedido {n}", "Commande {n}", "Ordine {n}", "Bestellung {n}"]),
  oStNew: L6(["Recebido", "Received", "Recibido", "Reçue", "Ricevuto", "Erhalten"]),
  oStPrep: L6(["Preparando", "Preparing", "Preparando", "En préparation", "In preparazione", "In Zubereitung"]),
  oStReady: L6(["Pronto", "Ready", "Listo", "Prête", "Pronto", "Fertig"]),
  oReadyBody: L6(["Pedido {n} saindo", "Order {n} coming out", "Pedido {n} saliendo", "Commande {n} arrive", "Ordine {n} in arrivo", "Bestellung {n} kommt"]),
  oCallWaiter: L6(["Para mudar algo que já foi enviado, chame o garçom.", "To change something already sent, call the waiter.", "Para cambiar algo ya enviado, llama al camarero.", "Pour modifier une commande envoyée, appelez le serveur.", "Per cambiare qualcosa già inviato, chiama il cameriere.", "Um Gesendetes zu ändern, ruf die Bedienung."]),
  oEmpty: L6(["Seu carrinho está vazio", "Your cart is empty", "Tu carrito está vacío", "Votre panier est vide", "Il carrello è vuoto", "Dein Warenkorb ist leer"]),
  oEmptyBody: L6(["Toque em Adicionar em qualquer prato.", "Tap Add on any dish.", "Toca Añadir en cualquier plato.", "Touchez Ajouter sur un plat.", "Tocca Aggiungi su un piatto.", "Tippe bei einem Gericht auf Hinzufügen."]),
  oNoOrders: L6(["Nenhum pedido enviado", "No orders sent", "Ningún pedido enviado", "Aucune commande envoyée", "Nessun ordine inviato", "Keine Bestellungen gesendet"]),
  oNoOrdersBody: L6(["Os pedidos que você mandar para a cozinha aparecem aqui.", "Orders you send to the kitchen show up here.", "Los pedidos que envíes aparecen aquí.", "Vos commandes envoyées apparaissent ici.", "Gli ordini inviati appaiono qui.", "Gesendete Bestellungen erscheinen hier."]),
  oErrNet: L6(["Não foi possível enviar. Confira a internet e deslize de novo.", "Couldn't send. Check your connection and slide again.", "No se pudo enviar. Revisa la conexión y desliza de nuevo.", "Envoi impossible. Vérifiez la connexion et glissez à nouveau.", "Invio non riuscito. Controlla la connessione e riprova.", "Senden fehlgeschlagen. Prüfe die Verbindung und schiebe erneut."]),
  oErrInvalid: L6(["Não foi possível enviar este pedido. Revise o carrinho e deslize de novo.", "Couldn't send this order. Review your cart and slide again.", "No se pudo enviar este pedido. Revisa el carrito y desliza de nuevo.", "Impossible d'envoyer cette commande. Vérifiez le panier et glissez à nouveau.", "Impossibile inviare questo ordine. Controlla il carrello e riprova.", "Diese Bestellung konnte nicht gesendet werden. Prüfe den Warenkorb und schiebe erneut."]),
  // Oferta relâmpago (produtos especiais).
  oSpecialIntro: L6(["OFERTA RELÂMPAGO EM", "FLASH OFFER IN", "OFERTA RELÁMPAGO EN", "OFFRE ÉCLAIR DANS", "OFFERTA LAMPO TRA", "BLITZANGEBOT IN"]),
  oSpecialReady: L6(["Prepare o dedo. Não pisque.", "Get your finger ready. Don't blink.", "Prepara el dedo. No parpadees.", "Préparez votre doigt. Ne clignez pas des yeux.", "Prepara il dito. Non battere ciglio.", "Finger bereit. Nicht blinzeln."]),
  oSpecialGone: L6(["Acabou o tempo", "Time's up", "Se acabó el tiempo", "Temps écoulé", "Tempo scaduto", "Zeit abgelaufen"]),
  oSpecialGoneSub: L6(["Ela só volta muito mais tarde.", "It only comes back much later.", "Solo vuelve mucho más tarde.", "Elle ne revient que bien plus tard.", "Torna solo molto più tardi.", "Es kommt erst viel später wieder."]),
  oSpecialGot: L6(["Pegou! {price} garantido no seu pedido.", "Got it! {price} locked in your order.", "¡Listo! {price} garantizado en tu pedido.", "C'est à vous ! {price} garanti dans votre commande.", "Presa! {price} garantito nel tuo ordine.", "Geschnappt! {price} in deiner Bestellung gesichert."]),
  oSpecialFail: L6(["Não deu para garantir a oferta", "Couldn't lock in the offer", "No se pudo garantizar la oferta", "Impossible de garantir l'offre", "Non è stato possibile garantire l'offerta", "Das Angebot konnte nicht gesichert werden"]),
  oSpecialInvalid: L6(["Essa oferta já não vale", "This offer is no longer valid", "Esta oferta ya no es válida", "Cette offre n'est plus valable", "Questa offerta non è più valida", "Dieses Angebot gilt nicht mehr"]),
  oDoughGone: L6(["A massa escolhida não está mais disponível. Escolha de novo.", "The chosen dough is no longer available. Please choose again.", "La masa elegida ya no está disponible. Elige de nuevo.", "La pâte choisie n'est plus disponible. Choisissez à nouveau.", "L'impasto scelto non è più disponibile. Scegli di nuovo.", "Der gewählte Teig ist nicht mehr verfügbar. Bitte neu wählen."]),
  oSpecialKitchen: L6(["Oferta", "Offer", "Oferta", "Offre", "Offerta", "Angebot"]),
  oSpecialMax: L6(["Até {n} por oferta", "Up to {n} per offer", "Hasta {n} por oferta", "Jusqu'à {n} par offre", "Fino a {n} per offerta", "Bis zu {n} pro Angebot"]),
  oErrGone: L6(["O cardápio mudou: {name} não está mais disponível.", "The menu changed: {name} is no longer available.", "La carta cambió: {name} ya no está disponible.", "Le menu a changé : {name} n'est plus disponible.", "Il menù è cambiato: {name} non è più disponibile.", "Die Karte hat sich geändert: {name} ist nicht mehr verfügbar."]),
  oErrPrice: L6(["Os preços mudaram. Total enviado: {total}.", "Prices changed. Total sent: {total}.", "Los precios cambiaron. Total enviado: {total}.", "Les prix ont changé. Total envoyé : {total}.", "I prezzi sono cambiati. Totale inviato: {total}.", "Preise geändert. Gesendete Summe: {total}."]),
  oErrClosed: L6(["Fechado agora.", "Closed now.", "Cerrado ahora.", "Fermé maintenant.", "Chiuso ora.", "Jetzt geschlossen."]),
  oErrClosedAt: L6(["Fechado agora. Abre às {time}.", "Closed now. Opens at {time}.", "Cerrado ahora. Abre a las {time}.", "Fermé. Ouvre à {time}.", "Chiuso ora. Apre alle {time}.", "Jetzt geschlossen. Öffnet um {time}."]),
  oErrTable: L6(["Esta mesa não está recebendo pedidos. Chame o garçom.", "This table isn't taking orders. Please call the waiter.", "Esta mesa no recibe pedidos. Llama al camarero.", "Cette table ne prend pas de commandes. Appelez le serveur.", "Questo tavolo non accetta ordini. Chiama il cameriere.", "Dieser Tisch nimmt keine Bestellungen an. Ruf die Bedienung."]),
  oLess: L6(["Menos um", "One less", "Uno menos", "Un de moins", "Uno in meno", "Einer weniger"]),
  oMoreOne: L6(["Mais um", "One more", "Uno más", "Un de plus", "Uno in più", "Einer mehr"]),
  oClose: L6(["Fechar", "Close", "Cerrar", "Fermer", "Chiudi", "Schließen"]),
  // Folha de vidro (pedido em 15/10/2026)
  oGo: L6(["Pedir agora", "Order now", "Pedir ahora", "Commander", "Ordina ora", "Jetzt bestellen"]),
  oAsk: L6(["Pedir", "Order", "Pedir", "Commander", "Ordina", "Bestellen"]),
  oHalfBtn: L6(["Metade", "Half", "Mitad", "Moitié", "Metà", "Hälfte"]),
  oPizza: L6(["Pizza", "Pizza", "Pizza", "Pizza", "Pizza", "Pizza"]),
  oDough: L6(["Massa", "Crust", "Masa", "Pâte", "Impasto", "Teig"]),
  oOtherHalf: L6(["Outra metade", "Other half", "Otra mitad", "Autre moitié", "Altra metà", "Andere Hälfte"]),
  oPick: L6(["Escolher", "Choose", "Elegir", "Choisir", "Scegli", "Wählen"]),
  oPickNav: L6(["Navegue até o outro sabor", "Browse to the other flavor", "Ve hasta el otro sabor", "Allez jusqu'à l'autre saveur", "Vai all'altro gusto", "Blättern Sie zur anderen Sorte"]),
  oPickOther: L6(["Vá para outro sabor", "Go to another flavor", "Ve a otro sabor", "Allez à une autre saveur", "Vai a un altro gusto", "Zu einer anderen Sorte"]),
  oPickPizza: L6(["Escolha uma pizza", "Choose a pizza", "Elige una pizza", "Choisissez une pizza", "Scegli una pizza", "Wählen Sie eine Pizza"]),
  oSwapping: L6(["Trocando ½ {name}", "Replacing ½ {name}", "Cambiando ½ {name}", "Remplace ½ {name}", "Sostituisci ½ {name}", "Ersetze ½ {name}"]),
  oSwap: L6(["trocar", "change", "cambiar", "changer", "cambia", "ändern"]),
  oCancelHalf: L6(["Cancelar meio a meio", "Cancel half and half", "Cancelar mitad y mitad", "Annuler moitié-moitié", "Annulla metà e metà", "Halb und halb abbrechen"]),
  oDoneEdit: L6(["Pronto", "Done", "Listo", "OK", "Fatto", "Fertig"]),
  oDelete: L6(["Excluir", "Delete", "Eliminar", "Supprimer", "Elimina", "Löschen"]),
  oContinue: L6(["Continuar pedindo", "Keep ordering", "Seguir pidiendo", "Continuer à commander", "Continua a ordinare", "Weiter bestellen"]),
  oMinimize: L6(["Comprimir", "Minimize", "Minimizar", "Réduire", "Riduci", "Minimieren"]),
  oGoCart: L6(["Ir para o fechamento do pedido", "Go to checkout", "Ir al cierre del pedido", "Aller à la validation", "Vai al riepilogo", "Zur Bestellung"]),
  oNoteAdd: L6(["Adicionar", "Add", "Añadir", "Ajouter", "Aggiungi", "Hinzufügen"]),
  oOnePizza: L6(["1 pizza", "1 pizza", "1 pizza", "1 pizza", "1 pizza", "1 Pizza"]),
  oUnit1: L6(["1 unidade", "1 unit", "1 unidad", "1 unité", "1 unità", "1 Stück"]),
  oUnits: L6(["{n} unidades", "{n} units", "{n} unidades", "{n} unités", "{n} unità", "{n} Stück"]),
  oInBag: L6(["no pedido", "in your order", "en el pedido", "dans la commande", "nell'ordine", "in der Bestellung"]),
  hint: L6([
    "Toque para avançar · deslize para trocar",
    "Tap to advance · swipe to switch",
    "Toca para avanzar · desliza para cambiar",
    "Touchez pour avancer · glissez pour changer",
    "Tocca per avanzare · scorri per cambiare",
    "Tippen zum Weiter · wischen zum Wechseln",
  ]),
  // Cardápio em lista (19/10). Em listHint, o trecho entre {b} e {/b} sai em negrito na cor do restaurante.
  listCats: L6(["Categorias", "Categories", "Categorías", "Catégories", "Categorie", "Kategorien"]),
  listSearch: L6(["Buscar no cardápio", "Search the menu", "Buscar en la carta", "Rechercher dans la carte", "Cerca nel menù", "Speisekarte durchsuchen"]),
  listHint: L6([
    "Toque no produto para {b}ver foto{/b} e a descrição.",
    "Tap a dish to {b}see the photo{/b} and description.",
    "Toca un plato para {b}ver la foto{/b} y la descripción.",
    "Touchez un plat pour {b}voir la photo{/b} et la description.",
    "Tocca un piatto per {b}vedere la foto{/b} e la descrizione.",
    "Tippe auf ein Gericht für {b}Foto{/b} und Beschreibung.",
  ]),
  listHintClose: L6(["Fechar dica", "Close tip", "Cerrar consejo", "Fermer l’astuce", "Chiudi suggerimento", "Hinweis schließen"]),
  item: L6(["item", "item", "plato", "plat", "piatto", "Gericht"]),
  viewStories: L6(["Stories", "Stories", "Stories", "Stories", "Stories", "Stories"]),
  backToList: L6(["Lista", "List", "Lista", "Liste", "Lista", "Liste"]),
  searchEmpty: L6([
    "Nada encontrado para “{q}”.",
    "Nothing found for “{q}”.",
    "No se encontró nada para “{q}”.",
    "Rien trouvé pour « {q} ».",
    "Nessun risultato per “{q}”.",
    "Nichts gefunden für „{q}“.",
  ]),
  searchCount: L6([
    "Resultados para “{q}”: {n}",
    "Results for “{q}”: {n}",
    "Resultados para “{q}”: {n}",
    "Résultats pour « {q} » : {n}",
    "Risultati per “{q}”: {n}",
    "Ergebnisse für „{q}“: {n}",
  ]),
};

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, lang: string) {
  const row = STRINGS[key];
  return row[lang] ?? row[lang.slice(0, 2)] ?? row["pt-BR"];
}

// Texto com variáveis: tf("oInOrder", lang, { n: 2 }) -> "2 no pedido".
export function tf(key: StringKey, lang: string, vars: Record<string, string | number>) {
  return t(key, lang).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

// Idioma inicial: escolha salva, senão o idioma do celular, senão português.
export function pickLanguage(available: string[], saved: string | null, browser: readonly string[]) {
  if (saved && available.includes(saved)) return saved;
  for (const b of browser) {
    const exact = available.find((a) => a.toLowerCase() === b.toLowerCase());
    if (exact) return exact;
    const base = available.find((a) => a.slice(0, 2) === b.slice(0, 2).toLowerCase());
    if (base) return base;
  }
  return available.includes("pt-BR") ? "pt-BR" : (available[0] ?? "pt-BR");
}
