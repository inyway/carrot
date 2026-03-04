'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import CubeLoader from '@/components/CubeLoader';
import ContextChat, { type MappingContext } from '@/app/components/ContextChat';
import { safeCellDisplay } from '@/lib/cell-value-utils';

// 지원하는 템플릿 형식
// type TemplateFormat = 'xlsx' | 'csv' | 'hwpx';
// 지원하는 데이터 형식
// type DataFormat = 'xlsx' | 'xls' | 'csv' | 'json';

interface FileInfo {
  file: File;
  format: string;
  name: string;
  size: number;
  columns?: string[];
  sheets?: string[];
  selectedSheet?: string;
  rowCount?: number;
  preview?: Record<string, unknown>[];
  metadata?: Record<string, string>;
}

// HWPX 테이블 셀 정보
interface HwpxCell {
  rowIndex: number;
  colIndex: number;
  text: string;
  isHeader?: boolean;
  colSpan?: number;
  rowSpan?: number;
}

// HWPX 테이블 정보
interface HwpxTable {
  rowCount: number;
  colCount: number;
  cells: HwpxCell[];
}

// HWPX 템플릿 정보
interface HwpxTemplateData {
  sections: string[];
  tables: HwpxTable[];
}

interface TemplateInfo extends FileInfo {
  placeholders?: string[]; // 템플릿의 플레이스홀더/필드 목록
  hwpxTemplate?: HwpxTemplateData; // HWPX 템플릿 구조
  templatePreview?: Record<string, unknown>[]; // Excel/CSV 템플릿 미리보기
}

interface MappingItem {
  templateField: string;
  dataColumn: string;
  confidence?: number;
  // HWPX 전용 필드
  hwpxRow?: number;
  hwpxCol?: number;
  // Metadata constant mapping
  isMetadata?: boolean;
  metadataValue?: string;
}

// 매핑 검증 결과 인터페이스
interface ValidationIssue {
  type: 'missing' | 'warning' | 'info';
  field: string;
  message: string;
  hwpxRow?: number;
  hwpxCol?: number;
  suggestedExcelColumn?: string;
}

interface ValidationSuggestion {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
  labelText?: string;
  reason?: string;
}

interface ValidationResult {
  isValid: boolean;
  totalFields: number;
  mappedFields: number;
  missingFields: number;
  issues: ValidationIssue[];
  suggestions: ValidationSuggestion[];
}

// 포맷별 아이콘 색상
const FORMAT_COLORS: Record<string, string> = {
  xlsx: 'bg-green-100 text-green-600',
  xls: 'bg-green-100 text-green-600',
  csv: 'bg-blue-100 text-blue-600',
  hwpx: 'bg-orange-100 text-orange-600',
  json: 'bg-purple-100 text-purple-600',
  unknown: 'bg-gray-100 text-gray-600',
};

// 포맷 라벨
const FORMAT_LABELS: Record<string, string> = {
  xlsx: 'Excel',
  xls: 'Excel (xls)',
  csv: 'CSV',
  hwpx: 'HWPX',
  json: 'JSON',
  unknown: '알 수 없음',
};

// 파일 확장자로 포맷 감지
const detectFormat = (fileName: string): string => {
  const ext = fileName.toLowerCase().split('.').pop();
  switch (ext) {
    case 'xlsx': return 'xlsx';
    case 'xls': return 'xls';
    case 'csv': return 'csv';
    case 'hwpx': return 'hwpx';
    case 'json': return 'json';
    default: return 'unknown';
  }
};

export default function ConverterPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();

  // 파일 입력 참조
  const templateInputRef = useRef<HTMLInputElement>(null);
  const dataInputRef = useRef<HTMLInputElement>(null);

  // 상태
  const [templateFile, setTemplateFile] = useState<TemplateInfo | null>(null);
  const [dataFile, setDataFile] = useState<FileInfo | null>(null);
  const [mappings, setMappings] = useState<MappingItem[]>([]);
  const [fileNameColumn, setFileNameColumn] = useState<string>('');

  // 로딩 상태
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  const [analyzingData, setAnalyzingData] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);

  // 미리보기 데이터
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);

  // 검증 상태
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // 매핑 컨텍스트 (AI 매핑에 참고할 도메인 정보)
  const [mappingContext, setMappingContext] = useState<MappingContext | null>(null);

  // 템플릿 파일 선택
  const handleTemplateSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const format = detectFormat(file.name);

    if (!['xlsx', 'csv', 'hwpx'].includes(format)) {
      alert('템플릿은 Excel(.xlsx), CSV(.csv), HWPX(.hwpx) 파일만 지원합니다.');
      return;
    }

    const fileInfo: TemplateInfo = {
      file,
      format,
      name: file.name,
      size: file.size,
    };

    setTemplateFile(fileInfo);
    setMappings([]);

    // 템플릿 분석
    setAnalyzingTemplate(true);
    try {
      if (format === 'hwpx') {
        // HWPX 템플릿 분석 (기존 API 사용)
        const formData = new FormData();
        formData.append('template', file);

        const res = await fetch('/api/hwpx/analyze', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const result = await res.json();
          // API 응답 구조: { template: { tables, sections, fileName }, suggestedMappings }
          const template = result.template || result;
          // HWPX 전체 템플릿 구조 저장
          setTemplateFile(prev => prev ? {
            ...prev,
            hwpxTemplate: {
              sections: template.sections || [],
              tables: template.tables || [],
            },
            placeholders: template.tables?.[0]?.cells
              ?.filter((c: { text: string; isHeader: boolean }) => !c.isHeader && c.text)
              .map((c: { text: string }) => c.text) || [],
          } : null);
        }
      } else {
        // Excel/CSV 템플릿 분석
        const formData = new FormData();
        formData.append('file', file);
        formData.append('format', format);

        const res = await fetch('/api/converter/analyze', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const result = await res.json();
          setTemplateFile(prev => prev ? {
            ...prev,
            columns: result.columns,
            sheets: result.sheets,
            selectedSheet: result.sheets?.[0],
            placeholders: result.columns, // Excel 템플릿의 컬럼이 곧 필드
            templatePreview: result.preview, // 템플릿 미리보기 데이터 저장
          } : null);
        }
      }
    } catch (error) {
      console.error('Template analyze error:', error);
    } finally {
      setAnalyzingTemplate(false);
    }

    if (templateInputRef.current) {
      templateInputRef.current.value = '';
    }
  };

  // 데이터 파일 선택
  const handleDataSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const format = detectFormat(file.name);

    if (!['xlsx', 'xls', 'csv', 'json'].includes(format)) {
      alert('데이터 파일은 Excel(.xlsx, .xls), CSV(.csv), JSON(.json) 파일만 지원합니다.');
      return;
    }

    const fileInfo: FileInfo = {
      file,
      format,
      name: file.name,
      size: file.size,
    };

    setDataFile(fileInfo);
    setPreviewData(null);
    setMappings([]);

    // 데이터 파일 분석
    setAnalyzingData(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('format', format);

      const res = await fetch('/api/converter/analyze', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        setDataFile(prev => prev ? {
          ...prev,
          columns: result.columns,
          sheets: result.sheets,
          selectedSheet: result.sheets?.[0],
          rowCount: result.rowCount,
          preview: result.preview,
          metadata: result.metadata,
        } : null);

        setPreviewData(result.preview || null);
      }
    } catch (error) {
      console.error('Data analyze error:', error);
    } finally {
      setAnalyzingData(false);
    }

    if (dataInputRef.current) {
      dataInputRef.current.value = '';
    }
  };

  // 시트 변경
  const handleSheetChange = async (sheetName: string, type: 'template' | 'data') => {
    const file = type === 'template' ? templateFile : dataFile;
    if (!file) return;

    if (type === 'template') {
      setTemplateFile(prev => prev ? { ...prev, selectedSheet: sheetName } : null);
    } else {
      setDataFile(prev => prev ? { ...prev, selectedSheet: sheetName } : null);
    }

    const setAnalyzing = type === 'template' ? setAnalyzingTemplate : setAnalyzingData;
    setAnalyzing(true);

    try {
      const formData = new FormData();
      formData.append('file', file.file);
      formData.append('format', file.format);
      formData.append('sheetName', sheetName);

      const res = await fetch('/api/converter/analyze', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        if (type === 'template') {
          setTemplateFile(prev => prev ? {
            ...prev,
            columns: result.columns,
            placeholders: result.columns,
          } : null);
        } else {
          setDataFile(prev => prev ? {
            ...prev,
            columns: result.columns,
            rowCount: result.rowCount,
            preview: result.preview,
          } : null);
          setPreviewData(result.preview || null);
        }
      }
    } catch (error) {
      console.error('Sheet change error:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  // 매핑 검증 함수
  const validateMappings = async (currentMappings: MappingItem[]) => {
    if (!templateFile || !dataFile || templateFile.format !== 'hwpx') {
      return;
    }

    setValidating(true);
    try {
      const formData = new FormData();
      formData.append('template', templateFile.file);
      formData.append('excel', dataFile.file);
      if (dataFile.selectedSheet) {
        formData.append('sheetName', dataFile.selectedSheet);
      }
      // HWPX 매핑 형식으로 변환
      const hwpxMappings = currentMappings
        .filter(m => m.hwpxRow !== undefined && m.hwpxCol !== undefined)
        .map(m => ({
          excelColumn: m.dataColumn,
          hwpxRow: m.hwpxRow,
          hwpxCol: m.hwpxCol,
        }));
      formData.append('mappings', JSON.stringify(hwpxMappings));

      const res = await fetch('/api/hwpx/validate-mappings', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const result: ValidationResult = await res.json();
        setValidationResult(result);
        return result;
      }
    } catch (error) {
      console.error('Validation error:', error);
    } finally {
      setValidating(false);
    }
    return null;
  };

  // 제안된 매핑 적용
  const applySuggestions = (suggestions: { excelColumn: string; hwpxRow: number; hwpxCol: number }[]) => {
    const newMappings: MappingItem[] = [
      ...mappings,
      ...suggestions.map(s => ({
        templateField: s.excelColumn,
        dataColumn: s.excelColumn,
        hwpxRow: s.hwpxRow,
        hwpxCol: s.hwpxCol,
        confidence: 1.0,
      })),
    ];
    setMappings(newMappings);
    setValidationResult(null); // 적용 후 검증 결과 초기화
  };

  // AI 자동 매핑
  const handleAutoMapping = async () => {
    if (!templateFile || !dataFile) {
      alert('템플릿과 데이터 파일을 모두 업로드해주세요.');
      return;
    }

    setAutoMapping(true);
    setValidationResult(null);
    try {
      if (templateFile.format === 'hwpx') {
        // HWPX AI 매핑 (기존 API 사용)
        const formData = new FormData();
        formData.append('template', templateFile.file);
        formData.append('excel', dataFile.file);
        if (dataFile.selectedSheet) {
          formData.append('sheetName', dataFile.selectedSheet);
        }
        // 도메인 컨텍스트 추가 (필드 관계, 동의어 등)
        if (mappingContext && Object.keys(mappingContext).length > 0) {
          formData.append('context', JSON.stringify(mappingContext));
          console.log('[Converter] AI mapping with context:', mappingContext);
        }

        const res = await fetch('/api/hwpx/ai-mapping', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const result = await res.json();
          const newMappings: MappingItem[] = (result.mappings || []).map((m: { excelColumn: string; hwpxRow: number; hwpxCol: number; confidence?: number }) => ({
            templateField: m.excelColumn, // 표시용
            dataColumn: m.excelColumn,
            hwpxRow: m.hwpxRow,
            hwpxCol: m.hwpxCol,
            confidence: m.confidence,
          }));
          setMappings(newMappings);

          // 백엔드에서 validationResult가 함께 오는 경우 바로 사용
          if (result.validationResult) {
            console.log('[Converter] AI mapping with validation:', {
              isValid: result.validationResult.isValid,
              suggestions: result.validationResult.suggestions?.length || 0,
            });
            setValidationResult(result.validationResult);

            // suggestions가 있으면 자동 적용 또는 알림
            if (result.validationResult.suggestions && result.validationResult.suggestions.length > 0) {
              console.log('[Converter] Auto-applying suggestions from AI mapping...');
              // 자동으로 suggestion 매핑 추가
              const suggestionMappings: MappingItem[] = result.validationResult.suggestions.map(
                (s: { excelColumn: string; hwpxRow: number; hwpxCol: number; labelText?: string }) => ({
                  templateField: s.labelText || s.excelColumn,
                  dataColumn: s.excelColumn,
                  hwpxRow: s.hwpxRow,
                  hwpxCol: s.hwpxCol,
                  confidence: 0.8,
                })
              );
              // 기존 매핑에 suggestion 추가 (중복 제거)
              const existingCellKeys = new Set(newMappings.map(m => `${m.hwpxRow}-${m.hwpxCol}`));
              const uniqueSuggestions = suggestionMappings.filter(
                s => !existingCellKeys.has(`${s.hwpxRow}-${s.hwpxCol}`)
              );
              if (uniqueSuggestions.length > 0) {
                setMappings([...newMappings, ...uniqueSuggestions]);
              }
            }
          } else {
            // 레거시: validationResult가 없으면 별도로 검증
            setTimeout(() => {
              validateMappings(newMappings);
            }, 100);
          }
        }
      } else {
        // Excel/CSV 템플릿 AI 자동 매핑
        const templateFields = templateFile.placeholders || templateFile.columns || [];
        const dataColumns = dataFile.columns || [];

        try {
          // Build compact sample: merge first date-like value per column from ALL rows
          // then prepend it so the API finds dates even for columns with sparse data
          let compactSample = previewData?.slice(0, 5);
          if (previewData && previewData.length > 5) {
            const mergedDateRow: Record<string, unknown> = {};
            for (const col of dataColumns) {
              for (const row of previewData) {
                const val = row[col];
                if (val !== undefined && val !== null && /^\d{1,2}\s*\(/.test(String(val))) {
                  mergedDateRow[col] = val;
                  break;
                }
              }
            }
            compactSample = [mergedDateRow, ...(previewData?.slice(0, 5) || [])];
          }

          console.log('[Converter] AI mapping request:', {
            templateFields: templateFields.length,
            dataColumns: dataColumns.length,
            templateFieldsSample: templateFields.slice(0, 5),
            dataColumnsSample: dataColumns.slice(0, 5),
            hasTemplatePreview: !!templateFile.templatePreview,
            hasSampleData: !!compactSample?.length,
            metadata: dataFile.metadata,
          });

          const res = await fetch('/api/converter/ai-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              templateColumns: templateFields,
              dataColumns,
              templateSampleData: templateFile.templatePreview?.slice(0, 2),
              dataSampleData: compactSample,
              dataMetadata: dataFile.metadata,
            }),
          });

          console.log('[Converter] AI mapping response status:', res.status);
          if (res.ok) {
            const result = await res.json();
            console.log('[Converter] AI mapping result:', { success: result.success, mappedCount: result.mappedCount, total: result.totalTemplate });
            if (result.success && result.mappings) {
              // AI 매핑 결과를 MappingItem[] 형태로 변환
              const aiMappings: MappingItem[] = (result.mappings as Array<{
                templateField: string;
                dataColumn: string;
                confidence: number;
                isMetadata?: boolean;
                metadataValue?: string;
              }>).map(m => ({
                templateField: m.templateField,
                dataColumn: m.dataColumn,
                confidence: m.confidence,
                isMetadata: m.isMetadata,
                metadataValue: m.metadataValue,
              }));

              // 매핑되지 않은 템플릿 필드도 빈 매핑으로 추가
              const mappedFields = new Set(aiMappings.map(m => m.templateField));
              const unmappedEntries: MappingItem[] = templateFields
                .filter(f => !mappedFields.has(f))
                .map(f => ({ templateField: f, dataColumn: '', confidence: 0 }));

              setMappings([...aiMappings, ...unmappedEntries]);
            } else {
              throw new Error('AI mapping returned no results');
            }
          } else {
            throw new Error('AI mapping request failed');
          }
        } catch (aiError) {
          console.error('AI mapping failed, falling back to name matching:', aiError);
          // fallback: 기존 이름 매칭
          const newMappings: MappingItem[] = templateFields.map(field => {
            const exactMatch = dataColumns.find(col =>
              col.toLowerCase() === field.toLowerCase()
            );
            const partialMatch = !exactMatch ? dataColumns.find(col =>
              col.toLowerCase().includes(field.toLowerCase()) ||
              field.toLowerCase().includes(col.toLowerCase())
            ) : null;

            return {
              templateField: field,
              dataColumn: exactMatch || partialMatch || '',
              confidence: exactMatch ? 1.0 : partialMatch ? 0.7 : 0,
            };
          });
          setMappings(newMappings);
        }
      }
    } catch (error) {
      console.error('Auto mapping error:', error);
      alert('자동 매핑 중 오류가 발생했습니다.');
    } finally {
      setAutoMapping(false);
    }
  };

  // 매핑 수정
  const handleMappingChange = (templateField: string, dataColumn: string) => {
    setMappings(prev => {
      const existing = prev.find(m => m.templateField === templateField);
      if (existing) {
        return prev.map(m =>
          m.templateField === templateField
            ? { ...m, dataColumn, confidence: 1.0 }
            : m
        );
      } else {
        return [...prev, { templateField, dataColumn, confidence: 1.0 }];
      }
    });
  };

  // 보고서 생성
  const handleGenerate = async () => {
    if (!templateFile || !dataFile) {
      alert('템플릿과 데이터 파일을 모두 업로드해주세요.');
      return;
    }

    if (mappings.length === 0) {
      alert('컬럼 매핑을 설정해주세요.');
      return;
    }

    setGenerating(true);
    try {
      if (templateFile.format === 'hwpx') {
        // HWPX 생성 (기존 API 사용)
        const formData = new FormData();
        formData.append('template', templateFile.file);
        formData.append('excel', dataFile.file);
        if (dataFile.selectedSheet) {
          formData.append('sheetName', dataFile.selectedSheet);
        }
        // 매핑 형식 변환
        const hwpxMappings = mappings.map(m => ({
          hwpxField: m.templateField,
          excelColumn: m.dataColumn,
        }));
        formData.append('mappings', JSON.stringify(hwpxMappings));
        if (fileNameColumn) {
          formData.append('fileNameColumn', fileNameColumn);
        }

        const res = await fetch('/api/hwpx/generate', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          throw new Error('HWPX 생성 실패');
        }

        // ZIP 다운로드
        const blob = await res.blob();
        downloadBlob(blob, `hwpx_output_${Date.now()}.zip`);
      } else {
        // Excel/CSV 템플릿 기반 생성
        const formData = new FormData();
        formData.append('template', templateFile.file);
        formData.append('data', dataFile.file);
        formData.append('templateFormat', templateFile.format);
        formData.append('dataFormat', dataFile.format);
        if (templateFile.selectedSheet) {
          formData.append('templateSheet', templateFile.selectedSheet);
        }
        if (dataFile.selectedSheet) {
          formData.append('dataSheet', dataFile.selectedSheet);
        }
        formData.append('mappings', JSON.stringify(mappings));
        if (fileNameColumn) {
          formData.append('fileNameColumn', fileNameColumn);
        }

        const res = await fetch('/api/converter/generate', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const error = await res.text();
          throw new Error(error || '보고서 생성 실패');
        }

        const blob = await res.blob();
        const ext = templateFile.format;
        downloadBlob(blob, `report_${Date.now()}.${ext}`);
      }

      alert('보고서 생성이 완료되었습니다!');
    } catch (error) {
      console.error('Generate error:', error);
      alert('보고서 생성 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : ''));
    } finally {
      setGenerating(false);
    }
  };

  // Blob 다운로드 헬퍼
  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 파일 크기 포맷
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (authLoading) {
    return <CubeLoader />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 사이드바 */}
      <aside className="w-48 bg-white border-r border-gray-200 flex flex-col py-4 px-3 flex-shrink-0">
        <button
          onClick={() => router.push('/')}
          className="flex items-center gap-3 px-3 py-2 mb-6 hover:bg-gray-50 rounded-xl transition-all"
        >
          <div className="w-10 h-10 bg-teal-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900">Report Tool</span>
        </button>

        <nav className="flex-1 flex flex-col gap-1">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all hover:bg-gray-100 text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span>홈</span>
          </button>
          <button
            onClick={() => router.push('/templates')}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all hover:bg-gray-100 text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>템플릿</span>
          </button>
          <button
            onClick={() => router.push('/hwpx')}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all hover:bg-gray-100 text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span>HWPX 생성</span>
          </button>
          <button
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all bg-blue-50 text-blue-700 font-medium"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Converter</span>
          </button>
          <button
            onClick={() => router.push('/reports')}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all hover:bg-gray-100 text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span>보고서</span>
          </button>
        </nav>

        <div className="mt-auto pt-4 border-t border-gray-200">
          {user && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="w-9 h-9 bg-teal-100 rounded-full flex items-center justify-center text-teal-600 font-medium flex-shrink-0">
                  {user.email?.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {user.email?.split('@')[0]}
                  </p>
                </div>
              </div>
              <button
                onClick={signOut}
                className="flex items-center gap-3 px-3 py-2 rounded-xl transition-all hover:bg-red-50 text-gray-500 hover:text-red-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-sm">로그아웃</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-7xl mx-auto">
          {/* 헤더 */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-gray-900">템플릿 기반 보고서 생성</h1>
            <p className="text-gray-500 mt-1">템플릿 파일과 데이터 파일을 매핑하여 보고서를 일괄 생성합니다</p>
          </div>

          {/* 지원 형식 배지 */}
          <div className="flex flex-wrap gap-4 mb-8">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">템플릿:</span>
              <span className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-medium">Excel (.xlsx)</span>
              <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">CSV (.csv)</span>
              <span className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">HWPX (.hwpx)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">데이터:</span>
              <span className="px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-medium">Excel</span>
              <span className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">CSV</span>
              <span className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">JSON</span>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {/* 왼쪽: 파일 업로드 및 매핑 */}
            <div className="col-span-5 space-y-6">
              {/* 1. 템플릿 업로드 */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 text-sm font-bold">1</span>
                  템플릿 파일
                </h3>
                <input
                  ref={templateInputRef}
                  type="file"
                  accept=".xlsx,.csv,.hwpx"
                  onChange={handleTemplateSelect}
                  className="hidden"
                />
                {templateFile ? (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-lg ${FORMAT_COLORS[templateFile.format]?.replace('text-', 'bg-')?.replace('-600', '-50') || 'bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${FORMAT_COLORS[templateFile.format] || 'bg-gray-100 text-gray-600'}`}>
                          <span className="text-lg">
                            {templateFile.format === 'xlsx' ? '📊' :
                             templateFile.format === 'csv' ? '📋' :
                             templateFile.format === 'hwpx' ? '📄' : '📁'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{templateFile.name}</p>
                          <p className="text-sm text-gray-500">
                            {FORMAT_LABELS[templateFile.format] || templateFile.format} • {formatFileSize(templateFile.size)}
                          </p>
                        </div>
                        <button
                          onClick={() => templateInputRef.current?.click()}
                          className="text-blue-600 hover:text-blue-700 text-sm"
                        >
                          변경
                        </button>
                      </div>
                    </div>

                    {/* 시트 선택 */}
                    {templateFile.sheets && templateFile.sheets.length > 1 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">시트 선택</label>
                        <select
                          value={templateFile.selectedSheet || ''}
                          onChange={(e) => handleSheetChange(e.target.value, 'template')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          {templateFile.sheets.map((sheet) => (
                            <option key={sheet} value={sheet}>{sheet}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 필드 정보 */}
                    {templateFile.placeholders && templateFile.placeholders.length > 0 && (
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">{templateFile.placeholders.length}개 필드:</span>
                        <span className="ml-1 text-gray-500">
                          {templateFile.placeholders.slice(0, 5).join(', ')}
                          {templateFile.placeholders.length > 5 && ` 외 ${templateFile.placeholders.length - 5}개`}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => templateInputRef.current?.click()}
                    disabled={analyzingTemplate}
                    className="w-full p-6 border-2 border-dashed border-orange-300 rounded-lg hover:border-orange-400 hover:bg-orange-50 transition-all text-center"
                  >
                    {analyzingTemplate ? (
                      <div className="flex flex-col items-center">
                        <svg className="animate-spin h-8 w-8 mb-2 text-orange-500" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <p className="text-gray-500">분석 중...</p>
                      </div>
                    ) : (
                      <>
                        <span className="text-3xl block mb-2">📑</span>
                        <p className="text-gray-600 font-medium">템플릿 파일 선택</p>
                        <p className="text-sm text-gray-400 mt-1">xlsx, csv, hwpx</p>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* 2. 데이터 파일 업로드 */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-sm font-bold">2</span>
                  데이터 파일
                </h3>
                <input
                  ref={dataInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.json"
                  onChange={handleDataSelect}
                  className="hidden"
                />
                {dataFile ? (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-lg ${FORMAT_COLORS[dataFile.format]?.replace('text-', 'bg-')?.replace('-600', '-50') || 'bg-gray-50'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${FORMAT_COLORS[dataFile.format] || 'bg-gray-100 text-gray-600'}`}>
                          <span className="text-lg">
                            {dataFile.format === 'xlsx' || dataFile.format === 'xls' ? '📊' :
                             dataFile.format === 'csv' ? '📋' :
                             dataFile.format === 'json' ? '📦' : '📁'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{dataFile.name}</p>
                          <p className="text-sm text-gray-500">
                            {FORMAT_LABELS[dataFile.format] || dataFile.format} • {formatFileSize(dataFile.size)}
                            {dataFile.rowCount !== undefined && ` • ${dataFile.rowCount}행`}
                          </p>
                        </div>
                        <button
                          onClick={() => dataInputRef.current?.click()}
                          className="text-blue-600 hover:text-blue-700 text-sm"
                        >
                          변경
                        </button>
                      </div>
                    </div>

                    {/* 시트 선택 */}
                    {dataFile.sheets && dataFile.sheets.length > 1 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">시트 선택</label>
                        <select
                          value={dataFile.selectedSheet || ''}
                          onChange={(e) => handleSheetChange(e.target.value, 'data')}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          {dataFile.sheets.map((sheet) => (
                            <option key={sheet} value={sheet}>{sheet}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 컬럼 정보 */}
                    {dataFile.columns && dataFile.columns.length > 0 && (
                      <div className="text-sm text-gray-600">
                        <span className="font-medium">{dataFile.columns.length}개 컬럼:</span>
                        <span className="ml-1 text-gray-500">
                          {dataFile.columns.slice(0, 5).join(', ')}
                          {dataFile.columns.length > 5 && ` 외 ${dataFile.columns.length - 5}개`}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => dataInputRef.current?.click()}
                    disabled={analyzingData}
                    className="w-full p-6 border-2 border-dashed border-blue-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-center"
                  >
                    {analyzingData ? (
                      <div className="flex flex-col items-center">
                        <svg className="animate-spin h-8 w-8 mb-2 text-blue-500" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <p className="text-gray-500">분석 중...</p>
                      </div>
                    ) : (
                      <>
                        <span className="text-3xl block mb-2">📊</span>
                        <p className="text-gray-600 font-medium">데이터 파일 선택</p>
                        <p className="text-sm text-gray-400 mt-1">xlsx, xls, csv, json</p>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* 3. 컬럼 매핑 */}
              {templateFile && dataFile && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                      <span className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-sm font-bold">3</span>
                      컬럼 매핑
                    </h3>
                    <button
                      onClick={handleAutoMapping}
                      disabled={autoMapping}
                      className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 transition-all flex items-center gap-1"
                    >
                      {autoMapping ? (
                        <>
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          매핑 중...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          AI 자동 매핑
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[400px] overflow-y-auto">
                    {(templateFile.placeholders || templateFile.columns || []).map((field, idx) => {
                      const mapping = mappings.find(m => m.templateField === field);
                      return (
                        <div key={idx} className="flex items-center gap-3">
                          <div className="flex-1 px-3 py-2 bg-orange-50 rounded-lg text-sm text-gray-700 truncate">
                            {field}
                          </div>
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                          </svg>
                          {mapping?.isMetadata ? (
                            <div className="flex-1 px-3 py-2 border border-blue-300 bg-blue-50 rounded-lg text-sm text-blue-700 truncate" title={`메타데이터: ${mapping.metadataValue}`}>
                              [META] {mapping.metadataValue}
                            </div>
                          ) : (
                            <select
                              value={mapping?.dataColumn || ''}
                              onChange={(e) => handleMappingChange(field, e.target.value)}
                              className={`flex-1 px-3 py-2 border rounded-lg text-sm ${
                                mapping?.dataColumn
                                  ? mapping.confidence && mapping.confidence < 1
                                    ? 'border-yellow-300 bg-yellow-50'
                                    : 'border-green-300 bg-green-50'
                                  : 'border-gray-300'
                              }`}
                            >
                              <option value="">-- 선택 --</option>
                              {(dataFile.columns || []).map((col, colIdx) => (
                                <option key={colIdx} value={col}>{col}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* 파일명 컬럼 선택 */}
                  {dataFile.columns && dataFile.columns.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        파일명 컬럼 (선택사항)
                      </label>
                      <select
                        value={fileNameColumn}
                        onChange={(e) => setFileNameColumn(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      >
                        <option value="">기본 (순번 사용)</option>
                        {dataFile.columns.map((col, idx) => (
                          <option key={idx} value={col}>{col}</option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        생성되는 파일의 이름으로 사용할 컬럼
                      </p>
                    </div>
                  )}

                  {/* 검증 결과 UI */}
                  {templateFile.format === 'hwpx' && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          매핑 검증
                        </h4>
                        <button
                          onClick={() => validateMappings(mappings)}
                          disabled={validating || mappings.length === 0}
                          className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50 flex items-center gap-1"
                        >
                          {validating ? (
                            <>
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              검증 중...
                            </>
                          ) : (
                            '검증하기'
                          )}
                        </button>
                      </div>

                      {validationResult && (
                        <div className="space-y-3">
                          {/* 검증 요약 */}
                          <div className={`p-3 rounded-lg text-sm ${
                            validationResult.isValid
                              ? 'bg-green-50 border border-green-200'
                              : 'bg-yellow-50 border border-yellow-200'
                          }`}>
                            <div className="flex items-center justify-between">
                              <span className={validationResult.isValid ? 'text-green-700' : 'text-yellow-700'}>
                                {validationResult.isValid ? (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    모든 필수 필드가 매핑됨
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1">
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                    </svg>
                                    {validationResult.missingFields}개 필드 누락
                                  </span>
                                )}
                              </span>
                              <span className="text-gray-500 text-xs">
                                {validationResult.mappedFields}/{validationResult.totalFields} 매핑됨
                              </span>
                            </div>
                          </div>

                          {/* 누락된 필드 목록 */}
                          {validationResult.issues.filter(i => i.type === 'missing').length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs text-gray-600 font-medium">누락된 필드:</p>
                              {validationResult.issues
                                .filter(i => i.type === 'missing')
                                .map((issue, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between p-2 bg-red-50 border border-red-100 rounded text-xs"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-red-600 font-medium">{issue.field}</span>
                                      {issue.hwpxRow !== undefined && issue.hwpxCol !== undefined && (
                                        <span className="text-gray-400">
                                          [{issue.hwpxRow}, {issue.hwpxCol}]
                                        </span>
                                      )}
                                    </div>
                                    {issue.suggestedExcelColumn && (
                                      <span className="text-blue-600">
                                        추천: {issue.suggestedExcelColumn}
                                      </span>
                                    )}
                                  </div>
                                ))}
                            </div>
                          )}

                          {/* 제안된 매핑 적용 버튼 */}
                          {validationResult.suggestions.length > 0 && (
                            <button
                              onClick={() => applySuggestions(validationResult.suggestions)}
                              className="w-full py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-all flex items-center justify-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                              </svg>
                              {validationResult.suggestions.length}개 제안 매핑 추가
                            </button>
                          )}

                          {/* 경고 메시지 */}
                          {validationResult.issues.filter(i => i.type === 'warning').length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs text-gray-600 font-medium">경고:</p>
                              {validationResult.issues
                                .filter(i => i.type === 'warning')
                                .map((issue, idx) => (
                                  <div
                                    key={idx}
                                    className="p-2 bg-orange-50 border border-orange-100 rounded text-xs text-orange-700"
                                  >
                                    {issue.message}
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 생성 버튼 */}
              <button
                onClick={handleGenerate}
                disabled={generating || !templateFile || !dataFile || mappings.length === 0}
                className="w-full py-4 bg-gradient-to-r from-teal-600 to-blue-600 text-white rounded-xl hover:from-teal-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    보고서 생성 중...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    보고서 일괄 생성
                  </>
                )}
              </button>
            </div>

            {/* 오른쪽: 템플릿 기반 미리보기 */}
            <div className="col-span-7">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-full">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">보고서 미리보기</h3>
                  {templateFile && dataFile && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className={`px-2 py-1 rounded ${FORMAT_COLORS[templateFile.format] || 'bg-gray-100 text-gray-600'}`}>
                        {FORMAT_LABELS[templateFile.format] || '템플릿'}
                      </span>
                      <span className="text-gray-400">+</span>
                      <span className={`px-2 py-1 rounded ${FORMAT_COLORS[dataFile.format] || 'bg-gray-100 text-gray-600'}`}>
                        {FORMAT_LABELS[dataFile.format] || '데이터'} ({dataFile.rowCount || 0}행)
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-6">
                  {analyzingTemplate || analyzingData ? (
                    <div className="text-center py-12">
                      <svg className="animate-spin h-8 w-8 mx-auto mb-3 text-blue-600" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-gray-500">분석 중...</p>
                    </div>
                  ) : templateFile?.format === 'hwpx' && templateFile.hwpxTemplate?.tables?.length ? (
                    // HWPX 템플릿: 실제 테이블 구조 표시 (HWPX 페이지와 동일)
                    <div className="space-y-4">
                      {/* 섹션 목록 */}
                      {templateFile.hwpxTemplate.sections.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {templateFile.hwpxTemplate.sections.map((section, idx) => (
                            <span key={idx} className="px-3 py-1 bg-orange-50 text-orange-700 text-sm rounded-full">
                              {section}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* HWPX 테이블 미리보기 */}
                      {templateFile.hwpxTemplate.tables.map((table, tableIdx) => {
                        // 병합된 셀 추적
                        const occupiedCells = new Set<string>();
                        table.cells.forEach(cell => {
                          const colSpan = cell.colSpan || 1;
                          const rowSpan = cell.rowSpan || 1;
                          for (let r = 0; r < rowSpan; r++) {
                            for (let c = 0; c < colSpan; c++) {
                              if (r === 0 && c === 0) continue;
                              occupiedCells.add(`${cell.rowIndex + r}-${cell.colIndex + c}`);
                            }
                          }
                        });

                        const maxRows = table.rowCount; // 모든 행 표시
                        // 첫 번째 데이터 행 가져오기
                        const firstDataRow = previewData?.[0] || {};

                        return (
                          <div key={tableIdx} className="border border-gray-200 rounded-lg overflow-auto max-h-[500px]">
                            <table className="w-full text-sm border-collapse">
                              <tbody>
                                {Array.from({ length: maxRows }).map((_, rowIdx) => (
                                  <tr key={rowIdx}>
                                    {Array.from({ length: table.colCount }).map((_, colIdx) => {
                                      if (occupiedCells.has(`${rowIdx}-${colIdx}`)) {
                                        return null;
                                      }

                                      const cell = table.cells.find(c => c.rowIndex === rowIdx && c.colIndex === colIdx);
                                      // 이 셀에 매핑된 데이터 찾기 (HWPX: 셀 위치 기반 매핑)
                                      const cellText = cell?.text || '';
                                      const mapping = mappings.find(m =>
                                        m.hwpxRow === rowIdx && m.hwpxCol === colIdx
                                      );
                                      const mappedValue = mapping?.dataColumn ? firstDataRow[mapping.dataColumn] : null;
                                      const colSpan = cell?.colSpan || 1;
                                      const rowSpan = cell?.rowSpan || 1;

                                      return (
                                        <td
                                          key={colIdx}
                                          colSpan={colSpan > 1 ? colSpan : undefined}
                                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                                          className={`px-2 py-1.5 border border-gray-300 text-xs ${
                                            cell?.isHeader ? 'bg-gray-100 font-medium text-center' : 'bg-white'
                                          } ${
                                            mapping ? 'bg-purple-100' : ''
                                          }`}
                                          style={{ minWidth: '40px', maxWidth: '150px' }}
                                          title={mapping ? `[${rowIdx},${colIdx}] ← ${mapping.dataColumn}` : cellText}
                                        >
                                          {mapping && mappedValue !== null && mappedValue !== undefined ? (
                                            <span className="text-purple-800 font-medium truncate block">
                                              {safeCellDisplay(mappedValue)}
                                            </span>
                                          ) : mapping ? (
                                            <span className="flex items-center justify-center gap-1 text-purple-600">
                                              <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                              </svg>
                                              <span className="truncate">{mapping.dataColumn}</span>
                                            </span>
                                          ) : (
                                            <span className="truncate block text-gray-600">{cellText}</span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {/* 모든 행 표시됨 */}
                          </div>
                        );
                      })}

                      {/* 매핑 통계 */}
                      <div className="flex items-center justify-between py-3 px-4 bg-gray-50 border rounded-lg text-sm">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-purple-500 rounded-full" />
                            <span className="text-gray-600">매핑됨: {mappings.length}</span>
                          </span>
                        </div>
                        {dataFile && (
                          <span className="text-gray-400">
                            총 {dataFile.rowCount || 0}개 보고서 생성 예정
                          </span>
                        )}
                      </div>
                    </div>
                  ) : templateFile && templateFile.format !== 'hwpx' && (templateFile.columns || templateFile.placeholders) && previewData && previewData.length > 0 ? (
                    // Excel/CSV 템플릿: 실제 테이블 구조로 표시
                    <div className="space-y-4">
                      {/* 템플릿 테이블 미리보기 */}
                      <div className="border border-gray-200 rounded-lg overflow-auto max-h-[500px]">
                        <table className="w-full text-sm border-collapse">
                          <thead className="sticky top-0 bg-gray-100">
                            <tr>
                              {(templateFile.columns || templateFile.placeholders || []).map((col, colIdx) => {
                                const mapping = mappings.find(m => m.templateField === col);
                                return (
                                  <th
                                    key={colIdx}
                                    className={`px-3 py-2 border border-gray-300 text-xs font-medium text-center ${
                                      mapping ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'
                                    }`}
                                    style={{ minWidth: '80px' }}
                                  >
                                    <div className="truncate">{col}</div>
                                    {mapping && (
                                      <div className="text-[10px] text-purple-600 mt-0.5 truncate">
                                        ← {mapping.isMetadata ? `[META] ${mapping.metadataValue}` : mapping.dataColumn}
                                      </div>
                                    )}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody>
                            {/* 첫 5개 데이터 행 표시 */}
                            {previewData.slice(0, 5).map((row, rowIdx) => (
                              <tr key={rowIdx}>
                                {(templateFile.columns || templateFile.placeholders || []).map((col, colIdx) => {
                                  const mapping = mappings.find(m => m.templateField === col);
                                  const value = mapping?.isMetadata
                                    ? mapping.metadataValue
                                    : mapping?.dataColumn ? row[mapping.dataColumn] : null;
                                  return (
                                    <td
                                      key={colIdx}
                                      className={`px-3 py-2 border border-gray-200 text-xs text-center ${
                                        mapping?.isMetadata ? 'bg-blue-50' : mapping ? 'bg-purple-50' : 'bg-white'
                                      }`}
                                    >
                                      {value !== null && value !== undefined ? (
                                        <span className={`truncate block ${mapping?.isMetadata ? 'text-blue-700' : 'text-gray-700'}`}>{safeCellDisplay(value)}</span>
                                      ) : mapping ? (
                                        <span className="text-gray-300 italic">(빈 값)</span>
                                      ) : (
                                        <span className="text-red-400 text-[10px]">미매핑</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {previewData.length > 5 && (
                          <p className="text-center text-sm text-gray-400 py-2 bg-gray-50">
                            ... {previewData.length - 5}개 행 더 있음 (총 {dataFile?.rowCount || previewData.length}개)
                          </p>
                        )}
                      </div>

                      {/* 매핑 통계 */}
                      <div className="flex items-center justify-between py-3 px-4 bg-gray-50 border rounded-lg text-sm">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-purple-500 rounded-full" />
                            <span className="text-gray-600">매핑됨: {mappings.filter(m => m.dataColumn).length}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-red-400 rounded-full" />
                            <span className="text-gray-600">미매핑: {(templateFile.columns || templateFile.placeholders || []).length - mappings.filter(m => m.dataColumn).length}</span>
                          </span>
                        </div>
                        <span className="text-gray-400">
                          총 {dataFile?.rowCount || previewData.length}행 데이터 → 1개 보고서 생성
                        </span>
                      </div>
                    </div>
                  ) : templateFile?.format === 'hwpx' && templateFile.hwpxTemplate?.tables?.length && !dataFile ? (
                    // HWPX 템플릿만 업로드된 경우: 테이블 구조 표시
                    <div className="space-y-4">
                      <div className="text-center py-4 text-gray-500 bg-orange-50 rounded-lg">
                        <p className="font-medium">HWPX 템플릿 분석 완료</p>
                        <p className="text-sm">데이터 파일을 업로드하여 매핑을 시작하세요</p>
                      </div>

                      {/* 섹션 목록 */}
                      {templateFile.hwpxTemplate.sections.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {templateFile.hwpxTemplate.sections.map((section, idx) => (
                            <span key={idx} className="px-3 py-1 bg-orange-50 text-orange-700 text-sm rounded-full">
                              {section}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* HWPX 테이블 미리보기 */}
                      {templateFile.hwpxTemplate.tables.map((table, tableIdx) => {
                        const occupiedCells = new Set<string>();
                        table.cells.forEach(cell => {
                          const colSpan = cell.colSpan || 1;
                          const rowSpan = cell.rowSpan || 1;
                          for (let r = 0; r < rowSpan; r++) {
                            for (let c = 0; c < colSpan; c++) {
                              if (r === 0 && c === 0) continue;
                              occupiedCells.add(`${cell.rowIndex + r}-${cell.colIndex + c}`);
                            }
                          }
                        });

                        const maxRows = table.rowCount; // 모든 행 표시

                        return (
                          <div key={tableIdx} className="border border-gray-200 rounded-lg overflow-auto max-h-[400px]">
                            <table className="w-full text-sm border-collapse">
                              <tbody>
                                {Array.from({ length: maxRows }).map((_, rowIdx) => (
                                  <tr key={rowIdx}>
                                    {Array.from({ length: table.colCount }).map((_, colIdx) => {
                                      if (occupiedCells.has(`${rowIdx}-${colIdx}`)) {
                                        return null;
                                      }

                                      const cell = table.cells.find(c => c.rowIndex === rowIdx && c.colIndex === colIdx);
                                      const colSpan = cell?.colSpan || 1;
                                      const rowSpan = cell?.rowSpan || 1;

                                      return (
                                        <td
                                          key={colIdx}
                                          colSpan={colSpan > 1 ? colSpan : undefined}
                                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                                          className={`px-2 py-1.5 border border-gray-300 text-xs ${
                                            cell?.isHeader ? 'bg-gray-100 font-medium text-center' : 'bg-white'
                                          }`}
                                          style={{ minWidth: '40px', maxWidth: '150px' }}
                                        >
                                          <span className="truncate block text-gray-600">{cell?.text || ''}</span>
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {/* 모든 행 표시됨 */}
                          </div>
                        );
                      })}
                    </div>
                  ) : templateFile && templateFile.format !== 'hwpx' && templateFile.templatePreview && !dataFile ? (
                    // Excel/CSV 템플릿만 업로드된 경우: 테이블 구조 표시
                    <div className="space-y-4">
                      <div className="text-center py-4 text-gray-500 bg-green-50 rounded-lg">
                        <p className="font-medium">템플릿 분석 완료 ({templateFile.columns?.length || 0}개 컬럼)</p>
                        <p className="text-sm">데이터 파일을 업로드하여 매핑을 시작하세요</p>
                      </div>

                      <div className="border border-gray-200 rounded-lg overflow-auto max-h-[400px]">
                        <table className="w-full text-sm border-collapse">
                          <thead className="sticky top-0 bg-gray-100">
                            <tr>
                              {(templateFile.columns || []).map((col, colIdx) => (
                                <th
                                  key={colIdx}
                                  className="px-3 py-2 border border-gray-300 text-xs font-medium text-gray-700 text-center"
                                  style={{ minWidth: '80px' }}
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {templateFile.templatePreview.slice(0, 3).map((row, rowIdx) => (
                              <tr key={rowIdx}>
                                {(templateFile.columns || []).map((col, colIdx) => (
                                  <td key={colIdx} className="px-3 py-2 border border-gray-200 text-xs text-center text-gray-500">
                                    {row[col] !== undefined ? String(row[col]) : ''}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : templateFile && !dataFile ? (
                    <div className="text-center py-12 text-gray-400">
                      <svg className="w-16 h-16 mx-auto mb-4 text-orange-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-lg mb-2">템플릿이 준비되었습니다</p>
                      <p className="text-sm">데이터 파일을 업로드하여 매핑을 시작하세요</p>
                      <p className="text-xs mt-2 text-gray-300">
                        {templateFile.placeholders?.length || templateFile.columns?.length || 0}개 필드 감지됨
                      </p>
                    </div>
                  ) : templateFile && dataFile && mappings.length === 0 ? (
                    <div className="text-center py-12 text-gray-400">
                      <svg className="w-16 h-16 mx-auto mb-4 text-purple-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <p className="text-lg mb-2">매핑을 설정하세요</p>
                      <p className="text-sm">&quot;AI 자동 매핑&quot; 버튼을 클릭하거나 수동으로 매핑하세요</p>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-lg mb-2">템플릿 파일을 업로드하세요</p>
                      <p className="text-sm">템플릿과 데이터를 매핑하여 보고서를 생성합니다</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 플로팅 컨텍스트 채팅 버튼 */}
      <ContextChat
        onContextUpdate={(ctx: MappingContext) => setMappingContext(ctx)}
        currentContext={mappingContext || undefined}
      />
    </div>
  );
}
