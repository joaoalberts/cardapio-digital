// Gravação no celular: formato preferido (mp4 no iPhone, webm no Android), navegador dentro
// de app e os erros da câmera com texto claro em português.
import { describe, expect, it } from "vitest";
import {
  CAMERA_CONSTRAINTS, cameraConstraints, canRedo, zoomReset, CLIP_MS, FLOW_START, flowNext, inAppBrowser, MAX_BYTES, MIN_CLIP_MS, pickMime, PROBLEM_TEXT, recordingProblem, REDO_MAX,
  type FlowEvent, type FlowState,
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

  it("câmera traseira no quadro nativo, sem forçar 9:16 (evita o zoom)", () => {
    const v = cameraConstraints("environment").video as MediaTrackConstraints;
    expect(v.facingMode).toBe("environment");
    expect(v.aspectRatio).toBeUndefined();
    expect(v).toMatchObject({ width: { ideal: 1920 }, height: { ideal: 1080 } });
    expect(cameraConstraints("environment").audio).toBe(true);
  });

  it("zoomReset volta a 1x dentro do intervalo do aparelho", () => {
    expect(zoomReset(undefined, 2)).toBeNull();
    expect(zoomReset({ min: 1, max: 10 }, 2)).toBe(1);
    expect(zoomReset({ min: 1, max: 10 }, 1)).toBeNull();
    expect(zoomReset({ min: 0.5, max: 10 }, 0.5)).toBe(1);
    expect(zoomReset({ min: 2, max: 10 }, 3)).toBe(2);
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

describe("flowNext (fluxo da tela do cliente)", () => {
  const at = (step: FlowState["step"], extra: Partial<FlowState> = {}): FlowState => ({ step, redos: 0, count: 0, ...extra });
  const run = (s: FlowState, ...events: FlowEvent[]) => events.reduce(flowNext, s);

  it("começa no intro, sem regravação", () => {
    expect(FLOW_START).toEqual({ step: "intro", redos: 0, count: 0 });
  });

  it("intro → câmera → contagem 3, 2, 1 → gravando → revisão", () => {
    let s = flowNext(FLOW_START, { type: "consent_ok" });
    expect(s.step).toBe("camera");
    s = flowNext(s, { type: "ready" });
    expect(s).toMatchObject({ step: "countdown", count: 3 });
    s = flowNext(s, { type: "tick" });
    expect(s).toMatchObject({ step: "countdown", count: 2 });
    s = flowNext(s, { type: "tick" });
    expect(s).toMatchObject({ step: "countdown", count: 1 });
    s = flowNext(s, { type: "tick" });
    expect(s).toMatchObject({ step: "recording", count: 0 });
    s = flowNext(s, { type: "elapsed", ms: 6_000, bytes: 1_000_000 });
    expect(s.step).toBe("review");
  });

  it("depois de enviar, \"again\" volta ao início com as regravações zeradas", () => {
    expect(flowNext(at("queue", { redos: 3 }), { type: "again" })).toEqual(FLOW_START);
    expect(flowNext(at("review"), { type: "again" }).step).toBe("review");
  });

  it("parar antes dos 6 s vai para a revisão", () => {
    expect(flowNext(at("recording"), { type: "elapsed", ms: 4_000, bytes: 10 }).step).toBe("review");
    expect(flowNext(at("recording"), { type: "elapsed", ms: MIN_CLIP_MS, bytes: 10 }).step).toBe("review");
  });

  it("abaixo do mínimo descarta e volta à câmera sem gastar regravação", () => {
    expect(flowNext(at("recording", { redos: 1 }), { type: "elapsed", ms: MIN_CLIP_MS - 1, bytes: 10 })).toEqual({ step: "camera", redos: 1, count: 0 });
  });

  it("blob acima de MAX_BYTES → problema too_big", () => {
    const s = flowNext(at("recording"), { type: "elapsed", ms: CLIP_MS, bytes: MAX_BYTES + 1 });
    expect(s).toMatchObject({ step: "problem", problem: "too_big" });
    expect(flowNext(at("recording"), { type: "elapsed", ms: CLIP_MS, bytes: MAX_BYTES }).step).toBe("review");
  });

  it("regravar volta à contagem só enquanto redos < 3; na 4ª o botão some", () => {
    let s = at("review");
    for (let i = 1; i <= REDO_MAX; i++) {
      expect(canRedo(s)).toBe(true);
      s = flowNext(s, { type: "redo" });
      expect(s).toMatchObject({ step: "countdown", count: 3, redos: i });
      s = run(s, { type: "tick" }, { type: "tick" }, { type: "tick" }, { type: "elapsed", ms: CLIP_MS, bytes: 10 });
      expect(s.step).toBe("review");
    }
    expect(s.redos).toBe(3);
    expect(canRedo(s)).toBe(false);
    expect(flowNext(s, { type: "redo" })).toEqual(s);
  });

  it("enviar → enviando → na fila", () => {
    let s = flowNext(at("review", { redos: 2 }), { type: "send" });
    expect(s.step).toBe("sending");
    s = flowNext(s, { type: "sent" });
    expect(s).toMatchObject({ step: "queue", redos: 2 });
  });

  it("erro no envio volta à revisão, com aviso e o mesmo número de regravações", () => {
    const s = run(at("review", { redos: 1 }), { type: "send" }, { type: "send_failed" });
    expect(s).toMatchObject({ step: "review", redos: 1, sendError: true });
    expect(flowNext(s, { type: "send" })).toMatchObject({ step: "sending", sendError: false });
  });

  it("problema da câmera a partir de qualquer passo; tentar de novo reabre a câmera", () => {
    const s = flowNext(at("camera"), { type: "problem", problem: "denied" });
    expect(s).toMatchObject({ step: "problem", problem: "denied" });
    const back = flowNext(s, { type: "retry" });
    expect(back.step).toBe("camera");
    expect(back.problem).toBeUndefined();
  });

  it("depois de too_big, gravar de novo volta à contagem sem gastar regravação", () => {
    const s = flowNext(at("recording", { redos: 1 }), { type: "elapsed", ms: CLIP_MS, bytes: MAX_BYTES + 1 });
    expect(flowNext(s, { type: "retry" })).toMatchObject({ step: "countdown", count: 3, redos: 1 });
  });

  it("eventos fora de hora não mudam nada", () => {
    expect(flowNext(FLOW_START, { type: "send" })).toEqual(FLOW_START);
    expect(flowNext(at("queue"), { type: "redo" })).toEqual(at("queue"));
    expect(flowNext(at("review"), { type: "tick" })).toEqual(at("review"));
    expect(flowNext(at("sending"), { type: "redo" })).toEqual(at("sending"));
  });

  it("cancelar volta ao intro (câmera, contagem, gravação, revisão e problema), sem zerar as regravações", () => {
    for (const step of ["camera", "countdown", "recording", "review", "problem"] as const) {
      const s = flowNext(at(step, { redos: 2, count: 2, problem: "denied" }), { type: "cancel" });
      expect(s.step).toBe("intro");
      expect(s.redos).toBe(2);
      expect(s.problem).toBeUndefined();
    }
    expect(flowNext(at("sending"), { type: "cancel" })).toEqual(at("sending"));
    expect(flowNext(at("queue"), { type: "cancel" })).toEqual(at("queue"));
  });

  it("na fila, um problema não tira o cliente da fila", () => {
    expect(flowNext(at("queue"), { type: "problem", problem: "busy" })).toEqual(at("queue"));
  });
});
