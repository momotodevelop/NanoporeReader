import {
  calculateBarcodeResults,
  clearLowerTaxonomyFilters,
  exportBarcodeResultsToCsv,
  filterTaxonomyRecords,
  naturalBarcodeCompare,
  parseAbundanceTableText,
  recordHasUnknownTaxonomy,
} from './taxonomy-analysis.utils';

const FIXTURE = [
  'tax\tbarcode01\tbarcode02\tbarcode10\ttotal',
  'Bacteria; ReinoA; FiloA; ClaseA; OrdenA; FamiliaA; Mycobacterium; Mycobacterium tuberculosis\t1\t0\t3\t4',
  'Bacteria; ReinoA; FiloA; ClaseA; OrdenA; FamiliaA; Mycobacterium; Mycobacterium bovis\t2\t0\t0\t2',
  'Bacteria; ReinoA; FiloB; ClaseB; OrdenB; FamiliaB; Bacillus; Bacillus subtilis\t0\t5\t0\t5',
].join('\n');

describe('taxonomy analysis utilities', () => {
  it('detects barcode columns and ignores total', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');

    expect(parsed.barcodeNames).toEqual(['barcode01', 'barcode02', 'barcode10']);
  });

  it('splits the eight taxonomy levels', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');
    const record = parsed.records[0];

    expect(record.domain).toBe('Bacteria');
    expect(record.kingdom).toBe('ReinoA');
    expect(record.phylum).toBe('FiloA');
    expect(record.className).toBe('ClaseA');
    expect(record.order).toBe('OrdenA');
    expect(record.family).toBe('FamiliaA');
    expect(record.genus).toBe('Mycobacterium');
    expect(record.species).toBe('Mycobacterium tuberculosis');
  });

  it('tolerates missing taxonomy levels consistently as Unknown', () => {
    const parsed = parseAbundanceTableText('tax\tbarcode1\nBacteria; ReinoA\t1', 'missing.tsv');

    expect(parsed.records[0].domain).toBe('Bacteria');
    expect(parsed.records[0].kingdom).toBe('ReinoA');
    expect(parsed.records[0].phylum).toBe('Unknown');
    expect(parsed.records[0].species).toBe('Unknown');
  });

  it('identifies records marked as Unknown or Unknow taxonomy', () => {
    const parsed = parseAbundanceTableText(
      'tax\tbarcode1\nBacteria; Unknown\t1\nBacteria; Unknow\t1\nBacteria; ReinoA; FiloA; ClaseA; OrdenA; FamiliaA; Genero; Especie\t1',
      'unknown.tsv',
    );

    expect(parsed.records.map((record) => recordHasUnknownTaxonomy(record))).toEqual([true, true, false]);
  });

  it('converts empty, non-numeric and negative abundance values to zero', () => {
    const parsed = parseAbundanceTableText('tax\tbarcode1\tbarcode2\tbarcode3\nBacteria\t\tabc\t-2', 'values.tsv');

    expect(parsed.records[0].abundances).toEqual({ barcode1: 0, barcode2: 0, barcode3: 0 });
    expect(parsed.warnings.join(' ')).toContain('no numericos');
    expect(parsed.warnings.join(' ')).toContain('negativos');
  });

  it('detects one read with threshold 1', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');
    const matched = filterTaxonomyRecords(parsed.records, { species: 'Mycobacterium tuberculosis' });
    const results = calculateBarcodeResults(matched, parsed.barcodeNames, 1);

    expect(results.find((result) => result.barcode === 'barcode01')?.positive).toBeTrue();
    expect(results.find((result) => result.barcode === 'barcode01')?.abundance).toBe(1);
  });

  it('does not detect a barcode with zero reads', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');
    const matched = filterTaxonomyRecords(parsed.records, { species: 'Mycobacterium tuberculosis' });
    const results = calculateBarcodeResults(matched, parsed.barcodeNames, 1);

    expect(results.find((result) => result.barcode === 'barcode02')?.positive).toBeFalse();
    expect(results.find((result) => result.barcode === 'barcode02')?.abundance).toBe(0);
  });

  it('sums multiple rows when filtering by genus', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');
    const matched = filterTaxonomyRecords(parsed.records, { genus: 'Mycobacterium' });
    const results = calculateBarcodeResults(matched, parsed.barcodeNames, 1);

    expect(results.find((result) => result.barcode === 'barcode01')?.abundance).toBe(3);
    expect(results.find((result) => result.barcode === 'barcode10')?.abundance).toBe(3);
  });

  it('filters one species exactly', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');
    const matched = filterTaxonomyRecords(parsed.records, { species: 'Mycobacterium tuberculosis' });

    expect(matched.length).toBe(1);
    expect(matched[0].species).toBe('Mycobacterium tuberculosis');
  });

  it('respects a threshold greater than one', () => {
    const parsed = parseAbundanceTableText(FIXTURE, 'fixture.tsv');
    const matched = filterTaxonomyRecords(parsed.records, { species: 'Mycobacterium tuberculosis' });
    const results = calculateBarcodeResults(matched, parsed.barcodeNames, 2);

    expect(results.find((result) => result.barcode === 'barcode01')?.positive).toBeFalse();
    expect(results.find((result) => result.barcode === 'barcode10')?.positive).toBeTrue();
  });

  it('sorts barcode2, barcode10 and barcode100 naturally', () => {
    const sorted = ['barcode100', 'barcode10', 'barcode2'].sort(naturalBarcodeCompare);

    expect(sorted).toEqual(['barcode2', 'barcode10', 'barcode100']);
  });

  it('clears lower filters when a higher level changes', () => {
    const cleaned = clearLowerTaxonomyFilters(
      {
        domain: 'Bacteria',
        kingdom: 'ReinoA',
        phylum: 'FiloA',
        className: 'ClaseA',
        genus: 'Mycobacterium',
      },
      'kingdom',
    );

    expect(cleaned).toEqual({ domain: 'Bacteria', kingdom: 'ReinoA' });
  });

  it('exports CSV with escaped commas, quotes and line breaks', () => {
    const csv = exportBarcodeResultsToCsv(
      'archivo, "uno".tsv',
      [
        {
          barcode: 'barcode1',
          abundance: 2,
          positive: true,
          contributions: [
            {
              fullTaxonomy: 'Bacteria; Familia, A; "Taxon"',
              genus: 'Genero',
              species: 'Especie',
              abundance: 2,
            },
          ],
        },
      ],
      { genus: 'Genero' },
      1,
    );

    expect(csv).toContain('"archivo, ""uno"".tsv"');
    expect(csv).toContain('"Bacteria; Familia, A; ""Taxon"" (2)"');
    expect(csv).toContain('Lectura encontrada');
  });

  it('throws a clear error when the tax column is missing', () => {
    expect(() => parseAbundanceTableText('name\tbarcode1\nA\t1', 'bad.tsv')).toThrowError(/tax/);
  });

  it('throws a clear error when barcode columns are missing', () => {
    expect(() => parseAbundanceTableText('tax\ttotal\nBacteria\t1', 'bad.tsv')).toThrowError(/barcodeXX/);
  });
});
