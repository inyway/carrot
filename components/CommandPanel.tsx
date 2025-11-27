'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  type: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  actions?: MappingAction[];
}

interface MappingAction {
  type: 'map' | 'unmap' | 'auto_map' | 'info' | 'confirm';
  templateColumn?: string;
  dataColumn?: string | null;
  mappings?: { templateColumn: string; dataColumn: string }[];
  message: string;
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

interface CommandPanelProps {
  mappings: ColumnMapping[];
  dataHeaders: string[];
  onMappingChange: (templateColumn: string, dataColumn: string | null) => void;
  onBatchMappingChange: (changes: { templateColumn: string; dataColumn: string }[]) => void;
  onSaveMapping?: (name: string) => Promise<boolean>;
  onConfirm: () => void;
  onAddData: () => void;
  selectedTemplate: Template | null;
  onChangeTemplate: () => void;
}

export default function CommandPanel({
  mappings,
  dataHeaders,
  onMappingChange,
  onBatchMappingChange,
  onSaveMapping,
  onConfirm,
  onAddData,
  selectedTemplate,
  onChangeTemplate,
}: CommandPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveConfirmMode, setSaveConfirmMode] = useState(false);
  const [reportName, setReportName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const unmatchedColumns = mappings.filter(m => m.status === 'unmatched');
  const matchedColumns = mappings.filter(m => m.status !== 'unmatched');

  // 메시지 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 템플릿 선택 시 초기 메시지
  useEffect(() => {
    if (selectedTemplate && messages.length === 0) {
      const welcomeMessage: Message = {
        id: 'welcome',
        type: 'system',
        content: `"${selectedTemplate.name}" 템플릿이 선택되었습니다.\n\n` +
          `📊 현재 상태:\n` +
          `• 매칭됨: ${matchedColumns.length}개\n` +
          `• 미매칭: ${unmatchedColumns.length}개\n\n` +
          `매핑을 어떻게 도와드릴까요?`,
        timestamp: new Date(),
      };
      setMessages([welcomeMessage]);
    }
  }, [selectedTemplate, matchedColumns.length, unmatchedColumns.length, messages.length]);

  // API 호출
  const sendMessage = async (userInput: string) => {
    if (!userInput.trim() || !selectedTemplate) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: userInput,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: userInput,
          mappings,
          templateColumns: selectedTemplate.columns.map(c => c.name),
          dataColumns: dataHeaders,
        }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        const { message, actions } = result.data;

        // 액션 처리
        processActions(actions);

        // 어시스턴트 메시지 추가
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          type: 'assistant',
          content: message,
          timestamp: new Date(),
          actions,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error(result.error || '처리 실패');
      }
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: '죄송합니다. 요청을 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // 액션 처리
  const processActions = (actions: MappingAction[]) => {
    for (const action of actions) {
      switch (action.type) {
        case 'map':
          if (action.templateColumn && action.dataColumn) {
            onMappingChange(action.templateColumn, action.dataColumn);
          }
          break;

        case 'unmap':
          if (action.templateColumn) {
            onMappingChange(action.templateColumn, null);
          }
          break;

        case 'auto_map':
          if (action.mappings && action.mappings.length > 0) {
            onBatchMappingChange(action.mappings);
          }
          break;

        case 'confirm':
          // 확정 요청은 사용자가 버튼 클릭해야 함
          break;

        case 'info':
        default:
          // 정보성 메시지, 액션 없음
          break;
      }
    }
  };

  const handleSend = () => {
    sendMessage(inputValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 빠른 명령 클릭
  const handleQuickCommand = (command: string) => {
    sendMessage(command);
  };

  // 저장 확인 모드 시작
  const startSaveConfirm = () => {
    const matchedCount = mappings.filter(m => m.dataColumn !== null).length;
    const unmatchedCount = mappings.filter(m => m.status === 'unmatched').length;

    const confirmMessage: Message = {
      id: Date.now().toString(),
      type: 'assistant',
      content: `📋 **매핑 확인**\n\n` +
        `현재 ${matchedCount}개 컬럼이 매핑되었고, ${unmatchedCount}개가 미매핑 상태입니다.\n\n` +
        `이대로 저장하시겠습니까? 아래에 보고서 이름을 입력해주세요.`,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, confirmMessage]);
    setSaveConfirmMode(true);
    setReportName(selectedTemplate?.name ? `${selectedTemplate.name}_보고서` : '새 보고서');
  };

  // 저장 실행
  const handleSave = async () => {
    if (!reportName.trim() || !onSaveMapping) return;

    setIsSaving(true);

    const savingMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: `보고서 이름: ${reportName}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, savingMessage]);

    try {
      const success = await onSaveMapping(reportName.trim());

      const resultMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: success
          ? `✅ **저장 완료**\n\n"${reportName}" 보고서가 저장되었습니다.\n\n저장된 보고서 페이지에서 확인하실 수 있습니다.`
          : `❌ **저장 실패**\n\n보고서 저장 중 오류가 발생했습니다. 다시 시도해주세요.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, resultMessage]);
    } catch {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'assistant',
        content: `❌ **저장 실패**\n\n보고서 저장 중 오류가 발생했습니다.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsSaving(false);
      setSaveConfirmMode(false);
      setReportName('');
    }
  };

  // 저장 취소
  const cancelSave = () => {
    setSaveConfirmMode(false);
    setReportName('');
    const cancelMessage: Message = {
      id: Date.now().toString(),
      type: 'assistant',
      content: '저장이 취소되었습니다. 다른 도움이 필요하시면 말씀해주세요.',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, cancelMessage]);
  };

  return (
    <div className="h-full flex flex-col bg-[#faf9f7]">
      {/* 채팅 영역 */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* 템플릿 미선택 시 안내 */}
        {!selectedTemplate ? (
          <div className="bg-white rounded-xl p-6 border border-gray-200 text-center">
            <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="font-medium text-gray-900 mb-2">템플릿을 선택하세요</h3>
            <p className="text-sm text-gray-500">
              왼쪽 패널에서 저장된 템플릿 중 하나를 선택하면<br />
              AI가 매핑을 도와드립니다.
            </p>
          </div>
        ) : (
          <>
            {/* 선택된 템플릿 정보 */}
            <div className="bg-teal-50 rounded-xl p-3 border border-teal-200 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{selectedTemplate.name}</p>
                    <p className="text-xs text-gray-500">
                      {matchedColumns.length}개 매칭 / {unmatchedColumns.length}개 미매칭
                    </p>
                  </div>
                </div>
                <button
                  onClick={onChangeTemplate}
                  className="px-2 py-1 text-xs text-teal-700 hover:bg-teal-100 rounded-lg transition-all"
                >
                  변경
                </button>
              </div>
            </div>

            {/* 메시지 목록 */}
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`${message.type === 'user' ? 'flex justify-end' : ''}`}
                >
                  <div
                    className={`max-w-[90%] rounded-xl p-3 ${
                      message.type === 'user'
                        ? 'bg-teal-600 text-white'
                        : message.type === 'system'
                        ? 'bg-blue-50 border border-blue-200 text-gray-700'
                        : 'bg-white border border-gray-200 text-gray-700'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>

                    {/* 액션 결과 표시 */}
                    {message.actions && message.actions.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
                        {message.actions.map((action, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 text-xs">
                            {action.type === 'map' && (
                              <>
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                <span className="text-green-700">매핑 완료</span>
                              </>
                            )}
                            {action.type === 'unmap' && (
                              <>
                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                                <span className="text-red-700">매핑 해제됨</span>
                              </>
                            )}
                            {action.type === 'auto_map' && action.mappings && (
                              <>
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                                <span className="text-blue-700">{action.mappings.length}개 자동 매핑됨</span>
                              </>
                            )}
                            {action.type === 'confirm' && (
                              <div className="flex gap-2">
                                <button
                                  onClick={startSaveConfirm}
                                  className="px-3 py-1 bg-teal-600 text-white rounded text-xs hover:bg-teal-700 transition-all"
                                >
                                  저장하기
                                </button>
                                <button
                                  onClick={onConfirm}
                                  className="px-3 py-1 border border-teal-600 text-teal-600 rounded text-xs hover:bg-teal-50 transition-all"
                                >
                                  다운로드
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* 로딩 표시 */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-200 rounded-xl p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-sm text-gray-500">AI가 분석 중...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* 빠른 명령 */}
            {messages.length <= 1 && !saveConfirmMode && (
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-2">빠른 명령:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleQuickCommand('미매칭 컬럼들을 자동으로 매핑해줘')}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-all"
                  >
                    🔄 자동 매칭
                  </button>
                  <button
                    onClick={() => handleQuickCommand('현재 매핑 상태를 알려줘')}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 transition-all"
                  >
                    📊 상태 확인
                  </button>
                  <button
                    onClick={startSaveConfirm}
                    disabled={matchedColumns.length === 0}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    💾 저장하기
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 하단 버튼 */}
      <div className="p-3 border-t border-gray-200 bg-white">
        {selectedTemplate ? (
          <>
            {/* 저장 확인 모드 */}
            {saveConfirmMode ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-200 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
                  <input
                    type="text"
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                    placeholder="보고서 이름을 입력하세요"
                    className="flex-1 bg-transparent outline-none text-sm"
                    disabled={isSaving}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleSave();
                      }
                    }}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cancelSave}
                    disabled={isSaving}
                    className="flex-1 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-all text-sm"
                  >
                    취소
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!reportName.trim() || isSaving}
                    className="flex-1 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all text-sm font-medium flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        저장 중...
                      </>
                    ) : (
                      '저장하기'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={onAddData}
                    className="flex-1 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-sm"
                  >
                    다른 데이터 선택
                  </button>
                  <button
                    onClick={startSaveConfirm}
                    disabled={matchedColumns.length === 0}
                    className="flex-1 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all text-sm font-medium"
                  >
                    확인 & 저장
                  </button>
                </div>

                {/* 입력 영역 */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-200 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="매핑을 어떻게 변경할까요? (예: 자동 매칭해줘)"
                      className="flex-1 bg-transparent outline-none text-sm"
                      disabled={isLoading}
                    />
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isLoading}
                    className="p-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <button
            onClick={onAddData}
            className="w-full py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-all text-sm"
          >
            다른 데이터 파일 선택
          </button>
        )}
      </div>
    </div>
  );
}
