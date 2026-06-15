export interface TaxonomyRecord {
  domain: string;
  kingdom: string;
  phylum: string;
  className: string;
  order: string;
  family: string;
  genus: string;
  species: string;
  fullTaxonomy: string;
  abundances: Record<string, number>;
}

export interface TaxonomyFilters {
  domain?: string;
  kingdom?: string;
  phylum?: string;
  className?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

export interface BarcodeTaxonContribution {
  fullTaxonomy: string;
  genus: string;
  species: string;
  abundance: number;
}

export interface BarcodeResult {
  barcode: string;
  abundance: number;
  positive: boolean;
  contributions: BarcodeTaxonContribution[];
}

export interface ParsedAbundanceTable {
  fileName: string;
  barcodeNames: string[];
  records: TaxonomyRecord[];
  warnings: string[];
}

export type TaxonomyLevel = keyof TaxonomyFilters;

export interface TaxonomyLevelDefinition {
  key: TaxonomyLevel;
  label: string;
  csvHeader: string;
}

export const TAXONOMY_LEVELS: readonly TaxonomyLevelDefinition[] = [
  { key: 'domain', label: 'Dominio', csvHeader: 'dominio' },
  { key: 'kingdom', label: 'Reino', csvHeader: 'reino' },
  { key: 'phylum', label: 'Filo', csvHeader: 'filo' },
  { key: 'className', label: 'Clase', csvHeader: 'clase' },
  { key: 'order', label: 'Orden', csvHeader: 'orden' },
  { key: 'family', label: 'Familia', csvHeader: 'familia' },
  { key: 'genus', label: 'Género', csvHeader: 'genero' },
  { key: 'species', label: 'Especie', csvHeader: 'especie' },
] as const;

export const UNKNOWN_TAXONOMY_VALUE = 'Unknown';
