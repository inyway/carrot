'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import CubeLoader from '@/components/CubeLoader';

interface Template {
  id: string;
  name: string;
  fileName: string;
  columns: { name: string; type: string }[];
  createdAt: string;
}

export default function TemplatesPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // 템플릿 목록 불러오기
  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/templates');
      const response = await res.json();
      if (response.success && Array.isArray(response.data)) {
        setTemplates(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch templates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  // 템플릿 업로드
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 파일 형식 확인
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'xlsx' && ext !== 'xls') {
      alert('Excel 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }

    setUploading(true);

    try {
      // 1. 컬럼 분석
      const analyzeFormData = new FormData();
      analyzeFormData.append('file', file);

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
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^/.]+$/, ''));
      formData.append('columns', JSON.stringify(columns));

      const res = await fetch('/api/templates', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();

      if (result.success) {
        alert(`템플릿이 등록되었습니다! (${columns.length}개 컬럼 감지)`);
        fetchTemplates();
      } else {
        alert('템플릿 등록 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Template upload error:', error);
      alert('템플릿 등록 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 템플릿 삭제
  const handleDelete = async (template: Template) => {
    if (!confirm(`"${template.name}" 템플릿을 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch(`/api/templates?id=${template.id}`, {
        method: 'DELETE',
      });

      const result = await res.json();

      if (result.success) {
        alert('템플릿이 삭제되었습니다.');
        setSelectedTemplate(null);
        fetchTemplates();
      } else {
        alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  if (authLoading) {
    return <CubeLoader />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 사이드바 */}
      <aside className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4">
        <button
          onClick={() => router.push('/')}
          className="w-10 h-10 bg-teal-600 rounded-lg flex items-center justify-center mb-8 hover:bg-teal-700 transition-all"
          title="홈으로"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </button>

        <nav className="flex-1 flex flex-col gap-2">
          <button
            onClick={() => router.push('/')}
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:bg-gray-100 text-gray-500"
            title="홈"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
          <button
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all bg-teal-50 text-teal-600"
            title="템플릿 관리"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => router.push('/reports')}
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:bg-gray-100 text-gray-500"
            title="저장된 보고서"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>
        </nav>

        {/* 사용자 정보 & 로그아웃 */}
        <div className="mt-auto pt-4 border-t border-gray-200">
          {user && (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center text-teal-600 text-xs font-medium"
                title={user.email || ''}
              >
                {user.email?.charAt(0).toUpperCase()}
              </div>
              <button
                onClick={signOut}
                className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:bg-red-50 text-gray-400 hover:text-red-500"
                title="로그아웃"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 p-8">
        <div className="max-w-6xl mx-auto">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">템플릿 관리</h1>
              <p className="text-gray-500 mt-1">보고서 템플릿을 등록하고 관리하세요</p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploading}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-all disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    업로드 중...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    템플릿 추가
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* 템플릿 목록 */}
            <div className="col-span-2">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="font-medium text-gray-900">등록된 템플릿</h2>
                </div>

                {loading ? (
                  <div className="p-8 text-center text-gray-400">
                    <svg className="animate-spin h-8 w-8 mx-auto mb-2 text-teal-600" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    불러오는 중...
                  </div>
                ) : templates.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p>등록된 템플릿이 없습니다</p>
                    <p className="text-sm mt-1">위의 &ldquo;템플릿 추가&rdquo; 버튼을 클릭하여 템플릿을 등록하세요</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {templates.map((template) => (
                      <div
                        key={template.id}
                        onClick={() => setSelectedTemplate(template)}
                        className={`px-6 py-4 flex items-center justify-between cursor-pointer transition-all ${
                          selectedTemplate?.id === template.id
                            ? 'bg-teal-50 border-l-4 border-teal-500'
                            : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            selectedTemplate?.id === template.id ? 'bg-teal-500' : 'bg-green-100'
                          }`}>
                            <svg className={`w-5 h-5 ${selectedTemplate?.id === template.id ? 'text-white' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{template.name}</p>
                            <p className="text-sm text-gray-500">
                              {template.columns.length}개 컬럼 • {new Date(template.createdAt).toLocaleDateString('ko-KR')}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(template);
                          }}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="삭제"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 템플릿 상세 */}
            <div className="col-span-1">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden sticky top-8">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="font-medium text-gray-900">템플릿 상세</h2>
                </div>

                {selectedTemplate ? (
                  <div className="p-6">
                    <div className="mb-6">
                      <div className="w-16 h-16 bg-green-100 rounded-xl flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">{selectedTemplate.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">{selectedTemplate.fileName}</p>
                    </div>

                    <div className="mb-6">
                      <p className="text-sm font-medium text-gray-700 mb-2">컬럼 목록 ({selectedTemplate.columns.length}개)</p>
                      {selectedTemplate.columns.length > 0 ? (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {selectedTemplate.columns.map((col, index) => (
                            <div
                              key={index}
                              className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700"
                            >
                              {col.name}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">컬럼 정보가 없습니다</p>
                      )}
                    </div>

                    <div className="text-sm text-gray-500">
                      <p>등록일: {new Date(selectedTemplate.createdAt).toLocaleString('ko-KR')}</p>
                    </div>

                    <button
                      onClick={() => handleDelete(selectedTemplate)}
                      className="w-full mt-6 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-all"
                    >
                      템플릿 삭제
                    </button>
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-400">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p>템플릿을 선택하세요</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
