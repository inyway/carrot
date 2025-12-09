'use client';

import { useState, useRef } from 'react';
import { AnalyzeTemplateResponse, ColumnMapping, HeaderInfo } from '@/lib/types';

interface TemplateUploaderProps {
  onTemplateRegistered: () => void;
}

export default function TemplateUploader({ onTemplateRegistered }: TemplateUploaderProps) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeTemplateResponse | null>(null);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setAnalysisResult(null);
      setColumnMappings([]);
      setError(null);
    }
  };

  const handleAnalyze = async () => {
    if (!file) return;

    setAnalyzing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/analyze-template', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '분석에 실패했습니다.');
      }

      setAnalysisResult(result.data);

      // 초기 컬럼 매핑 설정
      const initialMappings: ColumnMapping[] = result.data.headers.map((header: HeaderInfo) => {
        const formula = result.data.formulas.find(
          (f: { cell: string; formula: string }) => f.cell.startsWith(header.letter)
        );
        return {
          column: header.letter,
          sourceField: formula ? '' : header.name,
          type: formula ? 'formula' : 'data',
          formula: formula ? formula.formula.replace(/\d+/g, '{row}') : undefined,
        };
      });

      setColumnMappings(initialMappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMappingChange = (index: number, field: keyof ColumnMapping, value: string) => {
    setColumnMappings((prev) =>
      prev.map((mapping, i) => (i === index ? { ...mapping, [field]: value } : mapping))
    );
  };

  const handleRegister = async () => {
    if (!file || !name || !analysisResult) return;

    setRegistering(true);
    setError(null);

    try {
      const config = {
        sheetName: analysisResult.sheetName,
        headerRow: 1,
        dataStartRow: analysisResult.dataStartRow,
        columns: columnMappings.filter((m) => m.sourceField || m.formula),
        preserveRows: [1],
      };

      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name);
      formData.append('config', JSON.stringify(config));

      const response = await fetch('/api/templates', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '등록에 실패했습니다.');
      }

      // 초기화
      setName('');
      setFile(null);
      setAnalysisResult(null);
      setColumnMappings([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      onTemplateRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : '등록 중 오류가 발생했습니다.');
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">새 템플릿 등록</h2>
          <p className="text-sm text-gray-500">Excel 템플릿을 업로드하고 컬럼 매핑을 설정하세요</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 이름</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 월간매출보고서"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Excel 파일</label>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-4 py-2 border border-dashed border-gray-300 rounded-lg hover:border-teal-500 hover:bg-teal-50 transition-all text-sm text-gray-600"
            >
              {file ? file.name : '파일 선택'}
            </button>
            <button
              onClick={handleAnalyze}
              disabled={!file || analyzing}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all text-sm font-medium"
            >
              {analyzing ? '분석 중...' : '분석하기'}
            </button>
          </div>
        </div>

        {analysisResult && (
          <>
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-medium text-gray-700 mb-2">분석 결과</h3>
              <div className="text-sm text-gray-600 space-y-1">
                <p>시트: <span className="font-medium">{analysisResult.sheetName}</span></p>
                <p>헤더: {analysisResult.headers.map((h) => `${h.letter}(${h.name})`).join(', ')}</p>
                {analysisResult.formulas.length > 0 && (
                  <p>수식: {analysisResult.formulas.map((f) => f.cell).join(', ')}</p>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">컬럼 매핑 설정</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {columnMappings.map((mapping, index) => (
                  <div key={mapping.column} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                    <span className="w-12 text-sm font-medium text-gray-700">{mapping.column}열</span>
                    <span className="text-gray-400">→</span>
                    {mapping.type === 'formula' ? (
                      <input
                        type="text"
                        value={mapping.formula || ''}
                        onChange={(e) => handleMappingChange(index, 'formula', e.target.value)}
                        placeholder="수식"
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-amber-50"
                      />
                    ) : (
                      <input
                        type="text"
                        value={mapping.sourceField}
                        onChange={(e) => handleMappingChange(index, 'sourceField', e.target.value)}
                        placeholder="원본 필드명"
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                      />
                    )}
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-200 text-gray-600">
                      {mapping.type === 'formula' ? '수식' : '데이터'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleRegister}
              disabled={!name || registering}
              className="w-full py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all font-medium"
            >
              {registering ? '등록 중...' : '등록하기'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
