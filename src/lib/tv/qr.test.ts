import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { QR_ECC, qrLink } from "./qr";

describe("qrLink: o endereço mais curto para o QR do telão", () => {
  it("só esquema, host e slug", () => {
    expect(qrLink("https", "cardapio.app", "forno")).toBe("https://cardapio.app/forno");
    expect(qrLink("http", "localhost:3000", "forno")).toBe("http://localhost:3000/forno");
  });
  it("host em minúsculas, o primeiro da lista do proxy e sem a porta padrão", () => {
    expect(qrLink("https", "Cardapio.APP", "forno")).toBe("https://cardapio.app/forno");
    expect(qrLink("https", "cardapio.app, interno.local", "forno")).toBe("https://cardapio.app/forno");
    expect(qrLink("https", "cardapio.app:443", "forno")).toBe("https://cardapio.app/forno");
    expect(qrLink("http", "cardapio.app:80", "forno")).toBe("http://cardapio.app/forno");
    expect(qrLink("HTTPS, http", "cardapio.app", "forno")).toBe("https://cardapio.app/forno");
  });
  it("sem host, o caminho relativo", () => {
    expect(qrLink("https", "", "forno")).toBe("/forno");
  });
  it("correção de erro L: o QR do link local cabe numa versão menor que com M", () => {
    expect(QR_ECC).toBe("L");
    const link = qrLink("http", "localhost:3000", "pizzaria-teste");
    expect(QRCode.create(link, { errorCorrectionLevel: QR_ECC }).version).toBeLessThan(
      QRCode.create(link, { errorCorrectionLevel: "M" }).version,
    );
  });
});
