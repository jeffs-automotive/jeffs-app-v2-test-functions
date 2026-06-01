// Assembles the canonical concern catalog from the per-category data files.
// Public API is unchanged: `import { CANONICAL_CATALOG } from ".../canonical-concern-catalog.ts"`.

import type { CanonicalCategory } from "./types.ts";
import { brakes } from "./categories/brakes.ts";
import { electrical } from "./categories/electrical.ts";
import { hvac } from "./categories/hvac.ts";
import { leak } from "./categories/leak.ts";
import { noise } from "./categories/noise.ts";
import { other } from "./categories/other.ts";
import { performance } from "./categories/performance.ts";
import { pulling } from "./categories/pulling.ts";
import { smell } from "./categories/smell.ts";
import { smoke } from "./categories/smoke.ts";
import { steering } from "./categories/steering.ts";
import { tires } from "./categories/tires.ts";
import { vibration } from "./categories/vibration.ts";
import { warningLight } from "./categories/warning-light.ts";

export type { CanonicalQuestion, CanonicalSubcategory, CanonicalCategory } from "./types.ts";

export const CANONICAL_CATALOG: CanonicalCategory[] = [
  brakes,
  electrical,
  hvac,
  leak,
  noise,
  other,
  performance,
  pulling,
  smell,
  smoke,
  steering,
  tires,
  vibration,
  warningLight,
];
