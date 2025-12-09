'use client';

import { useState, useEffect } from 'react';
import { MappingProfile, FieldMapping } from '@/lib/types';

interface Template {
  id: string;
  name: string;
  fileName: string;
  columns: { name: string; type: string }[];
  createdAt: string;
}

interface ColumnMapping {
  templateColumn: string;
  dataColumn: string | null;
  status: 'matched' | 'unmatched' | 'manual';
}

interface TemplateSelectorPanelProps {
  dataFileName: string;
  dataHeaders: string[];
  dataRows: Record<string, string | number | boolean | null>[];
  onTemplateSelect: (template: Template, mappings: ColumnMapping[]) => void;
  selectedTemplateId: string | null;
  selectedProfile?: MappingProfile | null;
}

export default function TemplateSelectorPanel({
  dataFileName,
  dataHeaders,
  dataRows,
  onTemplateSelect,
  selectedTemplateId,
  selectedProfile,
}: TemplateSelectorPanelProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 8;

  // 템플릿 목록 불러오기
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await fetch('/api/templates');
        if (res.ok) {
          const response = await res.json();
          // API 응답 형식: { success: true, data: [...] }
          if (response.success && Array.isArray(response.data)) {
            setTemplates(response.data);
          } else if (Array.isArray(response)) {
            setTemplates(response);
          } else {
            setTemplates([]);
          }
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
        setTemplates([]);
      } finally {
        setLoading(false);
      }
    };
    fetchTemplates();
  }, []);

  // 프로필 기반 매핑 생성 (저장된 매핑 적용)
  const generateMappingsFromProfile = (template: Template, profile: MappingProfile): ColumnMapping[] => {
    // 프로필의 매핑을 Map으로 변환 (canonicalKey -> sourceField)
    const profileMappingMap = new Map<string, FieldMapping>();
    profile.mappings.forEach((m) => {
      profileMappingMap.set(m.canonicalKey.toLowerCase(), m);
    });

    return template.columns.map((col) => {
      const templateCol = col.name;
      const profileMapping = profileMappingMap.get(templateCol.toLowerCase());

      if (profileMapping) {
        // 프로필에서 매핑 정보를 찾았고, 해당 소스 필드가 현재 데이터에 있는지 확인
        const sourceFieldExists = dataHeaders.some(
          (h) => h.toLowerCase() === profileMapping.sourceField.toLowerCase()
        );

        if (sourceFieldExists) {
          // 소스 필드를 정확한 대소문자로 찾기
          const exactSourceField = dataHeaders.find(
            (h) => h.toLowerCase() === profileMapping.sourceField.toLowerCase()
          );
          return {
            templateColumn: templateCol,
            dataColumn: exactSourceField || profileMapping.sourceField,
            status: 'matched' as const,
          };
        }
      }

      // 프로필에 없거나 소스 필드가 현재 데이터에 없으면 기본 로직 사용
      return { templateColumn: templateCol, dataColumn: null, status: 'unmatched' as const };
    });
  };

  // 자동 매핑 생성 (기본 로직)
  const generateMappings = (template: Template): ColumnMapping[] => {
    // 프로필이 있으면 프로필 기반 매핑 사용
    if (selectedProfile && selectedProfile.mappings.length > 0) {
      return generateMappingsFromProfile(template, selectedProfile);
    }

    // 간단한 매칭 로직 (나중에 LLM으로 개선)
    const similarityMap: Record<string, string[]> = {
      '날짜': ['date', 'dt', '일자', '날짜'],
      '제품명': ['product', 'name', '제품', '상품명', '품명'],
      '수량': ['qty', 'quantity', '개수', '수량'],
      '단가': ['price', 'unit_price', '가격', '단가'],
      '합계': ['total', 'sum', 'amount', '합계', '총액'],
      '비고': ['note', 'remark', 'memo', '비고', '메모'],
    };

    return template.columns.map((col) => {
      const templateCol = col.name;
      const possibleMatches = similarityMap[templateCol] || [templateCol.toLowerCase()];

      const matchedDataCol = dataHeaders.find((dh) =>
        possibleMatches.some((pm) =>
          dh.toLowerCase().includes(pm.toLowerCase()) ||
          pm.toLowerCase().includes(dh.toLowerCase())
        )
      );

      if (matchedDataCol) {
        return { templateColumn: templateCol, dataColumn: matchedDataCol, status: 'matched' as const };
      }
      return { templateColumn: templateCol, dataColumn: null, status: 'unmatched' as const };
    });
  };

  const handleTemplateClick = (template: Template) => {
    const mappings = generateMappings(template);
    onTemplateSelect(template, mappings);
  };

  const totalPages = Math.ceil(dataRows.length / rowsPerPage);
  const currentData = dataRows.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-900 mb-2">템플릿 선택</h2>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
            {dataFileName}
          </span>
          <span>({dataRows.length}행)</span>
        </div>
      </div>

      {/* 프로필 적용 알림 */}
      {selectedProfile && (
        <div className="mx-4 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-green-800">
                저장된 매핑 프로필 적용됨
              </p>
              <p className="text-xs text-green-600">
                {selectedProfile.name} • {selectedProfile.mappings.length}개 매핑
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 템플릿 목록 */}
      <div className="p-4 border-b border-gray-200">
        <p className="text-sm text-gray-500 mb-3">저장된 템플릿 중 선택하세요</p>

        {loading ? (
          <div className="text-center py-4 text-gray-400">불러오는 중...</div>
        ) : templates.length === 0 ? (
          <div className="text-center py-4 text-gray-400">
            <p>저장된 템플릿이 없습니다</p>
            <p className="text-xs mt-1">먼저 템플릿을 등록해주세요</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateClick(template)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left ${
                  selectedTemplateId === template.id
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    selectedTemplateId === template.id ? 'bg-teal-500' : 'bg-green-100'
                  }`}>
                    <svg className={`w-4 h-4 ${selectedTemplateId === template.id ? 'text-white' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{template.name}</p>
                    <p className="text-xs text-gray-500">{template.columns.length}개 컬럼</p>
                  </div>
                </div>
                {selectedTemplateId === template.id && (
                  <svg className="w-5 h-5 text-teal-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 데이터 미리보기 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="p-4 pb-2">
          <h3 className="font-medium text-gray-900 text-sm">업로드된 데이터 미리보기</h3>
        </div>
        <div className="flex-1 overflow-auto px-4">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500 border-b border-gray-200">
                  #
                </th>
                {dataHeaders.map((header, index) => (
                  <th
                    key={index}
                    className="px-3 py-2 text-left font-medium text-gray-900 border-b border-gray-200 whitespace-nowrap"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentData.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500 border-b border-gray-100">
                    {(currentPage - 1) * rowsPerPage + rowIndex + 1}
                  </td>
                  {dataHeaders.map((header, colIndex) => (
                    <td
                      key={colIndex}
                      className="px-3 py-2 border-b border-gray-100 whitespace-nowrap max-w-[150px] truncate text-gray-700"
                    >
                      {row[header] !== null && row[header] !== undefined
                        ? String(row[header])
                        : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        <div className="flex items-center justify-center gap-4 p-3 border-t border-gray-200">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs text-gray-600">
            {currentPage} / {totalPages || 1}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages || totalPages === 0}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
