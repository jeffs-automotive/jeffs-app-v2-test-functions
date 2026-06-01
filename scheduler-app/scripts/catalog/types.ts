// Canonical catalog type definitions. Extracted from canonical-concern-catalog.ts
// (file-size-refactor batch 1). The data lives in ./option-presets.ts + ./categories/*.

export interface CanonicalQuestion {
  text: string;
  multi_select: boolean;
  options: Array<{ label: string; value: string }>;
}

export interface CanonicalSubcategory {
  slug: string;
  display_label: string;
  display_order: number;
  questions: CanonicalQuestion[];
}

export interface CanonicalCategory {
  category: string;
  subcategories: CanonicalSubcategory[];
}

// Shared option presets to keep the file readable.
