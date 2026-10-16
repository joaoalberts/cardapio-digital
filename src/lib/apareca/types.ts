import type { OpeningHours } from "@/lib/menu/types";

export type ModMode = "manual" | "hibrido" | "automatico";
export type Zone = { id: string; name: string };
export type ScheduleRule = { kind: "intercalar"; house_every: number; clients_max: number };
export type AparecaConfig = {
  mode: ModMode; rule: ScheduleRule; plays: 1 | 2 | 3; device_per_hour: number;
  hours: { from: string; to: string } | null; retention_h: number; zones: Zone[];
  table_zones: Record<string, string>; tv_zones: Record<string, string>;
};
export type VideoStatus =
  | "uploading" | "processing" | "ai_review" | "pending" | "approved" | "rejected" | "removed" | "failed";
export type VideoRow = {
  Id: number; id: string; restaurant_id: string; kind: "cliente"; table_id: string | null; zone_id: string | null;
  device_id: string; name: string | null; consent_at: string; mux_upload_id: string; mux_asset_id: string | null;
  mux_playback_id: string | null; duration_ms: number | null; status: VideoStatus; decided_by: "equipe" | "ia" | null;
  decided_at: string | null; ai_reason: string | null; plays: number; plays_target: number; first_shown_at: string | null;
  downloads: number; expires_at: string; created_at: string;
};
export type HouseVideoRow = {
  Id: number; id: string; restaurant_id: string; title: string; mux_upload_id: string;
  mux_asset_id: string | null; mux_playback_id: string | null; duration_ms: number | null; aspect: string | null;
  position: number; active: boolean; status: "processing" | "ready" | "failed"; created_at: string;
};
export type TallyCounts = {
  sent: number; approved: number; rejected: number; ai_rejected: number; removed: number;
  shown: number; downloads: number; encoded_s: number; played_s: number; mp4_s: number;
};
export type AparecaTallyRow = {
  id: string; restaurant_id: string; day: string; month: string; counts: Partial<TallyCounts>; hours: number[];
  created_at: string;
};
export type AparecaHead = {
  id: string; slug: string; name: string; timezone: string; opening_hours: OpeningHours | null;
  allowed: boolean; ai_allowed: boolean; enabled: boolean; community_enabled: boolean; config: AparecaConfig;
  logo_path: string | null; brand_color: string | null; instagram: string | null;
};
export type FeatureState =
  | { on: true }
  | { on: false; why: "off" | "not_allowed" | "disabled" | "no_community" | "closed" | "paused" };
