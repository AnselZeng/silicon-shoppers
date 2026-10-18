// Vocabulary bridges (H&M data -> demo store). Ported unchanged from
// backend/server/app/lib/model/adapter.ts; they match the backend's ranking (score.py rank_store treats
// women as Ladieswear + Divided) and the Python side (server/catalog.py).

import type { StoreColor } from "@/config/ui"
import type { HMCategory, HMDepartment } from "@/lib/model/homepage"
import type { Category, Department } from "@/lib/store/types"

/** Demo-store categories that belong to each H&M product group. */
export const HM_TO_APP_CATEGORIES: Record<HMCategory, Category[]> = {
  cat_garment_upper_body: ["tshirts", "shirts", "knitwear", "jackets", "coats"],
  cat_garment_lower_body: ["jeans", "trousers", "skirts"],
  cat_garment_full_body: ["dresses"],
  cat_shoes: ["shoes"],
  cat_accessories: ["bags"],
  cat_swimwear: [],
  cat_underwear: [],
  cat_other: [],
}

export const APP_TO_HM_CATEGORY = Object.fromEntries(
  (Object.entries(HM_TO_APP_CATEGORIES) as [HMCategory, Category[]][]).flatMap(([hm, cats]) =>
    cats.map((c) => [c, hm]),
  ),
) as Record<Category, HMCategory>

/** H&M master colors that have a demo-store equivalent. */
export const HM_TO_APP_COLOR: Record<string, StoreColor> = {
  Black: "black",
  White: "white",
  Beige: "beige",
  Blue: "navy",
  Grey: "grey",
  "Khaki green": "olive",
  Red: "burgundy",
  Brown: "brown",
  Mole: "brown",
}

/** Sport and Baby/Children have no store counterpart and are ignored. */
export const HM_TO_APP_DEPARTMENT: Partial<Record<HMDepartment, Department>> = {
  dept_ladieswear: "women",
  dept_divided: "women",
  dept_menswear: "men",
}
