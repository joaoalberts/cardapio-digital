// Gravação no celular: formato preferido (mp4 no iPhone, webm no Android), navegador dentro
// de app e os erros da câmera com texto claro em português.
import { describe, expect, it } from "vitest";
import {
  CAMERA_CONSTRAINTS, CLIP_MS, inAppBrowser, MAX_BYTES, pickMime, PROBLEM_TEXT, recordingProblem, REDO_MAX,
} from "./recording";

describe("constantes", () => {
  it("6 s, 8 MB e 3 regravações", () => {
    expect(CLIP_MS).toBe(6_000);
    expect(MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(REDO_MAX).toBe(3);
  });

  it("câmera frontal, ideal 1080x1920 em 9:16, com áudio", () => {
    const v = CAMERA_CONSTRAINTS.video as MediaTrackConstraints;
    expect(v.facingMode).toBe("user");
    expect(v.width).toEqual({ ideal: 1080 });
    expect(v.height).toEqual({ ideal: 1920 });
    expect(v.aspectRatio).toEqual({ ideal: 9 / 16 });
    expect(CAMERA_CONSTRAINTS.audio).toBe(true);
  });
});

describe("pickMime", () => {
  const only = (...ok: string[]) => (t: string) => ok.includes(t);
  it("prefere mp4 com avc1 (iPhone)", () => {
    expect(pickMime(() => true)).toBe("video/mp4;codecs=avc1");
  });
  it("depois mp4, vp9, vp8 e webm", () => {
    expect(pickMime(only("video/mp4", "video/webm"))).toBe("video/mp4");
    expect(pickMime(only("video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"))).toBe("video/webm;codecs=vp9");
    expect(pickMime(only("video/webm;codecs=vp8", "video/webm"))).toBe("video/webm;codecs=vp8");
    expect(pickMime(only("video/webm"))).toBe("video/webm");
  });
  it("nada aceito → null", () => {
    expect(pickMime(() => false)).toBeNull();
  });
  it("isSupported que lança conta como não aceito", () => {
    expect(
      pickMime((t) => {
        if (t.startsWith("video/mp4")) throw new Error("x");
        return t === "video/webm";
      }),
    ).toBe("video/webm");
  });
});

describe("inAppBrowser", () => {
  const IG =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92 (iPhone14,5; iOS 17_5; pt_BR; pt; scale=3.00; 1170x2532; 598262131)";
  const FB =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBBV/601335346;FBDV/iPhone14,5]";
  const FB_ANDROID =
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/466.0.0.0.0;]";
  const WA = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 WhatsApp/2.24.10";
  const SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

  it("reconhece Instagram, Facebook e WhatsApp", () => {
    expect(inAppBrowser(IG)).toBe("instagram");
    expect(inAppBrowser(FB)).toBe("facebook");
    expect(inAppBrowser(FB_ANDROID)).toBe("facebook");
    expect(inAppBrowser(WA)).toBe("whatsapp");
  });
  it("Safari e Chrome → null", () => {
    expect(inAppBrowser(SAFARI)).toBeNull();
    expect(inAppBrowser(CHROME)).toBeNull();
    expect(inAppBrowser("")).toBeNull();
  });
});

describe("recordingProblem", () => {
  const err = (name: string) => Object.assign(new Error(name), { name });
  it("mapeia os erros do getUserMedia", () => {
    expect(recordingProblem(err("NotAllowedError"))).toBe("denied");
    expect(recordingProblem(err("SecurityError"))).toBe("denied");
    expect(recordingProblem(err("NotFoundError"))).toBe("no_camera");
    expect(recordingProblem(err("OverconstrainedError"))).toBe("no_camera");
    expect(recordingProblem(err("NotReadableError"))).toBe("busy");
  });
  it("sem mediaDevices (TypeError) ou qualquer outra coisa → unsupported", () => {
    expect(recordingProblem(new TypeError("Cannot read properties of undefined (reading 'getUserMedia')"))).toBe("unsupported");
    expect(recordingProblem(undefined)).toBe("unsupported");
    expect(recordingProblem("x")).toBe("unsupported");
  });
});

describe("PROBLEM_TEXT", () => {
  it("todos em pt-BR, sem CAIXA ALTA", () => {
    for (const t of Object.values(PROBLEM_TEXT)) {
      expect(t.length).toBeGreaterThan(10);
      expect(t).not.toMatch(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\b/);
    }
  });
  it("in_app pede para abrir no navegador", () => {
    expect(PROBLEM_TEXT.in_app).toMatch(/navegador/);
    expect(PROBLEM_TEXT.in_app).toMatch(/abr/i);
  });
  it("tem os seis casos", () => {
    expect(Object.keys(PROBLEM_TEXT).sort()).toEqual(["busy", "denied", "in_app", "no_camera", "too_big", "unsupported"]);
  });
});
