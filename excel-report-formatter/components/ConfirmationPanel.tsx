'use client';

import { useState } from 'react';

interface ConfirmationPanelProps {
  fileName: string;
  headers: string[];
  onConfirm: () => void;
  onAddData: () => void;
}

export default function ConfirmationPanel({
  fileName,
  headers,
  onConfirm,
  onAddData,
}: ConfirmationPanelProps) {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const handleConfirm = () => {
    setIsConfirmed(true);
    onConfirm();
  };

  return (
    <div className="h-full flex flex-col bg-[#faf9f7]">
      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* 환영 메시지 */}
        <div className="mb-6">
          <p className="text-gray-800 mb-4">안녕하세요!</p>
          <p className="text-gray-800 mb-4">
            템플릿 분석 및 데이터 처리를 도와드리겠습니다.
          </p>
          <p className="text-gray-600 mb-4">다음과 같은 작업을 도와드릴 수 있습니다:</p>
          <ul className="space-y-2 mb-6">
            <li className="flex items-center gap-2 text-gray-700">
              <span className="text-lg">📊</span>
              데이터 분석 - CSV, Excel 파일 분석
            </li>
            <li className="flex items-center gap-2 text-gray-700">
              <span className="text-lg">📈</span>
              차트 및 시각화 - 다양한 그래프 생성
            </li>
            <li className="flex items-center gap-2 text-gray-700">
              <span className="text-lg">🔍</span>
              데이터 탐색 - 필터링, 정렬, 그룹화
            </li>
            <li className="flex items-center gap-2 text-gray-700">
              <span className="text-lg">📋</span>
              데이터 변환 - 정제, 통합, 변환
            </li>
          </ul>
        </div>

        {/* 파일 확인 요청 */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 mb-4">
          <p className="text-gray-700 mb-3">
            현재 업로드된 파일이 있습니다:
          </p>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg mb-4">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-gray-800">{fileName}</span>
          </div>

          {headers.length > 0 && (
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">감지된 컬럼 ({headers.length}개):</p>
              <div className="flex flex-wrap gap-2">
                {headers.slice(0, 8).map((header, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 bg-teal-50 text-teal-700 text-xs rounded-md"
                  >
                    {header}
                  </span>
                ))}
                {headers.length > 8 && (
                  <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs rounded-md">
                    +{headers.length - 8}개 더
                  </span>
                )}
              </div>
            </div>
          )}

          <p className="text-gray-700 mb-3">
            이 파일을 템플릿으로 등록하시겠습니까?
          </p>

          {!isConfirmed ? (
            <div className="flex gap-2">
              <button
                onClick={handleConfirm}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-all text-sm font-medium"
              >
                확인
              </button>
              <button
                onClick={onAddData}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-sm"
              >
                다른 파일 선택
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-600">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium">템플릿이 확인되었습니다!</span>
            </div>
          )}
        </div>

        {isConfirmed && (
          <div className="bg-white rounded-xl p-4 border border-gray-200">
            <p className="text-gray-700 mb-2">
              템플릿 등록이 완료되었습니다.
            </p>
            <p className="text-gray-600 text-sm">
              이제 데이터 파일을 업로드하면 자동으로 보고서를 생성할 수 있습니다.
            </p>
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="How can we help you today?"
              className="flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          <button
            onClick={onAddData}
            className="p-3 hover:bg-gray-100 rounded-xl transition-all"
            title="Add data"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button className="p-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
