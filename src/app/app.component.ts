import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

import {
  BarcodeResult,
  ParsedAbundanceTable,
  TAXONOMY_LEVELS,
  TaxonomyFilters,
  TaxonomyLevel,
} from './taxonomy-analysis.models';
import { TaxonomyAnalysisService } from './taxonomy-analysis.service';
import {
  buildCsvFileName,
  calculateBarcodeResults,
  clearLowerTaxonomyFilters,
  exportBarcodeResultsToCsv,
  filterTaxonomyRecords,
  getTaxonomyOptions,
  normalizeMinimumAbundance,
  recordHasUnknownTaxonomy,
  sortBarcodeResults,
} from './taxonomy-analysis.utils';

interface FileInfo {
  name: string;
  size: number;
}

interface SortState {
  active: 'default' | 'barcode' | 'abundance';
  direction: 'asc' | 'desc';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  private readonly taxonomyAnalysisService = inject(TaxonomyAnalysisService);

  readonly title = 'Nanopore Report Filter';
  readonly taxonomyLevels = TAXONOMY_LEVELS;
  readonly pageSizeOptions = [10, 25, 50, 100];

  readonly parsedTable = signal<ParsedAbundanceTable | null>(null);
  readonly fileInfo = signal<FileInfo | null>(null);
  readonly isProcessing = signal(false);
  readonly isDragOver = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  readonly filters = signal<TaxonomyFilters>({});
  readonly minimumAbundance = signal(1);
  readonly showUndetected = signal(false);
  readonly omitUnknownTaxonomy = signal(true);
  readonly searchTerm = signal('');
  readonly pageIndex = signal(0);
  readonly pageSize = signal(25);
  readonly expandedBarcode = signal<string | null>(null);
  readonly sortState = signal<SortState>({ active: 'default', direction: 'desc' });

  readonly fileSizeLabel = computed(() => {
    const info = this.fileInfo();
    return info ? this.formatFileSize(info.size) : '';
  });

  readonly hasActiveFilters = computed(() =>
    TAXONOMY_LEVELS.some(({ key }) => Boolean(this.filters()[key])),
  );

  readonly recordsForAnalysis = computed(() => {
    const records = this.parsedTable()?.records ?? [];
    return this.omitUnknownTaxonomy()
      ? records.filter((record) => !recordHasUnknownTaxonomy(record))
      : records;
  });

  readonly omittedUnknownRecordsCount = computed(() => {
    const records = this.parsedTable()?.records ?? [];
    return this.omitUnknownTaxonomy()
      ? records.length - this.recordsForAnalysis().length
      : 0;
  });

  readonly matchedRecords = computed(() => {
    const parsedTable = this.parsedTable();
    return parsedTable ? filterTaxonomyRecords(this.recordsForAnalysis(), this.filters()) : [];
  });

  readonly barcodeResults = computed(() => {
    const parsedTable = this.parsedTable();
    return parsedTable
      ? calculateBarcodeResults(this.matchedRecords(), parsedTable.barcodeNames, this.minimumAbundance())
      : [];
  });

  readonly optionsByLevel = computed<Record<TaxonomyLevel, string[]>>(() => {
    const filters = this.filters();

    return {
      domain: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'domain'),
      kingdom: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'kingdom'),
      phylum: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'phylum'),
      className: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'className'),
      order: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'order'),
      family: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'family'),
      genus: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'genus'),
      species: getTaxonomyOptions(this.recordsForAnalysis(), filters, 'species'),
    };
  });

  readonly visibleResults = computed(() => {
    const normalizedSearch = this.searchTerm().trim().toLowerCase();
    const filteredResults = this.barcodeResults().filter((result) => {
      const passesDetectionFilter = this.showUndetected() || result.positive;
      const passesSearch = normalizedSearch.length === 0 || result.barcode.toLowerCase().includes(normalizedSearch);
      return passesDetectionFilter && passesSearch;
    });

    return sortBarcodeResults(filteredResults, this.sortState());
  });

  readonly pagedResults = computed(() => {
    const start = this.pageIndex() * this.pageSize();
    return this.visibleResults().slice(start, start + this.pageSize());
  });

  readonly summary = computed(() => {
    const parsedTable = this.parsedTable();
    const results = this.barcodeResults();
    const positiveCount = results.filter((result) => result.positive).length;

    return {
      fileName: parsedTable?.fileName ?? '',
      totalBarcodes: parsedTable?.barcodeNames.length ?? 0,
      positiveCount,
      undetectedCount: results.length - positiveCount,
      recordsForAnalysis: this.recordsForAnalysis().length,
      omittedUnknownRecords: this.omittedUnknownRecordsCount(),
      matchedRows: this.matchedRecords().length,
      threshold: this.minimumAbundance(),
    };
  });

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.item(0);

    if (file) {
      void this.processFile(file);
    }

    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    const file = event.dataTransfer?.files.item(0);
    if (file) {
      void this.processFile(file);
    }
  }

  removeFile(): void {
    this.parsedTable.set(null);
    this.fileInfo.set(null);
    this.errorMessage.set(null);
    this.warnings.set([]);
    this.filters.set({});
    this.minimumAbundance.set(1);
    this.showUndetected.set(false);
    this.omitUnknownTaxonomy.set(true);
    this.searchTerm.set('');
    this.resetPagination();
    this.expandedBarcode.set(null);
  }

  onFilterChange(level: TaxonomyLevel, value: string): void {
    const nextFilters: TaxonomyFilters = {
      ...this.filters(),
      [level]: value || undefined,
    };

    this.filters.set(clearLowerTaxonomyFilters(nextFilters, level));
    this.resetPagination();
    this.expandedBarcode.set(null);
  }

  onMinimumAbundanceChange(value: string | number | null): void {
    const numericValue = typeof value === 'number' ? value : Number(value);
    this.minimumAbundance.set(normalizeMinimumAbundance(numericValue));
    this.resetPagination();
    this.expandedBarcode.set(null);
  }

  onSearchChange(value: string): void {
    this.searchTerm.set(value);
    this.resetPagination();
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  setSort(active: SortState['active']): void {
    const currentSort = this.sortState();

    if (active === 'default') {
      this.sortState.set({ active: 'default', direction: 'desc' });
      this.resetPagination();
      return;
    }

    if (currentSort.active === active) {
      this.sortState.set({
        active,
        direction: currentSort.direction === 'asc' ? 'desc' : 'asc',
      });
      this.resetPagination();
      return;
    }

    this.sortState.set({
      active,
      direction: active === 'barcode' ? 'asc' : 'desc',
    });
    this.resetPagination();
  }

  onShowUndetectedChange(checked: boolean): void {
    this.showUndetected.set(checked);
    this.resetPagination();
  }

  onOmitUnknownTaxonomyChange(checked: boolean): void {
    this.omitUnknownTaxonomy.set(checked);
    this.filters.set({});
    this.resetPagination();
    this.expandedBarcode.set(null);
  }

  toggleDetails(barcode: string): void {
    this.expandedBarcode.update((currentBarcode) => (currentBarcode === barcode ? null : barcode));
  }

  getFilterValue(level: TaxonomyLevel): string {
    return this.filters()[level] ?? '';
  }

  taxonSummary(result: BarcodeResult): string {
    if (result.contributions.length === 0) {
      return 'Sin taxones con abundancia mayor que cero';
    }

    const taxa = Array.from(
      new Set(result.contributions.map((contribution) => contribution.species || contribution.fullTaxonomy)),
    );
    const visibleTaxa = taxa.slice(0, 3).join('; ');
    const hiddenCount = taxa.length - 3;

    return hiddenCount > 0 ? `${visibleTaxa}; +${hiddenCount} más` : visibleTaxa;
  }

  resultLabel(result: BarcodeResult): string {
    if (result.positive) {
      return this.hasActiveFilters() ? 'Lectura encontrada' : 'Lecturas en el reporte';
    }

    return this.hasActiveFilters() ? 'Sin lectura para el filtro' : 'Sin lecturas en el reporte';
  }

  foundSummaryLabel(): string {
    return this.hasActiveFilters() ? 'Con lectura encontrada' : 'Con lecturas en el reporte';
  }

  notFoundSummaryLabel(): string {
    return this.hasActiveFilters() ? 'Sin lectura para el filtro' : 'Sin lecturas en el reporte';
  }

  exportCsv(): void {
    const parsedTable = this.parsedTable();

    if (!parsedTable || this.visibleResults().length === 0) {
      return;
    }

    const csv = exportBarcodeResultsToCsv(
      parsedTable.fileName,
      this.visibleResults(),
      this.filters(),
      this.minimumAbundance(),
      this.hasActiveFilters(),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildCsvFileName(parsedTable.fileName);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  resetPagination(): void {
    this.pageIndex.set(0);
  }

  private async processFile(file: File): Promise<void> {
    if (!/\.(tsv|txt)$/i.test(file.name)) {
      this.parsedTable.set(null);
      this.fileInfo.set({ name: file.name, size: file.size });
      this.warnings.set([]);
      this.errorMessage.set('Selecciona un archivo con extension .tsv o .txt.');
      return;
    }

    this.isProcessing.set(true);
    this.errorMessage.set(null);
    this.warnings.set([]);

    try {
      const parsedTable = await this.taxonomyAnalysisService.parseTsv(file);
      this.parsedTable.set(parsedTable);
      this.fileInfo.set({ name: file.name, size: file.size });
      this.warnings.set(parsedTable.warnings);
      this.filters.set({});
      this.minimumAbundance.set(1);
      this.showUndetected.set(false);
      this.omitUnknownTaxonomy.set(true);
      this.searchTerm.set('');
      this.expandedBarcode.set(null);
      this.resetPagination();
    } catch (error: unknown) {
      this.parsedTable.set(null);
      this.fileInfo.set({ name: file.name, size: file.size });
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo procesar el archivo TSV.');
    } finally {
      this.isProcessing.set(false);
    }
  }

  private formatFileSize(size: number): string {
    if (size < 1024) {
      return `${size} B`;
    }

    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }

    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
}
