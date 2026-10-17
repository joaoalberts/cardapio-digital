import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { QR_ECC, qrLink } from "./qr";

describe("qrLink: o endereço mais curto para o QR do telão e do story", () => {
  it("só esquema, host, slug e ?ref", () => {
    expect(qrLink("https", "cardapio.app", "forno", "telao")).toBe("https://cardapio.app/forno?ref=telao");
    expect(qrLink("http", "localhost:3000", "forno", "story")).toBe("http://localhost:3000/forno?ref=story");
  });
  it("host em minúsculas, o primeiro da lista do proxy e sem a porta padrão", () => {
    expect(qrLink("https", "Cardapio.APP", "forno", "story")).toBe("https://cardapio.app/forno?ref=story");
    expect(qrLink("https", "cardapio.app, interno.local", "forno", "story")).toBe("https://cardapio.app/forno?ref=story");
    expect(qrLink("https", "cardapio.app:443", "forno", "telao")).toBe("https://cardapio.app/forno?ref=telao");
    expect(qrLink("http", "cardapio.app:80", "forno", "telao")).toBe("http://cardapio.app/forno?ref=telao");
    expect(qrLink("HTTPS, http", "cardapio.app", "forno", "telao")).toBe("https://cardapio.app/forno?ref=telao");
  });
  it("sem host, o caminho relativo", () => {
    expect(qrLink("https", "", "forno", "telao")).toBe("/forno?ref=telao");
  });
  it("correção de erro L: o QR do link local cabe numa versão menor que com M", () => {
    expect(QR_ECC).toBe("L");
    const link = qrLink("http", "localhost:3000", "pizzaria-teste", "telao");
    expect(QRCode.create(link, { errorCorrectionLevel: QR_ECC }).version).toBeLessThan(
      QRCode.create(link, { errorCorrectionLevel: "M" }).version,
    );
  });
});
