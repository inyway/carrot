'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import * as XLSX from 'xlsx';
import CubeLoader from '@/components/CubeLoader';

interface Report {
  id: string;
  name: string;
  template_id: string;
  template_name: string;
  data_file_name: string;
  mappings: string;
  row_count: number;
  matched_count: number;
  headers: string;
  preview_data: string;
  full_data: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ColumnMapping {
  templateColumn: string;
  dataColumn: string | null;
  status: 'matched' | 'unmatched' | 'manual';
}

type DataRow = Record<string, string | number | boolean | null>;

export default function ReportsPage() {
  const router = useRouter();
  const { user, signOut, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'data'>('data');
  const [isDownloading, setIsDownloading] = useState(false);

  // 보고서 목록 로드
  useEffect(() => {
    if (!authLoading) {
      loadReports();
    }
  }, [authLoading]);

  const loadReports = async () => {
    try {
      const res = await fetch('/api/reports');
      const result = await res.json();
      if (result.success) {
        setReports(result.data || []);
      }
    } catch (error) {
      console.error('Load reports error:', error);
    } finally {
      setLoading(false);
    }
  };

  // 보고서 삭제
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/reports?id=${id}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (result.success) {
        setReports((prev) => prev.filter((r) => r.id !== id));
        setDeleteConfirm(null);
        if (selectedReport?.id === id) {
          setSelectedReport(null);
        }
      }
    } catch (error) {
      console.error('Delete report error:', error);
    }
  };

  // 엑셀 다운로드
  const handleDownload = async () => {
    if (!selectedReport) return;

    setIsDownloading(true);
    try {
      const headers = parseHeaders(selectedReport.headers);
      const fullData = parseData(selectedReport.full_data);

      if (headers.length === 0 || fullData.length === 0) {
        alert('다운로드할 데이터가 없습니다.');
        return;
      }

      // 데이터를 2D 배열로 변환
      const wsData = [
        headers, // 헤더 행
        ...fullData.map(row => headers.map(h => row[h] ?? ''))
      ];

      // 워크시트 생성
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // 컬럼 너비 자동 조정
      const colWidths = headers.map(h => ({
        wch: Math.max(h.length, 15)
      }));
      ws['!cols'] = colWidths;

      // 워크북 생성
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data');

      // 파일 다운로드
      const fileName = `${selectedReport.name}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (error) {
      console.error('Download error:', error);
      alert('다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsDownloading(false);
    }
  };

  // 날짜 포맷
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  // 매핑 데이터 파싱
  const parseMappings = (mappingsStr: string): ColumnMapping[] => {
    try {
      return JSON.parse(mappingsStr);
    } catch {
      return [];
    }
  };

  // 헤더 파싱
  const parseHeaders = (headersStr: string): string[] => {
    try {
      return JSON.parse(headersStr || '[]');
    } catch {
      return [];
    }
  };

  // 데이터 파싱
  const parseData = (dataStr: string): DataRow[] => {
    try {
      return JSON.parse(dataStr || '[]');
    } catch {
      return [];
    }
  };

  if (authLoading || loading) {
    return <CubeLoader />;
  }

  const headers = selectedReport ? parseHeaders(selectedReport.headers) : [];
  const previewData = selectedReport ? parseData(selectedReport.preview_data) : [];

  return (
    <div className="h-screen bg-gray-50 flex overflow-hidden">
      {/* 사이드바 */}
      <aside className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 flex-shrink-0">
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
            onClick={() => router.push('/templates')}
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all hover:bg-gray-100 text-gray-500"
            title="템플릿 관리"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
          <button
            className="w-10 h-10 rounded-lg flex items-center justify-center transition-all bg-teal-50 text-teal-600"
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
      <main className="flex-1 flex overflow-hidden">
        {/* 보고서 목록 */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-gray-200">
            <h1 className="text-lg font-semibold text-gray-900">저장된 보고서</h1>
            <p className="text-sm text-gray-500 mt-1">
              {reports.length}개의 보고서
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {reports.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-gray-500 text-sm">저장된 보고서가 없습니다</p>
                <button
                  onClick={() => router.push('/')}
                  className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-all"
                >
                  보고서 만들기
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {reports.map((report) => (
                  <div
                    key={report.id}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-all ${
                      selectedReport?.id === report.id ? 'bg-teal-50 border-l-2 border-teal-500' : ''
                    }`}
                    onClick={() => setSelectedReport(report)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-gray-900 truncate">{report.name}</h3>
                        <p className="text-xs text-gray-500 mt-1">
                          {report.template_name}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDate(report.created_at)}
                        </p>
                      </div>
                      <div className="ml-2 flex items-center gap-1">
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs rounded">
                          {report.matched_count}개 매핑
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 보고서 상세 */}
        <div className="flex-1 overflow-hidden bg-gray-50 flex flex-col">
          {selectedReport ? (
            <>
              {/* 헤더 */}
              <div className="bg-white border-b border-gray-200 p-4 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{selectedReport.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {selectedReport.template_name} • {selectedReport.row_count}행 • {selectedReport.matched_count}개 컬럼
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownload}
                      disabled={isDownloading || headers.length === 0}
                      className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                      {isDownloading ? (
                        <>
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          다운로드 중...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Excel 다운로드
                        </>
                      )}
                    </button>
                    {deleteConfirm === selectedReport.id ? (
                      <>
                        <button
                          onClick={() => handleDelete(selectedReport.id)}
                          className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-all"
                        >
                          삭제 확인
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-all"
                        >
                          취소
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(selectedReport.id)}
                        className="px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-all"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>

                {/* 탭 */}
                <div className="flex gap-4 mt-4 border-b border-gray-200 -mb-4 -mx-4 px-4">
                  <button
                    onClick={() => setActiveTab('data')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-all ${
                      activeTab === 'data'
                        ? 'border-teal-500 text-teal-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    데이터 미리보기
                  </button>
                  <button
                    onClick={() => setActiveTab('info')}
                    className={`pb-3 px-1 text-sm font-medium border-b-2 transition-all ${
                      activeTab === 'info'
                        ? 'border-teal-500 text-teal-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    매핑 정보
                  </button>
                </div>
              </div>

              {/* 컨텐츠 */}
              <div className="flex-1 overflow-auto p-4">
                {activeTab === 'data' ? (
                  // 데이터 미리보기
                  headers.length > 0 && previewData.length > 0 ? (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="p-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                        <span className="text-sm text-gray-600">
                          {previewData.length}행 미리보기 (전체 {selectedReport.row_count}행)
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 border-r border-gray-200 w-12">
                                #
                              </th>
                              {headers.map((header, idx) => (
                                <th
                                  key={idx}
                                  className="px-3 py-2 text-left text-xs font-medium text-gray-700 border-r border-gray-200 whitespace-nowrap min-w-[120px]"
                                >
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {previewData.map((row, rowIdx) => (
                              <tr key={rowIdx} className="hover:bg-gray-50">
                                <td className="px-3 py-2 text-xs text-gray-400 border-r border-gray-100 bg-gray-50">
                                  {rowIdx + 1}
                                </td>
                                {headers.map((header, colIdx) => (
                                  <td
                                    key={colIdx}
                                    className="px-3 py-2 text-sm text-gray-700 border-r border-gray-100 whitespace-nowrap max-w-[200px] truncate"
                                    title={String(row[header] ?? '')}
                                  >
                                    {row[header] !== null && row[header] !== undefined ? String(row[header]) : '-'}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-gray-500">데이터가 없습니다</p>
                      <p className="text-sm text-gray-400 mt-1">이 보고서에는 저장된 데이터가 없습니다.</p>
                    </div>
                  )
                ) : (
                  // 매핑 정보
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 border-b border-gray-200 bg-gray-50">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-xs text-gray-500">템플릿</p>
                          <p className="font-medium text-gray-900">{selectedReport.template_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">데이터 파일</p>
                          <p className="font-medium text-gray-900">{selectedReport.data_file_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">데이터 행 수</p>
                          <p className="font-medium text-gray-900">{selectedReport.row_count}행</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">매핑된 컬럼</p>
                          <p className="font-medium text-gray-900">{selectedReport.matched_count}개</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="text-sm font-medium text-gray-900 mb-3">컬럼 매핑</h3>
                      <div className="space-y-2">
                        {parseMappings(selectedReport.mappings).map((mapping, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                          >
                            <span className="flex-1 text-sm font-medium text-gray-700 truncate">
                              {mapping.templateColumn}
                            </span>
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                            </svg>
                            <span className="flex-1 text-sm text-gray-600 truncate">
                              {mapping.dataColumn || '-'}
                            </span>
                            <span className={`px-2 py-0.5 text-xs rounded ${
                              mapping.status === 'matched' ? 'bg-green-100 text-green-700' :
                              mapping.status === 'manual' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>
                              {mapping.status === 'matched' ? '자동' :
                               mapping.status === 'manual' ? '수동' : '미매핑'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-gray-500">보고서를 선택하세요</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
