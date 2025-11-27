'use client';

import { useState, useEffect } from 'react';

interface ColumnMapping {
  templateColumn: string;
  dataColumn: string | null;
  status: 'matched' | 'unmatched' | 'manual';
}

interface MappingPreviewPanelProps {
  templateName: string;
  dataFileName: string;
  mappings: ColumnMapping[];
  previewData: Record<string, string | number | boolean | null>[];
  dataHeaders?: string[];
  onMappingChange?: (templateColumn: string, dataColumn: string | null) => void;
  onDownload?: () => void;
}

export default function MappingPreviewPanel({
  templateName,
  dataFileName,
  mappings,
  previewData,
  dataHeaders = [],
  onMappingChange,
  onDownload,
}: MappingPreviewPanelProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<'mapping' | 'preview'>('mapping');
  const [editingColumn, setEditingColumn] = useState<string | null>(null);
  const rowsPerPage = 10;
  const totalPages = Math.ceil(previewData.length / rowsPerPage);

  const currentData = previewData.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const matchedCount = mappings.filter(m => m.status === 'matched' || m.status === 'manual').length;
  const unmatchedCount = mappings.filter(m => m.status === 'unmatched').length;

  // 미매칭이 많으면 기본으로 매핑 상세 뷰 표시
  useEffect(() => {
    if (unmatchedCount > matchedCount) {
      setViewMode('mapping');
    }
  }, [unmatchedCount, matchedCount]);

  // 매칭된 컬럼만 미리보기에 표시
  const matchedMappings = mappings.filter(m => m.dataColumn !== null);

  // 데이터 컬럼 선택 핸들러
  const handleColumnSelect = (templateColumn: string, dataColumn: string | null) => {
    if (onMappingChange) {
      onMappingChange(templateColumn, dataColumn);
    }
    setEditingColumn(null);
  };

  // 컬럼명 줄이기
  const truncateText = (text: string, maxLength: number = 30) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <h2 className="font-medium text-gray-900">매핑 상태</h2>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2.5 h-2.5 bg-green-500 rounded-full"></span>
              <span className="text-gray-600">매칭됨 {matchedCount}</span>
            </span>
            <span className="flex items-center gap-1.5 text-sm">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full"></span>
              <span className="text-gray-600">미매칭 {unmatchedCount}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('mapping')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                viewMode === 'mapping'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              매핑 설정
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                viewMode === 'preview'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              데이터 미리보기
            </button>
          </div>
          {onDownload && matchedCount > 0 && (
            <button
              onClick={onDownload}
              className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-all text-sm font-medium"
            >
              다운로드
            </button>
          )}
        </div>
      </div>

      {/* 파일 정보 */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">템플릿:</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium">
              {templateName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">데이터:</span>
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
              {dataFileName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">총 컬럼:</span>
            <span className="text-gray-700 font-medium">{mappings.length}개</span>
          </div>
        </div>
      </div>

      {/* 컨텐츠 */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'mapping' ? (
          // 매핑 설정 뷰
          <div className="p-4">
            {/* 안내 메시지 */}
            {unmatchedCount > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">
                  <strong>{unmatchedCount}개</strong>의 템플릿 컬럼이 아직 매칭되지 않았습니다.
                  각 항목을 클릭하여 데이터 컬럼을 선택해주세요.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {mappings.map((mapping, index) => (
                <div
                  key={index}
                  className={`rounded-lg border transition-all ${
                    mapping.status === 'matched' || mapping.status === 'manual'
                      ? 'border-green-200 bg-green-50'
                      : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-center justify-between p-3">
                    {/* 템플릿 컬럼명 */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`flex-shrink-0 w-2.5 h-2.5 rounded-full ${
                        mapping.status === 'matched' || mapping.status === 'manual'
                          ? 'bg-green-500'
                          : 'bg-red-500'
                      }`}></span>
                      <span
                        className="font-medium text-gray-900 text-sm truncate"
                        title={mapping.templateColumn}
                      >
                        {mapping.templateColumn}
                      </span>
                    </div>

                    {/* 매핑 화살표 */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>

                      {/* 데이터 컬럼 선택 드롭다운 */}
                      {editingColumn === mapping.templateColumn ? (
                        <select
                          autoFocus
                          value={mapping.dataColumn || ''}
                          onChange={(e) => handleColumnSelect(mapping.templateColumn, e.target.value || null)}
                          onBlur={() => setEditingColumn(null)}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-[200px]"
                        >
                          <option value="">-- 선택 안함 --</option>
                          {dataHeaders.map((header) => (
                            <option key={header} value={header}>
                              {header}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setEditingColumn(mapping.templateColumn)}
                          className={`px-3 py-1.5 rounded-lg text-sm min-w-[200px] text-left transition-all ${
                            mapping.dataColumn
                              ? 'bg-white text-gray-700 border border-gray-200 hover:border-gray-300'
                              : 'bg-red-100 text-red-600 border border-red-200 hover:bg-red-200'
                          }`}
                        >
                          {mapping.dataColumn || '클릭하여 선택'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // 데이터 미리보기 뷰
          <div className="p-4">
            {matchedMappings.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p>매칭된 컬럼이 없습니다</p>
                <p className="text-sm mt-1">&ldquo;매핑 설정&rdquo;에서 컬럼을 매칭해주세요</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500 border border-gray-200 whitespace-nowrap">
                        #
                      </th>
                      {matchedMappings.map((mapping, index) => (
                        <th
                          key={index}
                          className="px-3 py-2 text-left font-medium border border-gray-200"
                          title={mapping.templateColumn}
                        >
                          <div className="flex flex-col gap-0.5 min-w-[120px] max-w-[200px]">
                            <span className="text-gray-900 truncate text-xs">
                              {truncateText(mapping.templateColumn, 25)}
                            </span>
                            <span className="text-green-600 text-xs truncate">
                              ← {mapping.dataColumn}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentData.map((row, rowIndex) => (
                      <tr key={rowIndex} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 border border-gray-200 whitespace-nowrap">
                          {(currentPage - 1) * rowsPerPage + rowIndex + 1}
                        </td>
                        {matchedMappings.map((mapping, colIndex) => (
                          <td
                            key={colIndex}
                            className="px-3 py-2 border border-gray-200 text-gray-700 max-w-[200px] truncate"
                            title={mapping.dataColumn && row[mapping.dataColumn] != null
                              ? String(row[mapping.dataColumn])
                              : ''}
                          >
                            {mapping.dataColumn && row[mapping.dataColumn] != null
                              ? String(row[mapping.dataColumn])
                              : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 페이지네이션 */}
            {matchedMappings.length > 0 && totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm text-gray-600">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
