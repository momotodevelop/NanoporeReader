import {
  BarcodeResult,
  BarcodeTaxonContribution,
  ParsedAbundanceTable,
  TAXONOMY_LEVELS,
  TaxonomyFilters,
  TaxonomyLevel,
  TaxonomyRecord,
  UNKNOWN_TAXONOMY_VALUE,
} from './taxonomy-analysis.models';

const BARCODE_HEADER_PATTERN = /^barcode\d+$/;

export function parseAbundanceTableText(text: string, fileName: string): ParsedAbundanceTable {
  const normalizedText = text.replace(/^\uFEFF/, '');

  if (normalizedText.trim().length === 0) {
    throw new Error('El archivo esta vacio.');
  }

  const lines = normalizedText.split(/\r?\n/);
  const headerLine = lines.find((line) => line.trim().length > 0);

  if (!headerLine) {
    throw new Error('El archivo esta vacio.');
  }

  const headers = headerLine.split('\t').map((header) => header.trim().replace(/^\uFEFF/, ''));
  const taxColumnIndex = headers.findIndex((header) => header === 'tax');

  if (taxColumnIndex === -1) {
    throw new Error('No se encontro la columna tax en el archivo TSV.');
  }

  const barcodeColumns = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => BARCODE_HEADER_PATTERN.test(header));

  if (barcodeColumns.length === 0) {
    throw new Error('No se encontraron columnas barcodeXX en el archivo TSV.');
  }

  const warnings: string[] = [];
  const records: TaxonomyRecord[] = [];
  let nonNumericCount = 0;
  let negativeCount = 0;
  let shortenedRowCount = 0;
  const nonNumericExamples: string[] = [];
  const negativeExamples: string[] = [];

  const headerLineIndex = lines.indexOf(headerLine);
  for (let lineIndex = headerLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (!line || line.trim().length === 0) {
      continue;
    }

    const cells = line.split('\t');

    if (cells.every((cell) => cell.trim().length === 0)) {
      continue;
    }

    if (cells.length < headers.length) {
      shortenedRowCount += 1;
    }

    const taxonomyParts = splitTaxonomy(cells[taxColumnIndex] ?? '');
    const abundances: Record<string, number> = {};

    for (const { header, index } of barcodeColumns) {
      const parsedValue = parseAbundanceValue(cells[index] ?? '');
      abundances[header] = parsedValue.value;

      if (parsedValue.kind === 'non-numeric') {
        nonNumericCount += 1;
        collectExample(nonNumericExamples, `fila ${lineIndex + 1}, ${header}`);
      } else if (parsedValue.kind === 'negative') {
        negativeCount += 1;
        collectExample(negativeExamples, `fila ${lineIndex + 1}, ${header}`);
      }
    }

    records.push({
      domain: taxonomyParts[0],
      kingdom: taxonomyParts[1],
      phylum: taxonomyParts[2],
      className: taxonomyParts[3],
      order: taxonomyParts[4],
      family: taxonomyParts[5],
      genus: taxonomyParts[6],
      species: taxonomyParts[7],
      fullTaxonomy: taxonomyParts.join('; '),
      abundances,
    });
  }

  if (records.length === 0) {
    throw new Error('El archivo no contiene filas taxonomicas procesables.');
  }

  if (shortenedRowCount > 0) {
    warnings.push(`${shortenedRowCount} fila(s) tienen menos columnas que el encabezado; los valores faltantes se trataron como cero.`);
  }

  if (nonNumericCount > 0) {
    warnings.push(`${nonNumericCount} valor(es) de abundancia no numericos se trataron como cero (${nonNumericExamples.join(', ')}).`);
  }

  if (negativeCount > 0) {
    warnings.push(`${negativeCount} valor(es) negativos se normalizaron a cero (${negativeExamples.join(', ')}).`);
  }

  return {
    fileName,
    barcodeNames: barcodeColumns.map(({ header }) => header),
    records,
    warnings,
  };
}

export function filterTaxonomyRecords(
  records: readonly TaxonomyRecord[],
  filters: TaxonomyFilters,
): TaxonomyRecord[] {
  return records.filter((record) =>
    TAXONOMY_LEVELS.every(({ key }) => {
      const filterValue = filters[key];
      return !filterValue || record[key] === normalizeTaxonomyValue(filterValue);
    }),
  );
}

export function recordHasUnknownTaxonomy(record: TaxonomyRecord): boolean {
  return TAXONOMY_LEVELS.some(({ key }) => isUnknownTaxonomyValue(record[key]));
}

export function calculateBarcodeResults(
  matchedRecords: readonly TaxonomyRecord[],
  barcodeNames: readonly string[],
  minimumAbundance: number,
): BarcodeResult[] {
  const threshold = normalizeMinimumAbundance(minimumAbundance);

  return barcodeNames
    .map((barcode) => {
      let abundance = 0;
      const contributions: BarcodeTaxonContribution[] = [];

      for (const record of matchedRecords) {
        const value = record.abundances[barcode] ?? 0;
        abundance += value;

        if (value > 0) {
          contributions.push({
            fullTaxonomy: record.fullTaxonomy,
            genus: record.genus,
            species: record.species,
            abundance: value,
          });
        }
      }

      contributions.sort((first, second) => second.abundance - first.abundance || first.fullTaxonomy.localeCompare(second.fullTaxonomy));

      return {
        barcode,
        abundance,
        positive: abundance >= threshold,
        contributions,
      };
    })
    .sort(defaultBarcodeResultCompare);
}

export function getTaxonomyOptions(
  records: readonly TaxonomyRecord[],
  filters: TaxonomyFilters,
  level: TaxonomyLevel,
): string[] {
  const levelIndex = taxonomyLevelIndex(level);
  const compatibleRecords = records.filter((record) =>
    TAXONOMY_LEVELS.slice(0, levelIndex).every(({ key }) => {
      const filterValue = filters[key];
      return !filterValue || record[key] === normalizeTaxonomyValue(filterValue);
    }),
  );

  return Array.from(new Set(compatibleRecords.map((record) => record[level])))
    .filter((value) => value.length > 0)
    .sort((first, second) => first.localeCompare(second, 'es', { sensitivity: 'base' }));
}

export function clearLowerTaxonomyFilters(filters: TaxonomyFilters, changedLevel: TaxonomyLevel): TaxonomyFilters {
  const changedIndex = taxonomyLevelIndex(changedLevel);
  const cleanedFilters: TaxonomyFilters = {};

  for (let index = 0; index <= changedIndex; index += 1) {
    const key = TAXONOMY_LEVELS[index].key;
    const value = filters[key];

    if (value) {
      cleanedFilters[key] = normalizeTaxonomyValue(value);
    }
  }

  return cleanedFilters;
}

export function naturalBarcodeCompare(first: string, second: string): number {
  const firstMatch = /^barcode(\d+)$/.exec(first);
  const secondMatch = /^barcode(\d+)$/.exec(second);

  if (firstMatch && secondMatch) {
    const firstNumber = Number(firstMatch[1]);
    const secondNumber = Number(secondMatch[1]);

    if (firstNumber !== secondNumber) {
      return firstNumber - secondNumber;
    }
  }

  return first.localeCompare(second, 'es', { numeric: true, sensitivity: 'base' });
}

export function defaultBarcodeResultCompare(first: BarcodeResult, second: BarcodeResult): number {
  if (first.positive !== second.positive) {
    return first.positive ? -1 : 1;
  }

  if (first.abundance !== second.abundance) {
    return second.abundance - first.abundance;
  }

  return naturalBarcodeCompare(first.barcode, second.barcode);
}

export function sortBarcodeResults(
  results: readonly BarcodeResult[],
  sort: { active: 'default' | 'barcode' | 'abundance'; direction: 'asc' | 'desc' },
): BarcodeResult[] {
  const sortedResults = [...results];
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

  if (sort.active === 'barcode') {
    return sortedResults.sort((first, second) => directionMultiplier * naturalBarcodeCompare(first.barcode, second.barcode));
  }

  if (sort.active === 'abundance') {
    return sortedResults.sort((first, second) => {
      const abundanceComparison = first.abundance - second.abundance;
      return abundanceComparison === 0
        ? naturalBarcodeCompare(first.barcode, second.barcode)
        : directionMultiplier * abundanceComparison;
    });
  }

  return sortedResults.sort(defaultBarcodeResultCompare);
}

export function exportBarcodeResultsToCsv(
  fileName: string,
  results: readonly BarcodeResult[],
  filters: TaxonomyFilters,
  minimumAbundance: number,
  hasActiveFilters = true,
): string {
  const headers = [
    'archivo',
    'barcode',
    'abundancia',
    'resultado',
    ...TAXONOMY_LEVELS.map((level) => level.csvHeader),
    'taxones_detectados',
    'umbral',
  ];

  const rows = results.map((result) => [
    fileName,
    result.barcode,
    String(result.abundance),
    getResultLabel(result.positive, hasActiveFilters),
    ...TAXONOMY_LEVELS.map(({ key }) => filters[key] ?? 'Todos'),
    result.contributions.map((contribution) => `${contribution.fullTaxonomy} (${contribution.abundance})`).join('\n'),
    String(normalizeMinimumAbundance(minimumAbundance)),
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function buildCsvFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '');
  const safeName = withoutExtension.trim().length > 0 ? withoutExtension : 'resultados';
  return `${safeName}_resultados.csv`;
}

export function normalizeMinimumAbundance(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }

  return value;
}

function splitTaxonomy(value: string): string[] {
  const parts = value.split(';').map((part) => normalizeTaxonomyValue(part));

  while (parts.length < TAXONOMY_LEVELS.length) {
    parts.push(UNKNOWN_TAXONOMY_VALUE);
  }

  return parts.slice(0, TAXONOMY_LEVELS.length);
}

function normalizeTaxonomyValue(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : UNKNOWN_TAXONOMY_VALUE;
}

function isUnknownTaxonomyValue(value: string): boolean {
  return /^unknow(n)?$/i.test(value.trim());
}

function parseAbundanceValue(value: string): { value: number; kind: 'valid' | 'non-numeric' | 'negative' } {
  const normalized = value.trim();

  if (normalized.length === 0) {
    return { value: 0, kind: 'valid' };
  }

  const parsedValue = Number(normalized);

  if (!Number.isFinite(parsedValue)) {
    return { value: 0, kind: 'non-numeric' };
  }

  if (parsedValue < 0) {
    return { value: 0, kind: 'negative' };
  }

  return { value: parsedValue, kind: 'valid' };
}

function taxonomyLevelIndex(level: TaxonomyLevel): number {
  return TAXONOMY_LEVELS.findIndex(({ key }) => key === level);
}

function collectExample(examples: string[], example: string): void {
  if (examples.length < 3) {
    examples.push(example);
  }
}

function escapeCsvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function getResultLabel(found: boolean, hasActiveFilters: boolean): string {
  if (found) {
    return hasActiveFilters ? 'Lectura encontrada' : 'Lecturas en el reporte';
  }

  return hasActiveFilters ? 'Sin lectura para el filtro' : 'Sin lecturas en el reporte';
}
