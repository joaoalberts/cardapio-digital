import {
  Barlow,
  Big_Shoulders,
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Italiana,
  Jost,
  Karla,
  Pirata_One,
  Work_Sans,
  Yesteryear,
} from "next/font/google";

// Todas declaradas, nenhuma pré-carregada: o navegador só baixa a fonte que o tema usa.

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", preload: false, axes: ["wdth", "opsz"], variable: "--f-bricolage" });
const bigShoulders = Big_Shoulders({ subsets: ["latin"], display: "swap", preload: false, weight: ["800"], variable: "--f-bigshoulders" });
const workSans = Work_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-worksans" });
const italiana = Italiana({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--f-italiana" });
const jost = Jost({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-jost" });
const yesteryear = Yesteryear({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--f-yesteryear" });
const karla = Karla({ subsets: ["latin"], display: "swap", preload: false, variable: "--f-karla" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], display: "swap", preload: false, weight: ["600"], variable: "--f-plexmono" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--f-plexsans" });
const pirata = Pirata_One({ subsets: ["latin"], display: "swap", preload: false, weight: "400", variable: "--f-pirata" });
const barlow = Barlow({ subsets: ["latin"], display: "swap", preload: false, weight: ["400", "500", "600"], variable: "--f-barlow" });

export const fontVariables = [
  bricolage,
  bigShoulders,
  workSans,
  italiana,
  jost,
  yesteryear,
  karla,
  plexMono,
  plexSans,
  pirata,
  barlow,
]
  .map((f) => f.variable)
  .join(" ");
