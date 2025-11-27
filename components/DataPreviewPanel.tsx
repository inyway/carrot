'use client';

import { useState } from 'react';

interface DataRow {
  [key: string]: string | number | boolean | null;
}

interface DataPreviewPanelProps {
  fileName: string;
  fileType: 'xlsx' | 'csv';
  headers: string[];
  data: DataRow[];
  onDownload?: () => void;
}

export default function DataPreviewPanel({
  fileName,
  fileType,
  headers,
  data,
  onDownload,
}: DataPreviewPanelProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 14;
  const totalPages = Math.ceil(data.length / rowsPerPage);

  const currentData = data.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Uploaded Files</span>
            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">1</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Charts</span>
            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">0</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Output Files</span>
            <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded">0</span>
          </div>
        </div>
      </div>

      {/* 파일 선택 드롭다운 */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              fileType === 'xlsx' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {fileType.toUpperCase()}
            </span>
            <span className="text-sm text-gray-700 truncate max-w-[300px]">{fileName}</span>
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {onDownload && (
            <button
              onClick={onDownload}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-sm"
            >
              Download
            </button>
          )}
        </div>
      </div>

      {/* 데이터 테이블 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500 border-b border-gray-200">
                ID
              </th>
              {headers.map((header, index) => (
                <th
                  key={index}
                  className="px-4 py-3 text-left font-medium text-gray-500 border-b border-gray-200 whitespace-nowrap"
                >
                  {header || `?? ??`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentData.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 border-b border-gray-100">
                  {(currentPage - 1) * rowsPerPage + rowIndex + 1}
                </td>
                {headers.map((header, colIndex) => (
                  <td
                    key={colIndex}
                    className="px-4 py-3 text-gray-700 border-b border-gray-100 whitespace-nowrap max-w-[200px] truncate"
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
      <div className="flex items-center justify-center gap-4 p-4 border-t border-gray-200">
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
          Page {currentPage} of {totalPages || 1}
        </span>
        <button
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages || totalPages === 0}
          className="p-1 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* 미리보기 제한 안내 */}
      <div className="flex items-center justify-center gap-2 py-2 bg-gray-50 text-xs text-gray-500">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Preview limited to the first 60 rows.
      </div>
    </div>
  );
}
