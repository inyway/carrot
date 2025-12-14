'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import CubeLoader from '@/components/CubeLoader';

interface Company {
  id: string;
  name: string;
  slug: string;
}

interface Template {
  id: string;
  name: string;
  fileName: string;
  columns: { name: string; type: string }[];
  createdAt: string;
  companyId: string;
  company?: {
    id: string;
    name: string;
    slug: string;
  };
}

interface CleanReport {
  id: string;
  companyId: string;
  templateId: string;
  periodStart: string;
  periodEnd: string;
  finalText: string;
  hasEmbedding: boolean;
  createdAt: string;
}

// ============================================
// Mock 데이터 (개발용)
// ============================================
const USE_MOCK_DATA = true; // 실제 API 연동 시 false로 변경

const MOCK_COMPANIES: Company[] = [
  { id: 'company-1', name: '삼성전자', slug: 'samsung' },
  { id: 'company-2', name: 'LG전자', slug: 'lg' },
  { id: 'company-3', name: 'SK하이닉스', slug: 'skhynix' },
];

const MOCK_TEMPLATES: Template[] = [
  {
    id: 'template-1',
    name: '월간 매출 보고서',
    fileName: '삼성_월간매출_템플릿.xlsx',
    columns: [
      { name: '날짜', type: 'date' },
      { name: '제품명', type: 'string' },
      { name: '판매수량', type: 'number' },
      { name: '매출액', type: 'number' },
      { name: '영업이익', type: 'number' },
    ],
    createdAt: '2024-11-15T09:00:00Z',
    companyId: 'company-1',
    company: { id: 'company-1', name: '삼성전자', slug: 'samsung' },
  },
  {
    id: 'template-2',
    name: '분기별 실적 리포트',
    fileName: '삼성_분기실적_템플릿.xlsx',
    columns: [
      { name: '분기', type: 'string' },
      { name: '매출총액', type: 'number' },
      { name: '영업이익', type: 'number' },
      { name: '순이익', type: 'number' },
    ],
    createdAt: '2024-10-20T14:30:00Z',
    companyId: 'company-1',
    company: { id: 'company-1', name: '삼성전자', slug: 'samsung' },
  },
  {
    id: 'template-3',
    name: '주간 판매 현황',
    fileName: 'LG_주간판매_템플릿.xlsx',
    columns: [
      { name: '주차', type: 'string' },
      { name: '제품군', type: 'string' },
      { name: '판매량', type: 'number' },
      { name: '전주대비', type: 'number' },
    ],
    createdAt: '2024-12-01T10:00:00Z',
    companyId: 'company-2',
    company: { id: 'company-2', name: 'LG전자', slug: 'lg' },
  },
  {
    id: 'template-4',
    name: '반도체 생산량 보고서',
    fileName: 'SK_반도체생산_템플릿.xlsx',
    columns: [
      { name: '생산라인', type: 'string' },
      { name: '제품타입', type: 'string' },
      { name: '생산량', type: 'number' },
      { name: '불량률', type: 'number' },
      { name: '가동률', type: 'number' },
    ],
    createdAt: '2024-11-28T16:45:00Z',
    companyId: 'company-3',
    company: { id: 'company-3', name: 'SK하이닉스', slug: 'skhynix' },
  },
];

// Excel 미리보기용 샘플 데이터
interface ExcelPreviewData {
  sheetName: string;
  headers: string[];
  rows: (string | number)[][];
  formulas?: { cell: string; formula: string }[];
}

const MOCK_EXCEL_PREVIEWS: Record<string, ExcelPreviewData> = {
  'template-1': {
    sheetName: '월간매출',
    headers: ['날짜', '제품명', '판매수량', '매출액', '영업이익'],
    rows: [
      ['2024-10-01', '갤럭시 S24', 15000, 18000000000, 3600000000],
      ['2024-10-01', '갤럭시 Z폴드6', 8000, 16000000000, 4000000000],
      ['2024-10-02', '갤럭시 S24', 12000, 14400000000, 2880000000],
      ['2024-10-02', '갤럭시 버즈3', 25000, 5000000000, 1500000000],
      ['2024-10-03', '갤럭시 탭 S9', 6000, 6000000000, 1200000000],
    ],
    formulas: [
      { cell: 'D7', formula: '=SUM(D2:D6)' },
      { cell: 'E7', formula: '=SUM(E2:E6)' },
    ],
  },
  'template-2': {
    sheetName: '분기실적',
    headers: ['분기', '매출총액', '영업이익', '순이익'],
    rows: [
      ['2024 Q1', 74000000000000, 6500000000000, 5200000000000],
      ['2024 Q2', 78000000000000, 7200000000000, 5800000000000],
      ['2024 Q3', 91000000000000, 10400000000000, 8400000000000],
    ],
    formulas: [
      { cell: 'B5', formula: '=SUM(B2:B4)' },
      { cell: 'C5', formula: '=SUM(C2:C4)' },
      { cell: 'D5', formula: '=SUM(D2:D4)' },
    ],
  },
  'template-3': {
    sheetName: '주간판매',
    headers: ['주차', '제품군', '판매량', '전주대비'],
    rows: [
      ['48주차', 'TV', 15200, '+12%'],
      ['48주차', '냉장고', 8900, '+8%'],
      ['48주차', '세탁기', 7200, '+15%'],
      ['48주차', '에어컨', 3100, '-5%'],
      ['48주차', '스타일러', 4500, '+22%'],
    ],
  },
  'template-4': {
    sheetName: '생산현황',
    headers: ['생산라인', '제품타입', '생산량', '불량률', '가동률'],
    rows: [
      ['M16-1', 'HBM3E', 125000, '0.8%', '95.2%'],
      ['M16-2', 'HBM3E', 118000, '0.9%', '94.8%'],
      ['M15-1', 'DDR5', 450000, '1.2%', '92.5%'],
      ['M15-2', 'DDR5', 420000, '1.1%', '93.1%'],
      ['M14-1', 'NAND 256L', 890000, '1.5%', '91.0%'],
    ],
    formulas: [
      { cell: 'C7', formula: '=SUM(C2:C6)' },
    ],
  },
};

const MOCK_CLEAN_REPORTS: Record<string, CleanReport[]> = {
  'template-1': [
    {
      id: 'report-1',
      companyId: 'company-1',
      templateId: 'template-1',
      periodStart: '2024-10-01',
      periodEnd: '2024-10-31',
      finalText: '2024년 10월 삼성전자 월간 매출 보고서입니다. 총 매출 45조원, 영업이익 8.2조원을 기록했습니다. 스마트폰 부문이 전월 대비 12% 성장...',
      hasEmbedding: true,
      createdAt: '2024-11-05T10:30:00Z',
    },
    {
      id: 'report-2',
      companyId: 'company-1',
      templateId: 'template-1',
      periodStart: '2024-09-01',
      periodEnd: '2024-09-30',
      finalText: '2024년 9월 삼성전자 월간 매출 보고서입니다. 총 매출 42조원, 영업이익 7.8조원을 기록했습니다. 반도체 부문 회복세 지속...',
      hasEmbedding: true,
      createdAt: '2024-10-05T09:15:00Z',
    },
    {
      id: 'report-3',
      companyId: 'company-1',
      templateId: 'template-1',
      periodStart: '2024-08-01',
      periodEnd: '2024-08-31',
      finalText: '2024년 8월 삼성전자 월간 매출 보고서입니다. 여름 비수기에도 불구하고 견조한 실적을 유지...',
      hasEmbedding: false,
      createdAt: '2024-09-03T11:00:00Z',
    },
  ],
  'template-2': [
    {
      id: 'report-4',
      companyId: 'company-1',
      templateId: 'template-2',
      periodStart: '2024-07-01',
      periodEnd: '2024-09-30',
      finalText: '2024년 3분기 삼성전자 실적 리포트. 반도체 업황 회복과 함께 역대 최고 분기 실적 달성. AI 반도체 수요 급증...',
      hasEmbedding: true,
      createdAt: '2024-10-28T14:00:00Z',
    },
  ],
  'template-3': [
    {
      id: 'report-5',
      companyId: 'company-2',
      templateId: 'template-3',
      periodStart: '2024-11-25',
      periodEnd: '2024-12-01',
      finalText: 'LG전자 48주차 주간 판매 현황. 가전제품 블랙프라이데이 특수로 전주 대비 35% 판매량 증가...',
      hasEmbedding: true,
      createdAt: '2024-12-02T09:00:00Z',
    },
  ],
  'template-4': [],
};

export default function TemplatesPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // 새 템플릿 추가 모달 상태
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  // 새 회사 추가 상태
  const [showNewCompanyInput, setShowNewCompanyInput] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);

  // 학습 데이터 상태
  const [cleanReports, setCleanReports] = useState<CleanReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);

  // 아코디언 상태
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    company: true,
    learning: true,
    columns: false,
    excel: true,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // 숫자 포맷팅 함수
  const formatNumber = (value: string | number): string => {
    if (typeof value === 'number') {
      if (value >= 1000000000000) {
        return `${(value / 1000000000000).toFixed(1)}조`;
      } else if (value >= 100000000) {
        return `${(value / 100000000).toFixed(0)}억`;
      } else if (value >= 10000) {
        return `${(value / 10000).toFixed(0)}만`;
      } else {
        return value.toLocaleString();
      }
    }
    return String(value);
  };

  // 회사 목록 불러오기
  const fetchCompanies = async () => {
    if (USE_MOCK_DATA) {
      setCompanies(MOCK_COMPANIES);
      return;
    }
    try {
      const res = await fetch('/api/companies');
      const response = await res.json();
      if (response.success && Array.isArray(response.data)) {
        setCompanies(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch companies:', error);
    }
  };

  // 템플릿 목록 불러오기
  const fetchTemplates = async () => {
    if (USE_MOCK_DATA) {
      setTemplates(MOCK_TEMPLATES);
      setLoading(false);
      return;
    }
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

  // 학습 데이터 불러오기
  const fetchCleanReports = async (templateId: string) => {
    setLoadingReports(true);
    if (USE_MOCK_DATA) {
      // Mock 데이터 사용 시 약간의 딜레이 추가
      await new Promise(resolve => setTimeout(resolve, 300));
      setCleanReports(MOCK_CLEAN_REPORTS[templateId] || []);
      setLoadingReports(false);
      return;
    }
    try {
      const res = await fetch(`/api/rag/clean-reports?templateId=${templateId}`);
      const response = await res.json();
      if (response.success && Array.isArray(response.data)) {
        setCleanReports(response.data);
      } else {
        setCleanReports([]);
      }
    } catch (error) {
      console.error('Failed to fetch clean reports:', error);
      setCleanReports([]);
    } finally {
      setLoadingReports(false);
    }
  };

  // 학습 데이터 삭제
  const handleDeleteCleanReport = async (reportId: string) => {
    if (!confirm('이 학습 데이터를 삭제하시겠습니까?')) return;

    if (USE_MOCK_DATA) {
      // Mock 모드에서는 로컬 상태만 업데이트
      setCleanReports(prev => prev.filter(r => r.id !== reportId));
      return;
    }

    try {
      const res = await fetch(`/api/rag/clean-reports/${reportId}`, {
        method: 'DELETE',
      });

      const result = await res.json();

      if (result.success) {
        setCleanReports(prev => prev.filter(r => r.id !== reportId));
      } else {
        alert('삭제 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Delete clean report error:', error);
      alert('삭제 중 오류가 발생했습니다.');
    }
  };

  useEffect(() => {
    fetchCompanies();
    fetchTemplates();
  }, []);

  // 선택된 템플릿이 변경되면 학습 데이터 조회
  useEffect(() => {
    if (selectedTemplate) {
      fetchCleanReports(selectedTemplate.id);
    } else {
      setCleanReports([]);
    }
  }, [selectedTemplate]);

  // 파일 선택 시 모달 열기
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'xlsx' && ext !== 'xls') {
      alert('Excel 파일(.xlsx, .xls)만 업로드 가능합니다.');
      return;
    }

    setSelectedFile(file);
    setNewTemplateName(file.name.replace(/\.[^/.]+$/, ''));
    setShowAddModal(true);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 새 회사 생성
  const handleCreateCompany = async () => {
    if (!newCompanyName.trim()) return;

    setCreatingCompany(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCompanyName.trim() }),
      });

      const result = await res.json();
      if (result.success && result.data) {
        setCompanies(prev => [result.data, ...prev]);
        setSelectedCompanyId(result.data.id);
        setNewCompanyName('');
        setShowNewCompanyInput(false);
      } else {
        alert('회사 생성 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Create company error:', error);
      alert('회사 생성 중 오류가 발생했습니다.');
    } finally {
      setCreatingCompany(false);
    }
  };

  // 템플릿 업로드
  const handleSubmitTemplate = async () => {
    if (!selectedFile || !newTemplateName.trim() || !selectedCompanyId) {
      alert('모든 필드를 입력해주세요.');
      return;
    }

    setUploading(true);

    try {
      // 1. 컬럼 분석
      const analyzeFormData = new FormData();
      analyzeFormData.append('file', selectedFile);

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
      formData.append('file', selectedFile);
      formData.append('name', newTemplateName.trim());
      formData.append('companyId', selectedCompanyId);
      formData.append('columns', JSON.stringify(columns));

      const res = await fetch('/api/templates', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();

      if (result.success) {
        alert(`템플릿이 등록되었습니다! (${columns.length}개 컬럼 감지)`);
        setShowAddModal(false);
        setSelectedFile(null);
        setNewTemplateName('');
        setSelectedCompanyId('');
        fetchTemplates();
      } else {
        alert('템플릿 등록 실패: ' + (result.error || '알 수 없는 오류'));
      }
    } catch (error) {
      console.error('Template upload error:', error);
      alert('템플릿 등록 중 오류가 발생했습니다.');
    } finally {
      setUploading(false);
    }
  };

  // 모달 닫기
  const handleCloseModal = () => {
    setShowAddModal(false);
    setSelectedFile(null);
    setNewTemplateName('');
    setSelectedCompanyId('');
    setShowNewCompanyInput(false);
    setNewCompanyName('');
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

  // 회사별로 템플릿 그룹화
  const groupedTemplates = templates.reduce((acc, template) => {
    const companyName = template.company?.name || '미지정';
    if (!acc[companyName]) {
      acc[companyName] = [];
    }
    acc[companyName].push(template);
    return acc;
  }, {} as Record<string, Template[]>);

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
            className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all bg-teal-50 text-teal-700 font-medium"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>템플릿</span>
          </button>
          {/* HWPX 생성 메뉴 숨김 - converter에 통합됨 */}
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
      <main className="flex-1 p-8">
        <div className="max-w-6xl mx-auto">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">템플릿 관리</h1>
              <p className="text-gray-500 mt-1">회사별 보고서 템플릿을 등록하고 관리하세요</p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                disabled={uploading}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-all disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                템플릿 추가
              </button>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-6">
            {/* 템플릿 목록 - 회사별 그룹화 */}
            <div className="col-span-5">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                  <h2 className="font-medium text-gray-900">등록된 템플릿</h2>
                  <span className="text-sm text-gray-500">{templates.length}개</span>
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
                  <div>
                    {Object.entries(groupedTemplates).map(([companyName, companyTemplates]) => (
                      <div key={companyName}>
                        {/* 회사 헤더 */}
                        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          <span className="font-medium text-gray-700">{companyName}</span>
                          <span className="text-xs text-gray-400 ml-1">({companyTemplates.length})</span>
                        </div>

                        {/* 회사 템플릿 목록 */}
                        <div className="divide-y divide-gray-100">
                          {companyTemplates.map((template) => (
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 템플릿 상세 - 확장된 패널 */}
            <div className="col-span-7">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                  <h2 className="font-medium text-gray-900">템플릿 상세</h2>
                </div>

                {selectedTemplate ? (
                  <div className="p-6">
                    {/* 헤더 영역 */}
                    <div className="flex items-start gap-4 mb-6 pb-6 border-b border-gray-100">
                      <div className="w-14 h-14 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-gray-900">{selectedTemplate.name}</h3>
                        <p className="text-sm text-gray-500 mt-1">{selectedTemplate.fileName}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            {selectedTemplate.company?.name || '미지정'}
                          </span>
                          <span>•</span>
                          <span>{selectedTemplate.columns.length}개 컬럼</span>
                          <span>•</span>
                          <span>{new Date(selectedTemplate.createdAt).toLocaleDateString('ko-KR')}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(selectedTemplate)}
                        className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-all"
                      >
                        삭제
                      </button>
                    </div>

                    {/* 아코디언 섹션들 */}
                    <div className="space-y-3">
                      {/* Excel 구조 미리보기 아코디언 */}
                      <div className="border border-green-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleSection('excel')}
                          className="w-full px-4 py-3 bg-green-50 flex items-center justify-between hover:bg-green-100 transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                            </svg>
                            <span className="font-medium text-green-800">Excel 구조 미리보기</span>
                            {MOCK_EXCEL_PREVIEWS[selectedTemplate.id] && (
                              <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">
                                {MOCK_EXCEL_PREVIEWS[selectedTemplate.id].sheetName}
                              </span>
                            )}
                          </div>
                          <svg className={`w-5 h-5 text-green-600 transition-transform ${expandedSections.excel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {expandedSections.excel && MOCK_EXCEL_PREVIEWS[selectedTemplate.id] && (
                          <div className="p-4 bg-white">
                            {/* 인라인 Excel 테이블 */}
                            <div className="border border-gray-300 rounded-lg overflow-auto max-h-64">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="bg-gray-100">
                                    <th className="w-10 px-2 py-1.5 border-r border-b border-gray-300 text-center text-gray-500 font-medium text-xs">
                                      #
                                    </th>
                                    {MOCK_EXCEL_PREVIEWS[selectedTemplate.id].headers.map((_, idx) => (
                                      <th
                                        key={idx}
                                        className="px-2 py-1.5 border-r border-b border-gray-300 text-center text-gray-500 font-medium text-xs min-w-[80px]"
                                      >
                                        {String.fromCharCode(65 + idx)}
                                      </th>
                                    ))}
                                  </tr>
                                  <tr className="bg-green-50">
                                    <td className="px-2 py-1.5 border-r border-b border-gray-300 text-center text-gray-500 font-medium text-xs bg-gray-100">
                                      1
                                    </td>
                                    {MOCK_EXCEL_PREVIEWS[selectedTemplate.id].headers.map((header, idx) => (
                                      <td
                                        key={idx}
                                        className="px-2 py-1.5 border-r border-b border-gray-300 font-semibold text-green-800 text-xs"
                                      >
                                        {header}
                                      </td>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {MOCK_EXCEL_PREVIEWS[selectedTemplate.id].rows.map((row, rowIdx) => (
                                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      <td className="px-2 py-1.5 border-r border-b border-gray-300 text-center text-gray-500 font-medium text-xs bg-gray-100">
                                        {rowIdx + 2}
                                      </td>
                                      {row.map((cell, cellIdx) => (
                                        <td
                                          key={cellIdx}
                                          className={`px-2 py-1.5 border-r border-b border-gray-300 text-xs ${
                                            typeof cell === 'number' ? 'text-right font-mono' : ''
                                          }`}
                                        >
                                          {formatNumber(cell)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {/* 수식 정보 */}
                            {MOCK_EXCEL_PREVIEWS[selectedTemplate.id].formulas && MOCK_EXCEL_PREVIEWS[selectedTemplate.id].formulas!.length > 0 && (
                              <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                                <p className="text-xs font-medium text-blue-700 mb-2">수식</p>
                                <div className="flex flex-wrap gap-2">
                                  {MOCK_EXCEL_PREVIEWS[selectedTemplate.id].formulas!.map((f, idx) => (
                                    <span key={idx} className="text-xs bg-white px-2 py-1 rounded border border-blue-200">
                                      <span className="text-blue-600 font-mono">{f.cell}</span>
                                      <span className="text-gray-400 mx-1">=</span>
                                      <span className="text-blue-800 font-mono">{f.formula}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 학습 데이터 아코디언 */}
                      <div className="border border-purple-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleSection('learning')}
                          className="w-full px-4 py-3 bg-purple-50 flex items-center justify-between hover:bg-purple-100 transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            <span className="font-medium text-purple-800">학습 데이터 (RAG)</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              cleanReports.length > 0 ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'
                            }`}>
                              {loadingReports ? '...' : `${cleanReports.length}건`}
                            </span>
                          </div>
                          <svg className={`w-5 h-5 text-purple-600 transition-transform ${expandedSections.learning ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {expandedSections.learning && (
                          <div className="p-4 bg-white">
                            {loadingReports ? (
                              <div className="text-sm text-purple-500">불러오는 중...</div>
                            ) : cleanReports.length > 0 ? (
                              <div className="space-y-2">
                                {cleanReports.map((report) => (
                                  <div
                                    key={report.id}
                                    className="p-3 bg-purple-50 rounded-lg flex items-start justify-between"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-800">
                                        {new Date(report.periodStart).toLocaleDateString('ko-KR')} ~ {new Date(report.periodEnd).toLocaleDateString('ko-KR')}
                                      </p>
                                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                        {report.finalText}
                                      </p>
                                      <div className="flex items-center gap-2 mt-2">
                                        {report.hasEmbedding ? (
                                          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-600 rounded">
                                            임베딩 완료
                                          </span>
                                        ) : (
                                          <span className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-600 rounded">
                                            임베딩 대기
                                          </span>
                                        )}
                                        <span className="text-xs text-gray-400">
                                          {new Date(report.createdAt).toLocaleDateString('ko-KR')}
                                        </span>
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => handleDeleteCleanReport(report.id)}
                                      className="ml-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-all flex-shrink-0"
                                      title="삭제"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-4 text-gray-400">
                                <svg className="w-8 h-8 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                                <p className="text-sm">학습된 보고서가 없습니다</p>
                                <p className="text-xs mt-1">보고서 작성 시 자동으로 학습됩니다</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 컬럼 목록 아코디언 */}
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleSection('columns')}
                          className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                            </svg>
                            <span className="font-medium text-gray-800">컬럼 목록</span>
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                              {selectedTemplate.columns.length}개
                            </span>
                          </div>
                          <svg className={`w-5 h-5 text-gray-600 transition-transform ${expandedSections.columns ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {expandedSections.columns && (
                          <div className="p-4 bg-white">
                            {selectedTemplate.columns.length > 0 ? (
                              <div className="grid grid-cols-3 gap-2">
                                {selectedTemplate.columns.map((col, index) => (
                                  <div
                                    key={index}
                                    className="px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 flex items-center gap-2"
                                  >
                                    <span className="w-5 h-5 bg-gray-200 rounded text-xs flex items-center justify-center text-gray-500">
                                      {index + 1}
                                    </span>
                                    {col.name}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 text-center py-4">컬럼 정보가 없습니다</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-12 text-center text-gray-400">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-lg">템플릿을 선택하세요</p>
                    <p className="text-sm mt-1">왼쪽 목록에서 템플릿을 클릭하면 상세 정보를 확인할 수 있습니다</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 템플릿 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">새 템플릿 등록</h3>
              <button
                onClick={handleCloseModal}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 선택된 파일 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">파일</label>
                <div className="px-4 py-3 bg-gray-50 rounded-lg flex items-center gap-3">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-gray-700">{selectedFile?.name}</span>
                </div>
              </div>

              {/* 템플릿 이름 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">템플릿 이름</label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="템플릿 이름을 입력하세요"
                />
              </div>

              {/* 회사 선택 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  회사 선택 <span className="text-red-500">*</span>
                </label>

                {showNewCompanyInput ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCompanyName}
                      onChange={(e) => setNewCompanyName(e.target.value)}
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                      placeholder="새 회사 이름"
                      disabled={creatingCompany}
                    />
                    <button
                      onClick={handleCreateCompany}
                      disabled={creatingCompany || !newCompanyName.trim()}
                      className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-all"
                    >
                      {creatingCompany ? '생성중...' : '추가'}
                    </button>
                    <button
                      onClick={() => {
                        setShowNewCompanyInput(false);
                        setNewCompanyName('');
                      }}
                      className="px-3 py-2 text-gray-500 hover:text-gray-700"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={selectedCompanyId}
                      onChange={(e) => setSelectedCompanyId(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
                    >
                      <option value="">회사를 선택하세요</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setShowNewCompanyInput(true)}
                      className="text-sm text-teal-600 hover:text-teal-700 flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      새 회사 추가
                    </button>
                  </div>
                )}
              </div>

              {/* 안내 메시지 */}
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-700">
                  템플릿은 특정 회사의 보고서 양식입니다. 회사를 선택하면 해당 회사의 보고서 스타일에 맞게 데이터가 학습됩니다.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
              >
                취소
              </button>
              <button
                onClick={handleSubmitTemplate}
                disabled={uploading || !selectedCompanyId || !newTemplateName.trim()}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-all flex items-center gap-2"
              >
                {uploading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    등록 중...
                  </>
                ) : (
                  '템플릿 등록'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
