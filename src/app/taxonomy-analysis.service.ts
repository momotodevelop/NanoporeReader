import { Injectable } from '@angular/core';

import { ParsedAbundanceTable } from './taxonomy-analysis.models';
import { parseAbundanceTableText } from './taxonomy-analysis.utils';

@Injectable({
  providedIn: 'root',
})
export class TaxonomyAnalysisService {
  async parseTsv(file: File): Promise<ParsedAbundanceTable> {
    return parseAbundanceTableText(await file.text(), file.name);
  }
}
