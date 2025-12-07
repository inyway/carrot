'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FileUploadModal from '@/components/FileUploadModal';
import TemplateSelectorPanel from '@/components/TemplateSelectorPanel';
import MappingPreviewPanel from '@/components/MappingPreviewPanel';
import CommandPanel from '@/components/CommandPanel';
import ResizableDivider from '@/components/ResizableDivider';
import { useAuth } from '@/components/AuthProvider';
import CubeLoader from '@/components/CubeLoader';
import { MappingProfile } from '@/lib/types';

interface UploadedFile {
  id: string;
  name: string;
  type: 'xlsx' | 'csv';
  file: File;
}

interface ParsedData {
  headers: string[];
  rows: Record<string, string | number | boolean | null>[];
}

interface ColumnMapping {
  templateColumn: string;
  dataColumn: string | null;
  status: 'matched' | 'unmatched' | 'manual';
}

interface Template {
  id: string;
  name: string;
  fileName: string;
  columns: { name: string; type: string }[];
  createdAt: string;
}

type Step = 'home' | 'data-mapping';

export default function Home() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [step, setStep] = useState<Step>('home');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'template' | 'data'>('template');

  // Raw 데이터 관련
  const [dataFile, setDataFile] = useState<UploadedFile | null>(null);
  const [dataRows, setDataRows] = useState<ParsedData | null>(null);

  // 템플릿 & 매핑 관련
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);

  // 매핑 프로필 관련 (템플릿 선택 시 자동 매칭)
  const [selectedProfile, setSelectedProfile] = useState<MappingProfile | null>(null);

  // 로딩 중 표시
  if (loading) {
    return <CubeLoader />;
  }

  // 데이터 파일 파싱
  const parseDataFile = async (file: File): Promise<ParsedData> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/parse-data', {
      method: 'POST',
      body: formData,
    });

    const result = await res.json();

    if (result.success && result.data) {
      return result.data;
    }

    throw new Error(result.error || '파일 파싱 실패');
  };

  // 홈으로 이동
  const goHome = () => {
    setStep('home');
    setDataFile(null);
    setDataRows(null);
    setSelectedTemplate(null);
    setMappings([]);
    setSelectedProfile(null);
  };

  // 템플릿 등록 모달 열기
  const openTemplateModal = () => {
    setModalMode('template');
    setIsModalOpen(true);
  };

  // 데이터 업로드 모달 열기
  const openDataModal = () => {
    setModalMode('data');
    setIsModalOpen(true);
  };

  // 파일 선택 완료
  const handleFileContinue = async (files: UploadedFile[]) => {
    if (files.length === 0) return;

    const file = files[0];

    if (modalMode === 'template') {
      // 템플릿 등록 - 먼저 컬럼 분석 후 저장
      try {
        // 1. 엑셀 파일에서 컬럼 정보 추출
        const analyzeFormData = new FormData();
        analyzeFormData.append('file', file.file);

        const analyzeRes = await fetch('/api/analyze-template', {
          method: 'POST',
          body: analyzeFormData,
        });

        const analyzeResult = await analyzeRes.json();

        let columns: { name: string; type: string }[] = [];
        if (analyzeResult.success && analyzeResult.data?.headers) {
          columns = analyzeResult.data.headers.map((h: { name: string }) => ({
            name: h.name,
            type: 'string',
          }));
        }

        // 2. 템플릿 저장
        const formData = new FormData();
        formData.append('file', file.file);
        formData.append('name', file.name.replace(/\.[^/.]+$/, '')); // 확장자 제거한 이름
        formData.append('columns', JSON.stringify(columns));

        const res = await fetch('/api/templates', {
          method: 'POST',
          body: formData,
        });

        const result = await res.json();

        if (result.success) {
          alert(`템플릿이 등록되었습니다! (${columns.length}개 컬럼 감지)`);
        } else {
          alert('템플릿 등록 실패: ' + (result.error || '알 수 없는 오류'));
        }
      } catch (error) {
        console.error('Template upload error:', error);
        alert('템플릿 등록 중 오류가 발생했습니다.');
      }
    } else {
      // 데이터 업로드 → 바로 매핑 화면으로 이동
      try {
        setDataFile(file);
        const data = await parseDataFile(file.file);
        setDataRows(data);
        setSelectedTemplate(null);
        setMappings([]);
        setSelectedProfile(null);
        setStep('data-mapping');
      } catch (error) {
        console.error('Data parse error:', error);
        alert('데이터 파일 파싱 중 오류가 발생했습니다.');
      }
    }

    setIsModalOpen(false);
  };

  // 템플릿 선택 시
  const handleTemplateSelect = (template: Template, newMappings: ColumnMapping[]) => {
    setSelectedTemplate(template);
    setMappings(newMappings);
  };

  // 매핑 변경
  const handleMappingChange = (templateColumn: string, dataColumn: string | null) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.templateColumn === templateColumn
          ? { ...m, dataColumn, status: dataColumn ? 'manual' as const : 'unmatched' as const }
          : m
      )
    );
  };

  // 배치 매핑 변경 (자동 매핑 등에서 여러 개를 한 번에 변경)
  const handleBatchMappingChange = (changes: { templateColumn: string; dataColumn: string }[]) => {
    setMappings((prev) => {
      const changeMap = new Map(changes.map(c => [c.templateColumn, c.dataColumn]));
      return prev.map((m) => {
        const newDataColumn = changeMap.get(m.templateColumn);
        if (newDataColumn !== undefined) {
          return { ...m, dataColumn: newDataColumn, status: 'manual' as const };
        }
        return m;
      });
    });
  };

  // 매핑 저장
  const handleSaveMapping = async (name: string) => {
    if (!selectedTemplate || !dataFile || !dataRows) return false;

    try {
      // 매핑된 데이터만 추출
      const matchedMappings = mappings.filter(m => m.dataColumn !== null);
      const mappedHeaders = matchedMappings.map(m => m.templateColumn);

      // 매핑된 컬럼으로 데이터 변환
      const mappedData = dataRows.rows.map(row => {
        const newRow: Record<string, string | number | boolean | null> = {};
        matchedMappings.forEach(m => {
          if (m.dataColumn) {
            newRow[m.templateColumn] = row[m.dataColumn];
          }
        });
        return newRow;
      });

      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          dataFileName: dataFile.name,
          mappings: matchedMappings,
          rowCount: dataRows.rows.length,
          headers: mappedHeaders,
          previewData: mappedData.slice(0, 100), // 미리보기용 100행
          fullData: mappedData, // 전체 데이터
        }),
      });

      const result = await res.json();
      return result.success;
    } catch (error) {
      console.error('Save mapping error:', error);
      return false;
    }
  };

  // 매핑 확정 및 다운로드
  const handleMappingConfirm = () => {
    console.log('Mapping confirmed:', mappings);
    alert('매핑이 확정되었습니다. 다운로드를 시작합니다. (API 연동 예정)');
  };

  // 템플릿 다시 선택
  const handleChangeTemplate = () => {
    setSelectedTemplate(null);
    setMappings([]);
    setSelectedProfile(null);
  };

  return (
    <div className="h-screen bg-gray-50 flex overflow-hidden">
      {/* 사이드바 */}
      <aside className="w-48 bg-white border-r border-gray-200 flex flex-col py-4 px-3 flex-shrink-0">
        {/* 로고 & 앱 이름 */}
        <button
          onClick={goHome}
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
            onClick={goHome}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all bg-teal-50 text-teal-700 font-medium"
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
            onClick={() => router.push('/reports')}
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all hover:bg-gray-100 text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            <span>보고서</span>
          </button>
        </nav>

        {/* 사용자 정보 & 로그아웃 */}
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
                  <p className="text-xs text-gray-500 truncate">
                    {user.email}
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
      {step === 'home' && (
        <main className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
          <div className="max-w-2xl w-full text-center">
            <h1 className="text-4xl font-light text-gray-900 italic mb-2">
              안녕하세요
            </h1>
            <p className="text-xl text-gray-500 mb-12">
              Excel 템플릿에 데이터를 자동 매핑하여 보고서를 생성하세요
            </p>

            {/* 메인 버튼들 */}
            <div className="flex gap-4 justify-center mb-12">
              <button
                onClick={openTemplateModal}
                className="inline-flex items-center gap-3 px-6 py-4 border-2 border-gray-300 text-gray-700 rounded-xl hover:border-teal-500 hover:text-teal-600 transition-all text-lg font-medium"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                템플릿 등록
              </button>
              <button
                onClick={openDataModal}
                className="inline-flex items-center gap-3 px-6 py-4 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-all text-lg font-medium"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                데이터 업로드
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all text-left">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900 mb-1">1. 템플릿 등록</h3>
                <p className="text-sm text-gray-500">보고서 양식을 미리 등록하세요</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all text-left">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900 mb-1">2. 데이터 업로드</h3>
                <p className="text-sm text-gray-500">원본 데이터를 업로드하세요</p>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all text-left">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <h3 className="font-medium text-gray-900 mb-1">3. 매핑 & 저장</h3>
                <p className="text-sm text-gray-500">AI로 매핑하고 결과를 저장하세요</p>
              </div>
            </div>
          </div>
        </main>
      )}

      {step === 'data-mapping' && dataFile && dataRows && (
        <ResizableDivider
          leftPanel={
            !selectedTemplate ? (
              <TemplateSelectorPanel
                dataFileName={dataFile.name}
                dataHeaders={dataRows.headers}
                dataRows={dataRows.rows}
                onTemplateSelect={handleTemplateSelect}
                selectedTemplateId={null}
                selectedProfile={selectedProfile}
              />
            ) : (
              <MappingPreviewPanel
                templateName={selectedTemplate.name}
                dataFileName={dataFile.name}
                mappings={mappings}
                previewData={dataRows.rows}
                dataHeaders={dataRows.headers}
                onMappingChange={handleMappingChange}
                onDownload={handleMappingConfirm}
              />
            )
          }
          rightPanel={
            <CommandPanel
              mappings={mappings}
              dataHeaders={dataRows.headers}
              onMappingChange={handleMappingChange}
              onBatchMappingChange={handleBatchMappingChange}
              onSaveMapping={handleSaveMapping}
              onConfirm={handleMappingConfirm}
              onAddData={openDataModal}
              selectedTemplate={selectedTemplate}
              onChangeTemplate={handleChangeTemplate}
              templateId={selectedTemplate?.id}
              sourceType={dataFile?.type}
            />
          }
          initialRightWidth={420}
          minRightWidth={320}
          maxRightWidth={600}
        />
      )}

      {/* 파일 업로드 모달 */}
      <FileUploadModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onContinue={handleFileContinue}
        mode={modalMode}
      />
    </div>
  );
}
