'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import CubeLoader from '@/components/CubeLoader';
import ContextChat, { type MappingContext } from '@/app/components/ContextChat';

// 지원하는 템플릿 형식
// type TemplateFormat = 'xlsx' | 'csv' | 'hwpx';
// 지원하는 데이터 형식
// type DataFormat = 'xlsx' | 'xls' | 'csv' | 'json';

// 진행률 정보 인터페이스
interface ProgressInfo {
  phase: 'init' | 'reading' | 'generating' | 'packaging' | 'complete' | 'error';
  current: number;
  total: number;
  percentage: number;
  message: string;
  currentFile?: string;
}

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

// 3-Way Diff 검증 결과 타입
interface VerificationIssue {
  personName: string;
  personIndex: number;
  cell: {
    hwpxRow: number;
    hwpxCol: number;
    fieldName: string;
    excelColumn: string;
    templateValue: string;
    excelValue: string;
    generatedValue: string;
    status: 'match' | 'mismatch' | 'template_leak' | 'missing' | 'empty_ok';
  };
  severity: 'critical' | 'warning' | 'info';
  message: string;
  agentName: string;
}

interface VerificationAgentResult {
  agentName: string;
  description: string;
  status: 'pass' | 'warning' | 'fail';
  issueCount: number;
  issues: VerificationIssue[];
  executionTimeMs: number;
}

interface VerificationResult {
  success?: boolean;
  status: 'pass' | 'warning' | 'fail';
  sampledCount: number;
  totalCount: number;
  sampledNames: string[];
  accuracy: number;
  agentResults: VerificationAgentResult[];
  allIssues: VerificationIssue[];
  aiSummary: string;
  totalExecutionTimeMs: number;
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

  // 템플릿/데이터 파일의 최신 값을 추적하는 ref (클로저 문제 해결)
  const templateFileRef = useRef<TemplateInfo | null>(null);
  const dataFileRef = useRef<FileInfo | null>(null);
  const mappingsRef = useRef<MappingItem[]>([]);

  // 상태
  const [templateFile, setTemplateFile] = useState<TemplateInfo | null>(null);
  const [dataFile, setDataFile] = useState<FileInfo | null>(null);
  const [mappings, setMappingsState] = useState<MappingItem[]>([]);
  const [, setIsAttendanceReport] = useState(false);
  const isAttendanceReportRef = useRef(false);

  // mappings 상태와 ref를 동시에 업데이트하는 래퍼 함수
  const setMappings = (newMappings: MappingItem[] | ((prev: MappingItem[]) => MappingItem[])) => {
    if (typeof newMappings === 'function') {
      setMappingsState(prev => {
        const result = newMappings(prev);
        mappingsRef.current = result;
        return result;
      });
    } else {
      mappingsRef.current = newMappings;
      setMappingsState(newMappings);
    }
  };
  const [fileNameColumn, setFileNameColumn] = useState<string>('');

  // 로딩 상태
  const [analyzingTemplate, setAnalyzingTemplate] = useState(false);
  const [analyzingData, setAnalyzingData] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [autoMapping, setAutoMapping] = useState(false);

  // AI 매핑 프로그레스 상태
  const [mappingProgress, setMappingProgress] = useState(0);

  // 직접 매핑 아코디언 상태 (기본 접힌 상태) - 추후 확장용
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isDirectMappingOpen, setIsDirectMappingOpen] = useState(false);

  // 미리보기 데이터
  const [previewData, setPreviewData] = useState<Record<string, unknown>[] | null>(null);

  // 매핑 검증 상태 (AI 매핑 시 사용)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [validating, setValidating] = useState(false);

  // 3-Way Diff 검증 상태
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [generatedZipBlob, setGeneratedZipBlob] = useState<Blob | null>(null);
  const [generatedFileName, setGeneratedFileName] = useState<string>('');
  const [lastHwpxMappings, setLastHwpxMappings] = useState<Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }>>([]);
  // 검증 단계 상태: idle(초기) → waiting(매핑완료,생성대기) → running(검증중) → complete(완료)
  const [verificationPhase, setVerificationPhase] = useState<'idle' | 'waiting' | 'running' | 'complete'>('idle');

  // 매핑 컨텍스트 (AI 매핑에 참고할 도메인 정보)
  const [mappingContext, setMappingContext] = useState<MappingContext | null>(null);

  // 진행률 상태
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

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
    templateFileRef.current = fileInfo; // ref도 즉시 업데이트
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
          const updatedTemplateFile: TemplateInfo = {
            ...fileInfo,
            columns: result.columns,
            sheets: result.sheets,
            selectedSheet: result.sheets?.[0],
            placeholders: result.columns, // Excel 템플릿의 컬럼이 곧 필드
            templatePreview: result.preview, // 템플릿 미리보기 데이터 저장
          };
          setTemplateFile(updatedTemplateFile);
          templateFileRef.current = updatedTemplateFile; // ref도 업데이트
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
    dataFileRef.current = fileInfo; // ref도 즉시 업데이트
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
        const updatedDataFile = {
          ...fileInfo,
          columns: result.columns,
          sheets: result.sheets,
          selectedSheet: result.sheets?.[0],
          rowCount: result.rowCount,
          preview: result.preview,
        };
        setDataFile(updatedDataFile);
        dataFileRef.current = updatedDataFile; // ref도 업데이트

        setPreviewData(result.preview || null);

        // 자동 매핑 제거 - 사용자가 "AI 자동 매핑" 버튼을 직접 클릭하도록 함
        // (기존 자동 호출은 React 상태 업데이트 타이밍 이슈로 alert 발생)
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
          setTemplateFile(prev => {
            const updated = prev ? {
              ...prev,
              columns: result.columns,
              placeholders: result.columns,
            } : null;
            if (updated) templateFileRef.current = updated;
            return updated;
          });
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

  // 제안된 매핑 적용 (향후 UI에서 사용 예정)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // AI 자동 매핑 (프로그레스바 포함)
  const handleAutoMapping = async () => {
    // ref에서 최신 값 참조 (클로저 문제 해결)
    const currentTemplateFile = templateFileRef.current || templateFile;
    const currentDataFile = dataFileRef.current || dataFile;

    if (!currentTemplateFile) {
      alert('템플릿 파일을 먼저 업로드해주세요.');
      return;
    }

    if (!currentDataFile) {
      alert('데이터 파일을 업로드해주세요.');
      return;
    }

    setAutoMapping(true);
    setMappingProgress(0);
    setValidationResult(null);

    // 프로그레스 애니메이션 시작
    const progressInterval = setInterval(() => {
      setMappingProgress(prev => {
        if (prev >= 90) return prev; // 90%에서 멈추고 완료까지 대기
        return prev + Math.random() * 15;
      });
    }, 300);

    try {
      if (currentTemplateFile.format === 'hwpx') {
        // HWPX AI 매핑 (기존 API 사용)
        const formData = new FormData();
        formData.append('template', currentTemplateFile.file);
        formData.append('excel', currentDataFile.file);
        if (currentDataFile.selectedSheet) {
          formData.append('sheetName', currentDataFile.selectedSheet);
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
        // Excel/CSV 템플릿 — AI 매핑 API 호출
        const templateFields = currentTemplateFile.placeholders || currentTemplateFile.columns || [];
        const dataColumns = currentDataFile.columns || [];

        console.log('[Converter] Excel AI mapping request:', {
          templateColumns: templateFields.length,
          dataColumns: dataColumns.length,
        });

        try {
          const aiRes = await fetch('/api/converter/ai-mapping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              templateColumns: templateFields,
              dataColumns: dataColumns,
              templateSampleData: currentTemplateFile.templatePreview || currentTemplateFile.preview,
              dataSampleData: currentDataFile.preview,
            }),
          });

          if (aiRes.ok) {
            const aiResult = await aiRes.json();
            console.log('[Converter] AI mapping result:', {
              success: aiResult.success,
              total: aiResult.mappings?.length,
              mapped: aiResult.mappings?.filter((m: { dataColumn: string }) => m.dataColumn).length,
              isAttendanceReport: aiResult.isAttendanceReport,
            });

            if (aiResult.isAttendanceReport) {
              setIsAttendanceReport(true);
              isAttendanceReportRef.current = true;
              console.log('[Converter] Attendance report detected — will use attendance pipeline');
            } else {
              setIsAttendanceReport(false);
              isAttendanceReportRef.current = false;
            }

            const newMappings: MappingItem[] = (aiResult.mappings || []).map(
              (m: { templateField: string; dataColumn: string; confidence: number }) => ({
                templateField: m.templateField,
                dataColumn: m.dataColumn || '',
                confidence: m.confidence || 0,
              })
            );
            setMappings(newMappings);
          } else {
            console.warn('[Converter] AI mapping API failed, falling back to local matching');
            // Fallback: 로컬 이름 기반 매칭
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
        } catch (aiError) {
          console.error('[Converter] AI mapping error, falling back to local:', aiError);
          // Fallback: 로컬 이름 기반 매칭
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
      // 매핑 완료 후 자동으로 보고서 생성 + 검증 실행
      setVerificationPhase('waiting');

      // 매핑 완료 후 500ms 대기 후 자동 생성 트리거
      setTimeout(() => {
        console.log('[Converter] Auto-triggering generation after mapping...');
        handleGenerateAfterMapping();
      }, 500);
    } catch (error) {
      console.error('Auto mapping error:', error);
      alert('자동 매핑 중 오류가 발생했습니다.');
    } finally {
      clearInterval(progressInterval);
      setMappingProgress(100);
      setTimeout(() => {
        setAutoMapping(false);
        setMappingProgress(0);
      }, 500);
    }
  };

  // 매핑 수정 - 직접 매핑 UI용 (추후 확장)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // 3-Way Diff 검증 실행 (결과 반환)
  const runVerification = async (
    zipBlob: Blob,
    mappingsToVerify: Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }>,
    showAlert = true
  ): Promise<VerificationResult | null> => {
    if (!templateFile || !dataFile) return null;

    setVerifying(true);
    setVerificationPhase('running');
    setVerificationResult(null);

    try {
      const verifyFormData = new FormData();
      verifyFormData.append('template', templateFile.file);
      verifyFormData.append('excel', dataFile.file);
      verifyFormData.append('generatedZip', zipBlob, 'generated.zip');
      verifyFormData.append('mappings', JSON.stringify(mappingsToVerify));
      if (dataFile.selectedSheet) {
        verifyFormData.append('sheetName', dataFile.selectedSheet);
      }

      console.log('[Converter] Running 3-Way verification...');
      const verifyRes = await fetch('/api/hwpx/verify', {
        method: 'POST',
        body: verifyFormData,
      });

      if (verifyRes.ok) {
        const result: VerificationResult = await verifyRes.json();
        console.log('[Converter] Verification result:', {
          status: result.status,
          accuracy: result.accuracy?.toFixed?.(1) + '%',
          issueCount: result.allIssues?.length || 0,
        });
        setVerificationResult(result);
        setVerificationPhase('complete');

        // 검증 완료 알림
        if (showAlert) {
          if (result.status === 'pass') {
            alert(`✅ 검증 통과!\n정확도: ${result.accuracy.toFixed(1)}%\n파일이 다운로드되었습니다.`);
          } else if (result.status === 'warning') {
            alert(`⚠️ 경고: ${result.allIssues.length}건의 이슈가 발견되었습니다.\n정확도: ${result.accuracy.toFixed(1)}%\n파일이 다운로드되었습니다. 결과를 확인해주세요.`);
          } else {
            alert(`❌ 검증 실패: Critical 이슈가 발견되었습니다.\n정확도: ${result.accuracy.toFixed(1)}%\n파일이 다운로드되었습니다. 반드시 확인이 필요합니다.`);
          }
        }

        return result;
      } else {
        const errorText = await verifyRes.text();
        console.error('[Converter] Verification failed:', errorText);
        if (showAlert) {
          alert('검증 API 호출 실패. 파일은 다운로드되었습니다.');
        }
        return null;
      }
    } catch (error) {
      console.error('[Converter] Verification error:', error);
      if (showAlert) {
        alert('검증 중 오류가 발생했습니다. 파일은 다운로드되었습니다.');
      }
      return null;
    } finally {
      setVerifying(false);
    }
  };

  // 보고서 생성 - 간단한 동기식 API 사용 (HWPX와 동일한 방식)
  const handleGenerate = async () => {
    // ref에서 최신 값 참조 (클로저 문제 해결)
    const currentTemplateFile = templateFileRef.current || templateFile;
    const currentDataFile = dataFileRef.current || dataFile;
    const currentMappings = mappingsRef.current.length > 0 ? mappingsRef.current : mappings;

    // 디버깅용 로그
    console.log('[Converter] handleGenerate called', {
      templateFile: currentTemplateFile?.name,
      dataFile: currentDataFile?.name,
      mappingsCount: currentMappings.length,
      mappingsRefCount: mappingsRef.current.length,
      mappingsStateCount: mappings.length,
    });

    if (!currentTemplateFile) {
      alert('템플릿 파일을 업로드해주세요.');
      return;
    }

    if (!currentDataFile) {
      alert('데이터 파일을 업로드해주세요.');
      return;
    }

    if (currentMappings.length === 0) {
      alert('컬럼 매핑을 설정해주세요. AI 자동 매핑 버튼을 클릭하거나 직접 매핑하세요.');
      return;
    }

    setGenerating(true);
    setVerificationResult(null);
    setGeneratedZipBlob(null);
    setProgress({ phase: 'init', current: 0, total: 0, percentage: 0, message: '보고서 생성 중...' });

    try {
      // FormData 준비
      const formData = new FormData();
      formData.append('template', currentTemplateFile.file);
      formData.append('data', currentDataFile.file);

      // 시트 정보
      if (currentTemplateFile.selectedSheet) {
        formData.append('sheetName', currentTemplateFile.selectedSheet);
      }
      if (currentDataFile.selectedSheet) {
        formData.append('dataSheet', currentDataFile.selectedSheet);
      }

      // 매핑 형식 변환 (템플릿 형식에 따라)
      let mappingsToSend: Array<{ excelColumn: string; hwpxRow: number; hwpxCol: number }> | Array<{ templateField: string; dataColumn: string }>;
      if (currentTemplateFile.format === 'hwpx') {
        // HWPX: 셀 위치 기반 매핑
        mappingsToSend = currentMappings
          .filter(m => m.hwpxRow !== undefined && m.hwpxCol !== undefined)
          .map(m => ({
            excelColumn: m.dataColumn,
            hwpxRow: m.hwpxRow!,
            hwpxCol: m.hwpxCol!,
          }));
      } else {
        // Excel/CSV: 필드명 기반 매핑
        mappingsToSend = currentMappings.map(m => ({
          templateField: m.templateField,
          dataColumn: m.dataColumn,
        }));
      }
      formData.append('mappings', JSON.stringify(mappingsToSend));

      // 파일명 컬럼
      if (fileNameColumn) {
        formData.append('fileNameColumn', fileNameColumn);
      }

      // mappingContext 전달 (필드 머지 규칙 등)
      if (mappingContext && Object.keys(mappingContext).length > 0) {
        formData.append('mappingContext', JSON.stringify(mappingContext));
        console.log('[Converter] Generate with mappingContext:', mappingContext);
      }

      // 통합 생성기 사용 (multi-row 헤더 지원)
      const generateEndpoint = '/api/converter/generate';
      console.log(`[Converter] Sending request to ${generateEndpoint}...`);
      const res = await fetch(generateEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || '보고서 생성 실패');
      }

      // 결과 Blob 저장
      const blob = await res.blob();
      const contentDisposition = res.headers.get('Content-Disposition');
      let fileName = `reports_${Date.now()}`;

      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          fileName = decodeURIComponent(match[1].replace(/['"]/g, ''));
        }
      } else {
        fileName = currentTemplateFile?.format === 'hwpx'
          ? `hwpx_output_${Date.now()}.zip`
          : currentTemplateFile?.format === 'csv'
            ? `reports_${Date.now()}.csv`
            : `reports_${Date.now()}.zip`;
      }

      setProgress({ phase: 'complete', current: 100, total: 100, percentage: 100, message: '생성 완료! 검증 중...' });

      // HWPX 템플릿인 경우에만 3-Way 검증 실행
      if (currentTemplateFile.format === 'hwpx') {
        setGeneratedZipBlob(blob);

        // HWPX 매핑으로 변환 및 저장 (재검증용)
        const hwpxMappings = currentMappings
          .filter(m => m.hwpxRow !== undefined && m.hwpxCol !== undefined)
          .map(m => ({
            excelColumn: m.dataColumn,
            hwpxRow: m.hwpxRow!,
            hwpxCol: m.hwpxCol!,
          }));
        setLastHwpxMappings(hwpxMappings);

        // 검증 먼저 실행 (다운로드 전에 문제점 확인)
        console.log('[Converter] Starting verification with', hwpxMappings.length, 'mappings');
        await runVerification(blob, hwpxMappings);
        console.log('[Converter] Verification completed - user can now download');

        // 다운로드는 검증 결과 확인 후 사용자가 직접 클릭하도록 함
        // (generatedZipBlob 상태에 저장되어 있으므로 다운로드 버튼에서 처리)
      } else {
        // HWPX가 아닌 경우 blob 저장 (다운로드 버튼으로 수동 다운로드)
        setGeneratedZipBlob(blob);
        setGeneratedFileName(fileName);
      }

    } catch (error) {
      console.error('Generate error:', error);
      alert('보고서 생성 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : ''));
      setProgress({ phase: 'error', current: 0, total: 0, percentage: 0, message: '오류 발생' });
    } finally {
      setGenerating(false);
      setProgress(null);
      setCurrentJobId(null);
    }
  };

  // 매핑 완료 후 자동 생성 (handleGenerate 이후에 정의)
  const handleGenerateAfterMapping = async () => {
    // ref에서 최신 값 참조
    const currentTemplateFile = templateFileRef.current || templateFile;
    const currentDataFile = dataFileRef.current || dataFile;

    if (!currentTemplateFile || !currentDataFile) {
      console.log('[Converter] Cannot auto-generate: missing files');
      return;
    }

    console.log('[Converter] Auto-generating reports...');
    await handleGenerate();
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
          {/* HWPX 생성 메뉴 숨김 - converter에 통합됨 */}
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
                      {mappings.length > 0 && (
                        <span className="ml-2 text-sm text-gray-500 font-normal">
                          ({mappings.filter(m => m.dataColumn).length}개 매핑됨)
                        </span>
                      )}
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

                  {/* AI 매핑 진행 프로그레스바 */}
                  {autoMapping && (
                    <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-purple-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-sm font-medium text-purple-700">AI가 매핑을 분석하고 있습니다...</span>
                      </div>
                      <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300 ease-out"
                          style={{ width: `${Math.min(mappingProgress, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-purple-600 mt-1">
                        {mappingProgress < 30 ? '템플릿 구조 분석 중...' :
                         mappingProgress < 60 ? '데이터 컬럼 매칭 중...' :
                         mappingProgress < 90 ? '최적 매핑 계산 중...' :
                         '매핑 완료 중...'}
                      </p>
                    </div>
                  )}

                  {/* 일괄 (일정)↔(출결) 변환 버튼 */}
                  {!autoMapping && mappings.some(m => m.dataColumn && (/\(일정\)$/.test(m.dataColumn) || /\(출결\)$/.test(m.dataColumn))) && (
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => {
                          setMappings(prev => prev.map(m => ({
                            ...m,
                            dataColumn: m.dataColumn.replace(/\(일정\)$/, '(출결)'),
                          })));
                        }}
                        className="flex-1 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 transition-all"
                      >
                        일괄 (출결)로 변경
                      </button>
                      <button
                        onClick={() => {
                          setMappings(prev => prev.map(m => ({
                            ...m,
                            dataColumn: m.dataColumn.replace(/\(출결\)$/, '(일정)'),
                          })));
                        }}
                        className="flex-1 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-medium hover:bg-blue-100 transition-all"
                      >
                        일괄 (일정)로 변경
                      </button>
                    </div>
                  )}

                  {/* 수동 매핑 드롭다운 */}
                  {!autoMapping && (
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {(templateFile.placeholders || templateFile.columns || []).map((field, idx) => {
                        const mapping = mappings.find(m => m.templateField === field);
                        return (
                          <div key={idx} className="flex items-center gap-3">
                            <div className="flex-1 px-3 py-2 bg-orange-50 rounded-lg text-sm text-gray-700 truncate" title={field}>
                              {field}
                            </div>
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 4. 검증 - 생성 시작 후에만 표시 */}
              {templateFile && dataFile && mappings.length > 0 && (generating || verifying || verificationResult || generatedZipBlob) && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-medium text-gray-900 flex items-center gap-2">
                      <span className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-sm font-bold">4</span>
                      검증
                      {verificationResult && (
                        <span className={`ml-2 text-sm font-normal px-2 py-0.5 rounded-full ${
                          verificationResult.status === 'pass'
                            ? 'bg-green-100 text-green-700'
                            : verificationResult.status === 'warning'
                              ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                        }`}>
                          {verificationResult.status === 'pass' ? '통과' :
                           verificationResult.status === 'warning' ? '주의' : '실패'}
                          {verificationResult.accuracy !== undefined && ` (${verificationResult.accuracy.toFixed(0)}%)`}
                        </span>
                      )}
                    </h3>
                    {generatedZipBlob && lastHwpxMappings.length > 0 && !verifying && (
                      <button
                        onClick={() => runVerification(generatedZipBlob, lastHwpxMappings, false)}
                        className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 transition-all flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        재검증
                      </button>
                    )}
                  </div>

                  {/* 검증 프로그레스바 */}
                  <div className={`p-4 rounded-lg border shadow-sm ${
                    generating ? 'bg-gradient-to-r from-teal-50 to-blue-50 border-teal-300' :
                    verificationPhase === 'running' ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300' :
                    verificationResult?.status === 'pass' ? 'bg-green-50 border-green-300' :
                    verificationResult?.status === 'warning' ? 'bg-yellow-50 border-yellow-300' :
                    'bg-red-50 border-red-300'
                  }`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="relative">
                        {generating && (
                          <svg className="w-8 h-8 text-teal-600 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                        {!generating && verificationPhase === 'running' && (
                          <svg className="w-8 h-8 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                        {!generating && verificationPhase === 'complete' && verificationResult?.status === 'pass' && (
                          <svg className="w-8 h-8 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        )}
                        {!generating && verificationPhase === 'complete' && verificationResult?.status === 'warning' && (
                          <svg className="w-8 h-8 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        )}
                        {!generating && verificationPhase === 'complete' && verificationResult?.status === 'fail' && (
                          <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <span className={`text-base font-semibold ${
                          generating ? 'text-teal-700' :
                          verificationPhase === 'running' ? 'text-blue-800' :
                          verificationResult?.status === 'pass' ? 'text-green-700' :
                          verificationResult?.status === 'warning' ? 'text-yellow-700' :
                          'text-red-700'
                        }`}>
                          {generating && '보고서 생성 중...'}
                          {!generating && verificationPhase === 'running' && '샘플 검증 중...'}
                          {!generating && verificationPhase === 'complete' && verificationResult?.status === 'pass' && '검증 통과'}
                          {!generating && verificationPhase === 'complete' && verificationResult?.status === 'warning' && '주의 필요'}
                          {!generating && verificationPhase === 'complete' && verificationResult?.status === 'fail' && '검증 실패'}
                        </span>
                        <p className={`text-xs ${
                          generating ? 'text-blue-600' :
                          verificationPhase === 'running' ? 'text-blue-600' :
                          verificationResult?.status === 'pass' ? 'text-green-600' :
                          verificationResult?.status === 'warning' ? 'text-yellow-600' :
                          'text-red-600'
                        }`}>
                          {generating && (templateFile?.format === 'hwpx'
                            ? `${dataFile?.rowCount || 0}개 파일 생성 후 자동 검증합니다`
                            : '보고서 생성 중...')}
                          {!generating && verificationPhase === 'running' && '템플릿 ↔ Excel ↔ 생성파일 비교'}
                          {!generating && verificationPhase === 'complete' && `정확도: ${verificationResult?.accuracy?.toFixed(1)}%`}
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          generating ? 'bg-gradient-to-r from-teal-500 via-blue-500 to-teal-500' :
                          verificationPhase === 'running' ? 'bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500' :
                          verificationResult?.status === 'pass' ? 'bg-green-500' :
                          verificationResult?.status === 'warning' ? 'bg-yellow-500' :
                          'bg-red-500'
                        }`}
                        style={{
                          width: generating ? `${progress?.percentage || 50}%` :
                                 verificationPhase === 'running' ? '80%' : '100%',
                          ...((generating || verificationPhase === 'running') ? {
                            backgroundSize: '200% 100%',
                            animation: 'shimmer 1.5s infinite linear'
                          } : {})
                        }}
                      />
                    </div>
                    {(generating || verificationPhase === 'running') && (
                      <style jsx>{`
                        @keyframes shimmer {
                          0% { background-position: 200% 0; }
                          100% { background-position: -200% 0; }
                        }
                      `}</style>
                    )}
                  </div>

                  {/* 검증 결과 표시 */}
                  {verificationResult && !verifying && (
                    <div className="space-y-4">
                      {/* 요약 통계 */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <p className="text-2xl font-bold text-gray-800">{verificationResult.accuracy.toFixed(0)}%</p>
                          <p className="text-xs text-gray-500">정확도</p>
                        </div>
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <p className="text-2xl font-bold text-gray-800">{verificationResult.sampledCount}</p>
                          <p className="text-xs text-gray-500">검증 샘플</p>
                        </div>
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <p className={`text-2xl font-bold ${
                            verificationResult.allIssues.filter(i => i.severity !== 'info').length === 0
                              ? 'text-green-600'
                              : 'text-red-600'
                          }`}>
                            {verificationResult.allIssues.filter(i => i.severity !== 'info').length}
                          </p>
                          <p className="text-xs text-gray-500">문제 발견</p>
                        </div>
                      </div>

                      {/* Agent 결과 */}
                      {verificationResult.agentResults && verificationResult.agentResults.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-gray-700">검증 항목:</p>
                          <div className="space-y-1">
                            {verificationResult.agentResults.map((agent, idx) => {
                              // info 레벨 제외한 실제 문제 수
                              const criticalCount = agent.issues?.filter(i => i.severity !== 'info').length || 0;
                              const infoCount = agent.issues?.filter(i => i.severity === 'info').length || 0;

                              return (
                                <div key={idx} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                                  <div className="flex items-center gap-2">
                                    {agent.status === 'pass' ? (
                                      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    ) : agent.status === 'warning' ? (
                                      <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                    <span className="text-sm text-gray-700">{agent.description}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {criticalCount > 0 && (
                                      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
                                        {criticalCount}건
                                      </span>
                                    )}
                                    {infoCount > 0 && criticalCount === 0 && (
                                      <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">
                                        참고 {infoCount}건
                                      </span>
                                    )}
                                    {criticalCount === 0 && infoCount === 0 && (
                                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                                        통과
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 문제 상세 목록 */}
                      {verificationResult.allIssues.filter(i => i.severity !== 'info').length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-red-700">발견된 문제:</p>
                          <div className="max-h-48 overflow-y-auto space-y-2">
                            {verificationResult.allIssues
                              .filter(i => i.severity !== 'info')
                              .map((issue, idx) => (
                                <div key={idx} className={`p-3 rounded-lg ${
                                  issue.severity === 'critical' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'
                                }`}>
                                  <div className="flex items-start gap-2">
                                    {issue.severity === 'critical' ? (
                                      <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                      </svg>
                                    ) : (
                                      <svg className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-sm font-medium ${
                                        issue.severity === 'critical' ? 'text-red-800' : 'text-yellow-800'
                                      }`}>
                                        {issue.personName}
                                      </p>
                                      <p className={`text-xs mt-0.5 ${
                                        issue.severity === 'critical' ? 'text-red-600' : 'text-yellow-600'
                                      }`}>
                                        {issue.message}
                                      </p>
                                      {issue.cell && (
                                        <div className="mt-1 text-xs text-gray-500">
                                          <span className="font-mono bg-gray-100 px-1 rounded">{issue.cell.fieldName || issue.cell.excelColumn}</span>
                                          {issue.cell.excelValue && issue.cell.generatedValue && (
                                            <span className="ml-2">
                                              기대: <span className="text-green-600">{issue.cell.excelValue}</span>
                                              {' → '}
                                              실제: <span className="text-red-600">{issue.cell.generatedValue}</span>
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                          {verificationResult.allIssues.filter(i => i.severity !== 'info').length > 5 && (
                            <p className="text-xs text-gray-500 text-center">
                              총 {verificationResult.allIssues.filter(i => i.severity !== 'info').length}건의 문제가 발견되었습니다
                            </p>
                          )}
                        </div>
                      )}

                      {/* 샘플링 상세 */}
                      {verificationResult.sampledNames && verificationResult.sampledNames.length > 0 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                            검증된 대상자 ({verificationResult.sampledNames.length}명)
                          </summary>
                          <div className="mt-2 p-2 bg-gray-50 rounded flex flex-wrap gap-1">
                            {verificationResult.sampledNames.map((name, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-600">
                                {name}
                              </span>
                            ))}
                          </div>
                        </details>
                      )}

                      {/* 실행 시간 */}
                      <div className="text-xs text-gray-400 text-right">
                        검증 소요 시간: {(verificationResult.totalExecutionTimeMs / 1000).toFixed(1)}초
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 파일명 컬럼 선택 (생성 버튼 위에 배치) */}
              {templateFile && dataFile && dataFile.columns && dataFile.columns.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
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

              {/* 메인 액션 버튼 - 상태에 따라 변경 */}
              <div className="space-y-3">
                {/* 생성 완료 후: 다운로드 버튼 */}
                {generatedZipBlob && !generating && !verifying ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => {
                        const fileName = generatedFileName || `report_${Date.now()}.xlsx`;
                        downloadBlob(generatedZipBlob, fileName);
                      }}
                      className={`w-full py-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
                        verificationResult
                          ? verificationResult.status === 'pass'
                            ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white'
                            : verificationResult.status === 'warning'
                              ? 'bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white'
                              : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white'
                          : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white'
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      다운로드 ({dataFile?.rowCount || 0}건)
                    </button>
                    <button
                      onClick={() => {
                        setGeneratedZipBlob(null);
                        setGeneratedFileName('');
                        setVerificationResult(null);
                        setVerificationPhase('idle');
                      }}
                      className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      다시 생성하기
                    </button>
                  </div>
                ) : (
                  /* 생성/검증 전 또는 진행 중: 생성 버튼 */
                  <button
                    onClick={handleGenerate}
                    disabled={generating || verifying || !templateFile || !dataFile || mappings.length === 0}
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
                    ) : verifying ? (
                      <>
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        검증 중...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        생성하고 검증 결과 보여드릴게요
                      </>
                    )}
                  </button>
                )}

                {/* 진행률 표시 */}
                {progress && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                    {/* 진행률 바 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700 font-medium">
                          {progress.phase === 'init' && '초기화'}
                          {progress.phase === 'reading' && '데이터 읽기'}
                          {progress.phase === 'generating' && '보고서 생성'}
                          {progress.phase === 'packaging' && '패키징'}
                          {progress.phase === 'complete' && '완료'}
                          {progress.phase === 'error' && '오류'}
                        </span>
                        <span className="text-gray-500">
                          {progress.percentage.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            progress.phase === 'error'
                              ? 'bg-red-500'
                              : progress.phase === 'complete'
                                ? 'bg-green-500'
                                : 'bg-gradient-to-r from-teal-500 to-blue-500'
                          }`}
                          style={{ width: `${progress.percentage}%` }}
                        />
                      </div>
                    </div>

                    {/* 상세 정보 */}
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{progress.message}</span>
                      {progress.total > 0 && (
                        <span>{progress.current} / {progress.total}</span>
                      )}
                    </div>

                    {/* 현재 처리 중인 파일 */}
                    {progress.currentFile && (
                      <div className="text-xs text-blue-600 truncate">
                        처리 중: {progress.currentFile}
                      </div>
                    )}
                  </div>
                )}

              </div>
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
                                              {String(mappedValue)}
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
                                        ← {mapping.dataColumn}
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
                                  const value = mapping?.dataColumn ? row[mapping.dataColumn] : null;
                                  return (
                                    <td
                                      key={colIdx}
                                      className={`px-3 py-2 border border-gray-200 text-xs text-center ${
                                        mapping ? 'bg-purple-50' : 'bg-white'
                                      }`}
                                    >
                                      {value !== null && value !== undefined ? (
                                        <span className="text-gray-700 truncate block">{String(value)}</span>
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
                          총 {dataFile?.rowCount || previewData.length}개 보고서 생성 예정
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
                  ) : templateFile && dataFile && mappings.length === 0 && autoMapping ? (
                    <div className="text-center py-12 text-gray-400">
                      <div className="relative w-16 h-16 mx-auto mb-4">
                        <svg className="w-16 h-16 text-purple-300 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                      </div>
                      <p className="text-lg mb-2 text-purple-600">AI가 매핑을 분석하고 있습니다</p>
                      <p className="text-sm text-purple-400">템플릿 구조와 데이터를 매칭하는 중...</p>
                      <div className="mt-4 w-48 mx-auto">
                        <div className="h-1.5 bg-purple-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-purple-400 to-blue-400 transition-all duration-300"
                            style={{ width: `${mappingProgress}%` }}
                          />
                        </div>
                      </div>
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
