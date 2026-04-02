# Converter NestJS Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 4 Next.js converter API routes (3080 lines of self-contained logic) into NestJS proxies, consolidating all business logic on the Render-deployed NestJS server.

**Architecture:** Next.js routes become thin proxies that forward requests to NestJS (`POST /api/*`). NestJS already has generate and attendance endpoints; we add missing utility functions, an ai-mapping endpoint, and enhance the analyze endpoint. No existing NestJS logic is modified.

**Tech Stack:** NestJS 11, ExcelJS, Gemini AI (via existing GeminiAiMappingAdapter), Next.js 14 API Routes

**Spec:** `docs/superpowers/specs/2026-04-02-converter-nestjs-consolidation.md`

---

### Task 1: Port missing utility functions to NestJS excel-utils.ts

**Files:**
- Modify: `api/src/contexts/excel-formatter/application/services/utils/excel-utils.ts`
- Source: `lib/cell-value-utils.ts` (functions to copy)

- [ ] **Step 1: Add `cellValueToString()` and `safeExtractCellValue()` to excel-utils.ts**

These are needed by the ported functions. Add at the end of `api/src/contexts/excel-formatter/application/services/utils/excel-utils.ts`:

```typescript
/**
 * ExcelJS 셀 값에서 실제 값을 안전하게 추출합니다.
 */
export function safeExtractCellValue(
  value: ExcelJS.CellValue
): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'object') {
    if ('result' in value) {
      const result = (value as { result: unknown }).result;
      if (result === null || result === undefined) return null;
      if (result instanceof Date) return result.toISOString().split('T')[0];
      if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') return result;
      return String(result);
    }
    if ('richText' in value) {
      return (value as { richText: Array<{ text: string }> }).richText.map(t => t.text).join('');
    }
    if ('text' in value && 'hyperlink' in value) return (value as { text: string }).text;
    if ('error' in value) return null;
    try { return JSON.stringify(value); } catch { return null; }
  }
  return String(value);
}

export function cellValueToString(value: ExcelJS.CellValue): string {
  const extracted = safeExtractCellValue(value);
  if (extracted === null || extracted === undefined) return '';
  return String(extracted);
}
```

- [ ] **Step 2: Add `detectMultiRowHeaders()` to excel-utils.ts**

Copy the entire `detectMultiRowHeaders()` function (lines 7-125) from `lib/cell-value-utils.ts` and append to `excel-utils.ts`. The function uses `cellValueToString()` added in step 1 — no import changes needed.

- [ ] **Step 3: Add `isRepeatedHeaderOrMetadata()` to excel-utils.ts**

Copy the entire `isRepeatedHeaderOrMetadata()` function (lines 214-248) from `lib/cell-value-utils.ts` and append to `excel-utils.ts`.

- [ ] **Step 4: Add `mergePairedRows()` to excel-utils.ts**

Copy the entire `mergePairedRows()` function (lines 327-490) from `lib/cell-value-utils.ts` and append to `excel-utils.ts`.

- [ ] **Step 5: Verify NestJS builds**

Run:
```bash
cd /Users/gwangyunmoon/Documents/Carrot/api && npx nest build
```
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/gwangyunmoon/Documents/Carrot
git add api/src/contexts/excel-formatter/application/services/utils/excel-utils.ts
git commit -m "feat: port cell-value utility functions to NestJS excel-utils"
```

---

### Task 2: Enhance NestJS analyze endpoint

**Files:**
- Modify: `api/src/contexts/excel-formatter/interface/http/controllers/unified-generate.controller.ts` (lines 170-267)

The current NestJS `POST /api/generate/analyze` only returns `{ format, sheets?, columns? }`. The Next.js route returns `{ success, format, columns, preview, metadata, rowCount, sheets }`. We need to match this.

- [ ] **Step 1: Update the `analyzeTemplate` method**

Replace the `@Post('analyze')` method (lines 170-267) in `unified-generate.controller.ts` with enhanced logic that:
1. Uses `findSmartHeaderRow()` + `detectMultiRowHeaders()` from excel-utils
2. Extracts metadata from pre-header rows (Key:Value pattern)
3. Extracts preview data (max 100 rows)
4. Applies `mergePairedRows()` if paired pattern detected
5. Accepts both `template` and `file` field names (for data file analysis too)

```typescript
@Post('analyze')
@UseInterceptors(
  FileFieldsInterceptor([
    { name: 'template', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]),
)
async analyzeTemplate(
  @UploadedFiles() files: { template?: Express.Multer.File[]; file?: Express.Multer.File[] },
  @Body('sheetName') sheetName: string | undefined,
  @Body('format') formatHint: string | undefined,
): Promise<{
  success: boolean;
  format: string;
  columns?: string[];
  sheets?: string[];
  rowCount?: number;
  preview?: Record<string, unknown>[];
  metadata?: Record<string, string>;
  error?: string;
}> {
  const uploadedFile = files.template?.[0] || files.file?.[0];
  if (!uploadedFile) {
    throw new BadRequestException('파일이 필요합니다.');
  }

  const fileName = uploadedFile.originalname.toLowerCase();
  const ext = formatHint || fileName.split('.').pop();

  if (ext === 'xlsx' || ext === 'xls') {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(uploadedFile.buffer as unknown as ArrayBuffer);

    const sheets = workbook.worksheets.map((ws) => ws.name);
    const targetSheet = sheetName || sheets[0];
    const worksheet = workbook.getWorksheet(targetSheet);

    if (!worksheet) {
      throw new BadRequestException(`시트 "${targetSheet}"를 찾을 수 없습니다.`);
    }

    // Smart header detection
    const { headerRowNum } = await findSmartHeaderRow(worksheet);

    // Multi-row header detection
    const { compositeColumns, dataStartRow } = detectMultiRowHeaders(
      worksheet, headerRowNum
    );

    const columns = compositeColumns.map(c => c.name);

    // Metadata extraction from pre-header rows
    const metadata: Record<string, string> = {};
    for (let rowNum = 1; rowNum < headerRowNum; rowNum++) {
      const row = worksheet.getRow(rowNum);
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = getCellText(cell);
        const match = text.match(/^(.+?)\s*:\s*(.+)$/);
        if (match) {
          metadata[match[1].trim()] = match[2].trim();
        }
      });
    }

    // Preview data extraction (max 100 rows)
    const preview: Record<string, unknown>[] = [];
    for (let rowNum = dataStartRow; rowNum <= worksheet.rowCount && preview.length < 100; rowNum++) {
      const row = worksheet.getRow(rowNum);
      const rowData: Record<string, unknown> = {};
      let hasData = false;

      for (const { colIndex, name } of compositeColumns) {
        const cell = row.getCell(colIndex);
        const value = extractCellValue(cell);
        if (value !== null && value !== undefined && value !== '') hasData = true;
        rowData[name] = value;
      }

      if (hasData && !isRepeatedHeaderOrMetadata(rowData, columns)) {
        preview.push(rowData);
      }
    }

    // Try paired row merging
    const merged = mergePairedRows(preview, columns);

    return {
      success: true,
      format: 'excel',
      sheets,
      columns: merged.columns,
      rowCount: merged.rows.length,
      preview: merged.rows.slice(0, 100),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  if (ext === 'csv') {
    const { columns, data } = extractCsvData(uploadedFile.buffer);
    return {
      success: true,
      format: 'csv',
      columns,
      rowCount: data.length,
      preview: data.slice(0, 100),
    };
  }

  if (ext === 'json') {
    const { columns, data } = extractJsonData(uploadedFile.buffer);
    return {
      success: true,
      format: 'json',
      columns,
      rowCount: data.length,
      preview: data.slice(0, 100),
    };
  }

  if (ext === 'hwpx') {
    return { success: true, format: 'hwpx', columns: [] };
  }

  return { success: false, format: 'unknown', error: '지원하지 않는 형식입니다.' };
}
```

- [ ] **Step 2: Add imports at top of unified-generate.controller.ts**

```typescript
import {
  findSmartHeaderRow,
  detectMultiRowHeaders,
  getCellText,
  extractCellValue,
  extractCsvData,
  extractJsonData,
  isRepeatedHeaderOrMetadata,
  mergePairedRows,
} from '../../../application/services/utils/excel-utils';
```

- [ ] **Step 3: Verify NestJS builds**

Run:
```bash
cd /Users/gwangyunmoon/Documents/Carrot/api && npx nest build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/gwangyunmoon/Documents/Carrot
git add api/src/contexts/excel-formatter/interface/http/controllers/unified-generate.controller.ts
git commit -m "feat: enhance analyze endpoint with metadata, preview, and row merging"
```

---

### Task 3: Create converter AI mapping endpoint in NestJS

**Files:**
- Create: `api/src/contexts/excel-formatter/application/services/converter-mapping.service.ts`
- Create: `api/src/contexts/excel-formatter/interface/http/controllers/converter-mapping.controller.ts`
- Modify: `api/src/contexts/excel-formatter/interface/http/controllers/index.ts`
- Modify: `api/src/contexts/excel-formatter/application/services/index.ts`
- Modify: `api/src/contexts/excel-formatter/excel-formatter.module.ts`

- [ ] **Step 1: Create converter-mapping.service.ts**

Copy the entire `app/api/converter/ai-mapping/route.ts` (1207 lines) logic into a NestJS injectable service. The file should contain:

1. All interfaces (`MappingRequest`, `MappingResult`)
2. All helper functions (`normalizeColName`, `stripCompositePrefix`, `isAttendanceColumn`, `isSummaryColumn`, etc.)
3. All constants (`METADATA_FIELD_MAP`, `SYNONYM_GROUPS`, `SUMMARY_FORMULA_KEYS`)
4. The `attendanceAwareMapping()` 5-phase algorithm
5. AI fallback via injected `GeminiAiMappingAdapter`

Service class structure:
```typescript
import { Injectable, Inject } from '@nestjs/common';
import { AI_MAPPING_PORT, AiMappingPort } from '../ports';

@Injectable()
export class ConverterMappingService {
  constructor(
    @Inject(AI_MAPPING_PORT) private readonly aiMapping: AiMappingPort,
  ) {}

  async mapColumns(request: MappingRequest): Promise<{
    success: boolean;
    mappings: MappingResult[];
    mappedCount: number;
    totalTemplate: number;
  }> {
    // Port the attendanceAwareMapping() logic here
    // Use this.aiMapping for AI fallback instead of direct fetch
  }
}
```

The key is to copy all the matching logic as-is from the Next.js route. Do NOT refactor or simplify — preserve the exact algorithm.

- [ ] **Step 2: Create converter-mapping.controller.ts**

```typescript
import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { ConverterMappingService } from '../../../application/services/converter-mapping.service';

@Controller('converter')
export class ConverterMappingController {
  constructor(private readonly mappingService: ConverterMappingService) {}

  @Post('ai-mapping')
  async aiMapping(
    @Body() body: {
      templateColumns: string[];
      dataColumns: string[];
      templateSampleData?: Record<string, unknown>[];
      dataSampleData?: Record<string, unknown>[];
      dataMetadata?: Record<string, string>;
    },
  ) {
    if (!body.templateColumns?.length || !body.dataColumns?.length) {
      throw new BadRequestException('templateColumns and dataColumns are required');
    }
    return this.mappingService.mapColumns(body);
  }
}
```

- [ ] **Step 3: Register in module**

Add to `api/src/contexts/excel-formatter/interface/http/controllers/index.ts`:
```typescript
export * from './converter-mapping.controller';
```

Add to `api/src/contexts/excel-formatter/application/services/index.ts`:
```typescript
export { ConverterMappingService } from './converter-mapping.service';
```

Add to `excel-formatter.module.ts` controllers array:
```typescript
ConverterMappingController,
```

Add to `excel-formatter.module.ts` providers array:
```typescript
ConverterMappingService,
```

- [ ] **Step 4: Verify NestJS builds**

Run:
```bash
cd /Users/gwangyunmoon/Documents/Carrot/api && npx nest build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/gwangyunmoon/Documents/Carrot
git add api/src/contexts/excel-formatter/
git commit -m "feat: add converter ai-mapping endpoint to NestJS"
```

---

### Task 4: Replace Next.js converter routes with NestJS proxies

**Files:**
- Modify: `app/api/converter/analyze/route.ts` (251 → ~25 lines)
- Modify: `app/api/converter/ai-mapping/route.ts` (1207 → ~25 lines)
- Modify: `app/api/converter/generate/route.ts` (815 → ~30 lines)
- Modify: `app/api/converter/attendance-generate/route.ts` (807 → ~30 lines)

- [ ] **Step 1: Replace `app/api/converter/analyze/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const response = await fetch(`${API_BASE_URL}/generate/analyze`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { success: false, error: error || 'Analysis failed' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[converter/analyze] Proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Replace `app/api/converter/ai-mapping/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const response = await fetch(`${API_BASE_URL}/converter/ai-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { success: false, error: error || 'Mapping failed' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[converter/ai-mapping] Proxy error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Replace `app/api/converter/generate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const response = await fetch(`${API_BASE_URL}/generate`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      return new NextResponse(error, { status: response.status });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = response.headers.get('content-disposition') || '';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentDisposition && { 'Content-Disposition': contentDisposition }),
      },
    });
  } catch (error) {
    console.error('[converter/generate] Proxy error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
```

- [ ] **Step 4: Replace `app/api/converter/attendance-generate/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NESTJS_API_URL || 'http://localhost:4000/api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const response = await fetch(`${API_BASE_URL}/attendance/generate`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      return new NextResponse(error, { status: response.status });
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = response.headers.get('content-disposition') || '';

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...(contentDisposition && { 'Content-Disposition': contentDisposition }),
      },
    });
  } catch (error) {
    console.error('[converter/attendance-generate] Proxy error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
```

- [ ] **Step 5: Verify Next.js builds**

Run:
```bash
cd /Users/gwangyunmoon/Documents/Carrot && npm run build
```

- [ ] **Step 6: Commit**

```bash
cd /Users/gwangyunmoon/Documents/Carrot
git add app/api/converter/
git commit -m "refactor: replace converter routes with NestJS proxies

Migrate 3080 lines of self-contained logic to thin proxy routes
that forward to NestJS API (Render). All business logic now lives
in the NestJS server."
```

---

### Task 5: Verify end-to-end flow

**Files:** None (testing only)

- [ ] **Step 1: Start NestJS server locally**

```bash
cd /Users/gwangyunmoon/Documents/Carrot/api && npm run start:dev
```
Expected: Server starts on port 4000.

- [ ] **Step 2: Start Next.js locally**

```bash
cd /Users/gwangyunmoon/Documents/Carrot && npm run dev
```
Expected: Server starts on port 3000.

- [ ] **Step 3: Test analyze endpoint**

Open browser at `http://localhost:3000/converter`, upload an Excel file as template.
Expected: Columns and preview data appear correctly, including multi-row headers if present.

- [ ] **Step 4: Test ai-mapping**

After uploading template and data files, click auto-mapping.
Expected: Column mappings appear with confidence scores.

- [ ] **Step 5: Test generate**

With mappings set, click generate.
Expected: Report file downloads successfully.

- [ ] **Step 6: Final commit with any fixes**

If any fixes were needed during testing, commit them:
```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
