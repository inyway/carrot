'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import CubeLoader from '@/components/CubeLoader';

interface HwpxCellInfo {
  rowIndex: number;
  colIndex: number;
  text: string;
  isHeader: boolean;
  colSpan: number;
  rowSpan: number;
}

interface HwpxTableInfo {
  rowCount: number;
  colCount: number;
  cells: HwpxCellInfo[];
}

interface HwpxTemplateInfo {
  fileName: string;
  tables: HwpxTableInfo[];
  sections: string[];
}

interface CellMapping {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
}

interface ExcelColumnsInfo {
  sheets: string[];
  columns: string[];
}

export default function HwpxPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();

  // 파일 입력 참조
  const hwpxInputRef = useRef<HTMLInputElement>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);

  // 상태
  const [hwpxFile, setHwpxFile] = useState<File | null>(null);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [hwpxTemplate, setHwpxTemplate] = useState<HwpxTemplateInfo | null>(null);
  const [excelInfo, setExcelInfo] = useState<ExcelColumnsInfo | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [mappings, setMappings] = useState<CellMapping[]>([]);
  const [fileNameColumn, setFileNameColumn] = useState<string>('');

  // 로딩 상태
  const [analyzingHwpx, setAnalyzingHwpx] = useState(false);
  const [analyzingExcel, setAnalyzingExcel] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiMappingLoading, setAiMappingLoading] = useState(false);

  // 선택된 매핑 위치
  const [selectedCellForMapping, setSelectedCellForMapping] = useState<{row: number; col: number} | null>(null);

  // HWPX 파일 선택
  const handleHwpxSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'hwpx') {
      alert('HWPX 파일(.hwpx)만 업로드 가능합니다.');
      return;
    }

    setHwpxFile(file);
    setHwpxTemplate(null);
    setMappings([]);

    // HWPX 분석
    setAnalyzingHwpx(true);
    try {
      const formData = new FormData();
      formData.append('template', file);

      const res = await fetch('/api/hwpx/analyze', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (result.template) {
        setHwpxTemplate(result.template);

        // Excel이 이미 업로드되어 있으면 자동 매핑 실행
        if (excelInfo?.columns) {
          autoMapColumnsWithTemplate(result.template, excelInfo.columns);
        }
      } else {
        alert('HWPX 분석 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('HWPX analyze error:', error);
      alert('HWPX 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzingHwpx(false);
    }

    if (hwpxInputRef.current) {
      hwpxInputRef.current.value = '';
    }
  };

  // Excel 파일 선택
  const handleExcelSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'xlsx' && ext !== 'xls') {
      alert('Excel 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }

    setExcelFile(file);
    setExcelInfo(null);
    setSelectedSheet('');

    // Excel 분석
    setAnalyzingExcel(true);
    try {
      const formData = new FormData();
      formData.append('excel', file);

      const res = await fetch('/api/hwpx/excel-columns', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (result.sheets) {
        setExcelInfo(result);
        if (result.sheets.length > 0) {
          setSelectedSheet(result.sheets[0]);
        }

        // 자동 매핑: HWPX 템플릿이 있으면 Excel 컬럼과 매칭
        if (hwpxTemplate && result.columns) {
          autoMapColumns(result.columns);
        }
      } else {
        alert('Excel 분석 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Excel analyze error:', error);
      alert('Excel 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzingExcel(false);
    }

    if (excelInputRef.current) {
      excelInputRef.current.value = '';
    }
  };

  // 자동 매핑 헬퍼: 템플릿과 Excel 컬럼을 받아서 매핑 생성
  // 규칙: 헤더 셀(isHeader=true, 색칠됨)은 라벨, 비헤더 셀(isHeader=false, 색칠 안됨)은 데이터 placeholder
  const autoMapColumnsWithTemplate = (template: HwpxTemplateInfo, excelColumns: string[]) => {
    if (!template || template.tables.length === 0) return;

    const newMappings: CellMapping[] = [];
    const table = template.tables[0];

    // Excel 컬럼명 정규화 (공백 제거, 소문자)
    const normalizeText = (text: string) => text.replace(/\s+/g, '').toLowerCase();

    // 섹션 헤더 패턴 (1. xxx, 2. xxx, 개인이력카드 등)
    const isSectionOrTitle = (text: string) => {
      const trimmed = text.trim();
      return /^\d+\./.test(trimmed) || // "1. 신상정보"
             trimmed === '개인이력카드' ||
             trimmed.length > 10; // 너무 긴 텍스트는 제목일 가능성
    };

    // 셀을 rowIndex, colIndex로 빠르게 찾기 위한 맵
    const cellMap = new Map<string, HwpxCellInfo>();
    for (const cell of table.cells) {
      cellMap.set(`${cell.rowIndex}-${cell.colIndex}`, cell);
    }

    // 이미 매핑된 셀 추적
    const mappedCells = new Set<string>();
    // 이미 사용된 Excel 컬럼 추적
    const usedExcelCols = new Set<string>();

    // 헤더 셀(라벨)만 필터링 - 색칠된 셀이 라벨
    const labelCells = table.cells.filter(cell =>
      cell.isHeader && // 헤더(색칠된 셀)만
      cell.text &&
      cell.text.trim().length >= 2 &&
      !isSectionOrTitle(cell.text)
    );

    console.log('라벨 셀 목록:', labelCells.map(c => `(${c.rowIndex},${c.colIndex}): ${c.text}`));

    // 각 Excel 컬럼에 대해 매칭되는 라벨 셀 찾기
    for (const excelCol of excelColumns) {
      const normalizedExcelCol = normalizeText(excelCol);
      if (normalizedExcelCol.length < 2) continue;
      if (usedExcelCols.has(excelCol)) continue;

      // 라벨 셀 중에서 Excel 컬럼명과 매칭되는 것 찾기
      for (const labelCell of labelCells) {
        const normalizedLabelText = normalizeText(labelCell.text || '');

        // 매칭 조건: 완전 일치 또는 포함 관계
        const isMatch =
          normalizedLabelText === normalizedExcelCol || // 완전 일치
          (normalizedLabelText.length >= 2 && normalizedExcelCol.includes(normalizedLabelText)) || // Excel이 라벨 포함
          (normalizedExcelCol.length >= 2 && normalizedLabelText.includes(normalizedExcelCol)); // 라벨이 Excel 포함

        if (!isMatch) continue;

        // 데이터 셀 찾기: 라벨 셀의 오른쪽 또는 아래에 있는 비헤더 셀(색칠 안된 셀)

        // 1순위: 오른쪽 셀 (colSpan 고려)
        const rightColIndex = labelCell.colIndex + (labelCell.colSpan || 1);
        const rightCell = cellMap.get(`${labelCell.rowIndex}-${rightColIndex}`);

        if (rightCell && !rightCell.isHeader) { // 비헤더(색칠 안된 셀) = 데이터 placeholder
          const cellKey = `${rightCell.rowIndex}-${rightCell.colIndex}`;
          if (!mappedCells.has(cellKey)) {
            newMappings.push({
              excelColumn: excelCol,
              hwpxRow: rightCell.rowIndex,
              hwpxCol: rightCell.colIndex,
            });
            mappedCells.add(cellKey);
            usedExcelCols.add(excelCol);
            console.log(`매핑: "${excelCol}" → (${rightCell.rowIndex}, ${rightCell.colIndex}) [오른쪽, 라벨: ${labelCell.text}]`);
            break;
          }
        }

        // 2순위: 아래 셀 (rowSpan 고려)
        const belowRowIndex = labelCell.rowIndex + (labelCell.rowSpan || 1);
        const belowCell = cellMap.get(`${belowRowIndex}-${labelCell.colIndex}`);

        if (belowCell && !belowCell.isHeader) { // 비헤더(색칠 안된 셀) = 데이터 placeholder
          const cellKey = `${belowCell.rowIndex}-${belowCell.colIndex}`;
          if (!mappedCells.has(cellKey)) {
            newMappings.push({
              excelColumn: excelCol,
              hwpxRow: belowCell.rowIndex,
              hwpxCol: belowCell.colIndex,
            });
            mappedCells.add(cellKey);
            usedExcelCols.add(excelCol);
            console.log(`매핑: "${excelCol}" → (${belowCell.rowIndex}, ${belowCell.colIndex}) [아래, 라벨: ${labelCell.text}]`);
            break;
          }
        }
      }
    }

    if (newMappings.length > 0) {
      setMappings(newMappings);
      console.log(`자동 매핑 완료: ${newMappings.length}개 컬럼`, newMappings);
    } else {
      console.log('자동 매핑 실패: 매칭되는 라벨이 없습니다');
      console.log('Excel 컬럼:', excelColumns);
    }
  };

  // 자동 매핑: HWPX 템플릿 셀 텍스트와 Excel 컬럼명 비교
  const autoMapColumns = (excelColumns: string[]) => {
    if (!hwpxTemplate) return;
    autoMapColumnsWithTemplate(hwpxTemplate, excelColumns);
  };

  // AI 기반 자동 매핑 (Gemini API 사용)
  const handleAiMapping = async () => {
    if (!hwpxFile || !excelFile || !selectedSheet) {
      alert('HWPX 템플릿과 Excel 파일을 모두 선택해주세요.');
      return;
    }

    setAiMappingLoading(true);
    try {
      const formData = new FormData();
      formData.append('template', hwpxFile);
      formData.append('excel', excelFile);
      formData.append('sheetName', selectedSheet);

      const res = await fetch('/api/hwpx/ai-mapping', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();

      if (result.success && result.mappings && result.mappings.length > 0) {
        setMappings(result.mappings);
        console.log('AI 매핑 결과:', result.mappings);

        if (result.validationIssues?.length > 0) {
          console.warn('AI 매핑 검증 이슈:', result.validationIssues);
        }
      } else {
        // AI 매핑 실패 시 규칙 기반 매핑으로 대체
        console.warn('AI 매핑 실패, 규칙 기반 매핑 시도:', result.error);
        if (hwpxTemplate && excelInfo?.columns) {
          autoMapColumnsWithTemplate(hwpxTemplate, excelInfo.columns);
        }
      }
    } catch (error) {
      console.error('AI mapping error:', error);
      // 에러 발생 시 규칙 기반 매핑으로 대체
      if (hwpxTemplate && excelInfo?.columns) {
        autoMapColumnsWithTemplate(hwpxTemplate, excelInfo.columns);
      }
    } finally {
      setAiMappingLoading(false);
    }
  };

  // 시트 변경 시 컬럼 다시 로드
  const handleSheetChange = async (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (!excelFile) return;

    setAnalyzingExcel(true);
    try {
      const formData = new FormData();
      formData.append('excel', excelFile);
      formData.append('sheetName', sheetName);

      const res = await fetch('/api/hwpx/excel-columns', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (result.columns) {
        setExcelInfo(prev => prev ? { ...prev, columns: result.columns } : null);
      }
    } catch (error) {
      console.error('Sheet change error:', error);
    } finally {
      setAnalyzingExcel(false);
    }
  };

  // 매핑 추가
  const addMapping = (excelColumn: string) => {
    if (!selectedCellForMapping) {
      alert('먼저 HWPX 테이블에서 셀을 클릭하세요.');
      return;
    }

    const newMapping: CellMapping = {
      excelColumn,
      hwpxRow: selectedCellForMapping.row,
      hwpxCol: selectedCellForMapping.col,
    };

    // 중복 확인
    const exists = mappings.some(
      m => m.hwpxRow === newMapping.hwpxRow && m.hwpxCol === newMapping.hwpxCol
    );

    if (exists) {
      // 기존 매핑 교체
      setMappings(prev => prev.map(m =>
        m.hwpxRow === newMapping.hwpxRow && m.hwpxCol === newMapping.hwpxCol
          ? newMapping
          : m
      ));
    } else {
      setMappings(prev => [...prev, newMapping]);
    }

    setSelectedCellForMapping(null);
  };

  // 매핑 삭제
  const removeMapping = (index: number) => {
    setMappings(prev => prev.filter((_, i) => i !== index));
  };

  // HWPX 생성
  const handleGenerate = async () => {
    if (!hwpxFile || !excelFile || !selectedSheet) {
      alert('HWPX 템플릿과 Excel 파일을 모두 선택해주세요.');
      return;
    }

    if (mappings.length === 0) {
      alert('최소 하나 이상의 매핑을 설정해주세요.');
      return;
    }

    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append('template', hwpxFile);
      formData.append('excel', excelFile);
      formData.append('sheetName', selectedSheet);
      formData.append('mappings', JSON.stringify(mappings));
      if (fileNameColumn) {
        formData.append('fileNameColumn', fileNameColumn);
      }

      const res = await fetch('/api/hwpx/generate', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'HWPX 생성 실패');
      }

      // ZIP 파일 다운로드
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hwpx_output_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert('HWPX 파일이 생성되었습니다!');
    } catch (error) {
      console.error('Generate error:', error);
      alert('HWPX 생성 중 오류가 발생했습니다: ' + (error instanceof Error ? error.message : ''));
    } finally {
      setGenerating(false);
    }
  };

  // 셀에 대한 매핑 찾기
  const getMappingForCell = (row: number, col: number): CellMapping | undefined => {
    return mappings.find(m => m.hwpxRow === row && m.hwpxCol === col);
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
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all bg-blue-50 text-blue-700 font-medium"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span>HWPX 생성</span>
          </button>
          <button
            onClick={() => router.push('/converter')}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all hover:bg-gray-100 text-gray-600"
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
            <h1 className="text-2xl font-semibold text-gray-900">HWPX 일괄 생성</h1>
            <p className="text-gray-500 mt-1">HWPX 템플릿에 Excel 데이터를 매핑하여 문서를 일괄 생성합니다</p>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {/* 왼쪽: 파일 업로드 및 매핑 설정 */}
            <div className="col-span-4 space-y-6">
              {/* HWPX 템플릿 업로드 */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-sm font-bold">1</span>
                  HWPX 템플릿
                </h3>
                <input
                  ref={hwpxInputRef}
                  type="file"
                  accept=".hwpx"
                  onChange={handleHwpxSelect}
                  className="hidden"
                />
                {hwpxFile ? (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{hwpxFile.name}</p>
                        <p className="text-sm text-gray-500">
                          {analyzingHwpx ? '분석 중...' : hwpxTemplate ? `${hwpxTemplate.tables.length}개 표 감지` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => hwpxInputRef.current?.click()}
                        className="text-blue-600 hover:text-blue-700 text-sm"
                      >
                        변경
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => hwpxInputRef.current?.click()}
                    disabled={analyzingHwpx}
                    className="w-full p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all text-center"
                  >
                    <svg className="w-10 h-10 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-gray-600">HWPX 파일을 선택하세요</p>
                    <p className="text-sm text-gray-400 mt-1">.hwpx 파일만 지원</p>
                  </button>
                )}
              </div>

              {/* Excel 데이터 업로드 */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-sm font-bold">2</span>
                  Excel 데이터
                </h3>
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleExcelSelect}
                  className="hidden"
                />
                {excelFile ? (
                  <div className="space-y-4">
                    <div className="p-4 bg-green-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{excelFile.name}</p>
                          <p className="text-sm text-gray-500">
                            {analyzingExcel ? '분석 중...' : excelInfo ? `${excelInfo.columns.length}개 컬럼` : ''}
                          </p>
                        </div>
                        <button
                          onClick={() => excelInputRef.current?.click()}
                          className="text-green-600 hover:text-green-700 text-sm"
                        >
                          변경
                        </button>
                      </div>
                    </div>

                    {/* 시트 선택 */}
                    {excelInfo && excelInfo.sheets.length > 1 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">시트 선택</label>
                        <select
                          value={selectedSheet}
                          onChange={(e) => handleSheetChange(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          {excelInfo.sheets.map((sheet) => (
                            <option key={sheet} value={sheet}>{sheet}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* 파일명 컬럼 선택 */}
                    {excelInfo && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">파일명 컬럼 (선택)</label>
                        <select
                          value={fileNameColumn}
                          onChange={(e) => setFileNameColumn(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          <option value="">기본 (순번)</option>
                          {excelInfo.columns.map((col) => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">생성될 HWPX 파일명에 사용할 컬럼</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => excelInputRef.current?.click()}
                    disabled={analyzingExcel}
                    className="w-full p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-400 hover:bg-green-50 transition-all text-center"
                  >
                    <svg className="w-10 h-10 mx-auto mb-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-gray-600">Excel 파일을 선택하세요</p>
                    <p className="text-sm text-gray-400 mt-1">.xlsx, .xls 파일 지원</p>
                  </button>
                )}
              </div>

              {/* 매핑 목록 */}
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 text-sm font-bold">3</span>
                  매핑 설정
                  <span className="ml-auto text-sm text-gray-500">{mappings.length}개</span>
                </h3>

                {/* AI 자동 매핑 버튼 */}
                <button
                  onClick={handleAiMapping}
                  disabled={!hwpxFile || !excelFile || !selectedSheet || aiMappingLoading}
                  className="w-full mb-2 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center justify-center gap-2 text-sm"
                >
                  {aiMappingLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      AI 매핑 중...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      AI 자동 매핑 (Gemini)
                    </>
                  )}
                </button>

                {/* 규칙 기반 자동 매핑 버튼 */}
                <button
                  onClick={() => {
                    if (hwpxTemplate && excelInfo?.columns) {
                      setMappings([]); // 기존 매핑 초기화
                      autoMapColumnsWithTemplate(hwpxTemplate, excelInfo.columns);
                    }
                  }}
                  disabled={!hwpxTemplate || !excelInfo?.columns}
                  className="w-full mb-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  규칙 기반 자동 매핑
                </button>

                {mappings.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-auto">
                    {mappings.map((mapping, index) => (
                      <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                        <span className="text-sm font-medium text-green-600 flex-1 truncate">{mapping.excelColumn}</span>
                        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        <span className="text-sm text-blue-600">({mapping.hwpxRow}, {mapping.hwpxCol})</span>
                        <button
                          onClick={() => removeMapping(index)}
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">
                    HWPX 테이블의 셀을 클릭한 후<br />Excel 컬럼을 선택하여 매핑하세요
                  </p>
                )}
              </div>

              {/* 생성 버튼 */}
              <button
                onClick={handleGenerate}
                disabled={generating || !hwpxFile || !excelFile || mappings.length === 0}
                className="w-full py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    생성 중...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    HWPX 일괄 생성 및 다운로드
                  </>
                )}
              </button>
            </div>

            {/* 오른쪽: HWPX 템플릿 미리보기 & Excel 컬럼 */}
            <div className="col-span-8 space-y-6">
              {/* HWPX 템플릿 미리보기 */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h3 className="font-medium text-gray-900">HWPX 템플릿 구조</h3>
                  {selectedCellForMapping && (
                    <span className="text-sm text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                      선택: ({selectedCellForMapping.row}, {selectedCellForMapping.col})
                    </span>
                  )}
                </div>

                <div className="p-6">
                  {analyzingHwpx ? (
                    <div className="text-center py-8">
                      <svg className="animate-spin h-8 w-8 mx-auto mb-2 text-blue-600" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      HWPX 분석 중...
                    </div>
                  ) : hwpxTemplate && hwpxTemplate.tables.length > 0 ? (
                    <div className="space-y-6">
                      {/* 섹션 목록 */}
                      {hwpxTemplate.sections.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {hwpxTemplate.sections.map((section, idx) => (
                            <span key={idx} className="px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">
                              {section}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* 테이블 미리보기 */}
                      {hwpxTemplate.tables.map((table, tableIdx) => {
                        // 병합된 셀로 인해 가려지는 위치를 추적
                        const occupiedCells = new Set<string>();
                        table.cells.forEach(cell => {
                          const colSpan = cell.colSpan || 1;
                          const rowSpan = cell.rowSpan || 1;
                          // 병합된 셀이 차지하는 모든 위치를 기록 (첫 셀 제외)
                          for (let r = 0; r < rowSpan; r++) {
                            for (let c = 0; c < colSpan; c++) {
                              if (r === 0 && c === 0) continue; // 첫 셀은 제외
                              occupiedCells.add(`${cell.rowIndex + r}-${cell.colIndex + c}`);
                            }
                          }
                        });

                        const maxRows = Math.min(table.rowCount, 20);

                        return (
                          <div key={tableIdx} className="border border-gray-200 rounded-lg overflow-auto max-h-[500px]">
                            <table className="w-full text-sm border-collapse">
                              <tbody>
                                {Array.from({ length: maxRows }).map((_, rowIdx) => (
                                  <tr key={rowIdx}>
                                    {Array.from({ length: table.colCount }).map((_, colIdx) => {
                                      // 이 위치가 다른 셀의 병합으로 가려져 있으면 렌더링하지 않음
                                      if (occupiedCells.has(`${rowIdx}-${colIdx}`)) {
                                        return null;
                                      }

                                      const cell = table.cells.find(c => c.rowIndex === rowIdx && c.colIndex === colIdx);
                                      const mapping = getMappingForCell(rowIdx, colIdx);
                                      const isSelected = selectedCellForMapping?.row === rowIdx && selectedCellForMapping?.col === colIdx;
                                      const colSpan = cell?.colSpan || 1;
                                      const rowSpan = cell?.rowSpan || 1;

                                      return (
                                        <td
                                          key={colIdx}
                                          colSpan={colSpan > 1 ? colSpan : undefined}
                                          rowSpan={rowSpan > 1 ? rowSpan : undefined}
                                          onClick={() => setSelectedCellForMapping({ row: rowIdx, col: colIdx })}
                                          className={`px-2 py-1.5 border border-gray-300 text-xs cursor-pointer transition-all ${
                                            cell?.isHeader ? 'bg-gray-100 font-medium text-center' : 'bg-white'
                                          } ${
                                            mapping ? 'bg-purple-100 text-purple-800' : ''
                                          } ${
                                            isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                                          }`}
                                          style={{ minWidth: '40px', maxWidth: '150px' }}
                                          title={mapping ? `매핑됨: ${mapping.excelColumn}` : cell?.text ? cell.text : '클릭하여 선택'}
                                        >
                                          {mapping ? (
                                            <span className="flex items-center justify-center gap-1">
                                              <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                              </svg>
                                              <span className="truncate">{mapping.excelColumn}</span>
                                            </span>
                                          ) : (
                                            <span className="truncate block">{cell?.text || ''}</span>
                                          )}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {table.rowCount > maxRows && (
                              <p className="text-center text-sm text-gray-400 py-2 bg-gray-50">
                                ... {table.rowCount - maxRows}개 행 더 있음
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p>HWPX 템플릿을 업로드하면 구조가 표시됩니다</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Excel 컬럼 목록 */}
              {excelInfo && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="font-medium text-gray-900">Excel 컬럼 ({excelInfo.columns.length}개)</h3>
                    <p className="text-sm text-gray-500 mt-1">클릭하여 선택된 HWPX 셀에 매핑</p>
                  </div>

                  <div className="p-6">
                    <div className="flex flex-wrap gap-2">
                      {excelInfo.columns.map((col, idx) => {
                        const isMapped = mappings.some(m => m.excelColumn === col);
                        return (
                          <button
                            key={idx}
                            onClick={() => addMapping(col)}
                            disabled={!selectedCellForMapping}
                            className={`px-3 py-2 rounded-lg text-sm transition-all ${
                              isMapped
                                ? 'bg-green-100 text-green-700 border border-green-300'
                                : selectedCellForMapping
                                ? 'bg-gray-100 text-gray-700 hover:bg-green-50 hover:text-green-600 border border-transparent'
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent'
                            }`}
                          >
                            {col}
                            {isMapped && (
                              <svg className="w-4 h-4 inline ml-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
