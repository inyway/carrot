'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export interface FieldRelation {
  targetField: string;
  sourceFields: string[];
  mergeStrategy?: 'concat' | 'first' | 'all';
  description?: string;
}

export interface MappingContext {
  description?: string;
  fieldRelations?: FieldRelation[];
  synonyms?: Record<string, string[]>;
  specialRules?: Array<{
    condition: string;
    action: string;
  }>;
}

interface ContextChatProps {
  onContextUpdate: (context: MappingContext) => void;
  currentContext?: MappingContext;
}

export default function ContextChat({ onContextUpdate, currentContext }: ContextChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState(currentContext?.description || '');
  const [fieldRelations, setFieldRelations] = useState<FieldRelation[]>(
    currentContext?.fieldRelations || []
  );
  const [synonyms, setSynonyms] = useState<Record<string, string[]>>(
    currentContext?.synonyms || {}
  );
  const [newSynonymKey, setNewSynonymKey] = useState('');
  const [newSynonymValues, setNewSynonymValues] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    description: true,
    fieldRelations: true,
    synonyms: false,
  });

  const chatRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chatRef.current && !chatRef.current.contains(event.target as Node)) {
        // 플로팅 버튼 클릭은 제외
        const target = event.target as HTMLElement;
        if (target.closest('[data-chat-toggle]')) return;
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 컨텍스트 업데이트
  const updateContext = () => {
    const context: MappingContext = {};

    if (description.trim()) {
      context.description = description.trim();
    }

    if (fieldRelations.length > 0) {
      context.fieldRelations = fieldRelations;
    }

    if (Object.keys(synonyms).length > 0) {
      context.synonyms = synonyms;
    }

    onContextUpdate(context);
  };

  // 필드 관계 추가
  const addFieldRelation = () => {
    setFieldRelations([
      ...fieldRelations,
      {
        targetField: '',
        sourceFields: [''],
        mergeStrategy: 'all',
        description: '',
      },
    ]);
  };

  // 필드 관계 삭제
  const removeFieldRelation = (index: number) => {
    setFieldRelations(fieldRelations.filter((_, i) => i !== index));
  };

  // 필드 관계 업데이트
  const updateFieldRelation = (index: number, field: keyof FieldRelation, value: string | string[]) => {
    const updated = [...fieldRelations];
    if (field === 'sourceFields' && typeof value === 'string') {
      updated[index][field] = value.split(',').map(s => s.trim()).filter(Boolean);
    } else if (field === 'targetField' || field === 'description') {
      updated[index][field] = value as string;
    } else if (field === 'mergeStrategy') {
      updated[index][field] = value as 'concat' | 'first' | 'all';
    }
    setFieldRelations(updated);
  };

  // 동의어 추가
  const addSynonym = () => {
    if (newSynonymKey.trim() && newSynonymValues.trim()) {
      setSynonyms({
        ...synonyms,
        [newSynonymKey.trim()]: newSynonymValues.split(',').map(s => s.trim()).filter(Boolean),
      });
      setNewSynonymKey('');
      setNewSynonymValues('');
    }
  };

  // 동의어 삭제
  const removeSynonym = (key: string) => {
    const updated = { ...synonyms };
    delete updated[key];
    setSynonyms(updated);
  };

  // 섹션 토글
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        data-chat-toggle
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? 'bg-gray-600 hover:bg-gray-700'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isOpen ? (
          <X className="w-6 h-6 text-white" />
        ) : (
          <MessageCircle className="w-6 h-6 text-white" />
        )}
      </button>

      {/* 채팅창 */}
      {isOpen && (
        <div
          ref={chatRef}
          className="fixed bottom-24 right-6 z-50 w-96 max-h-[600px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
        >
          {/* 헤더 */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">매핑 컨텍스트 설정</h3>
              <p className="text-xs text-blue-100">AI 매핑에 참고할 정보를 입력하세요</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-blue-500 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 컨텐츠 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 설명 섹션 */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection('description')}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm font-medium"
              >
                <span>일반 설명</span>
                {expandedSections.description ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {expandedSections.description && (
                <div className="p-3">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="예: 개인이력카드 양식입니다. 핵심 세미나는 전문가 강연과 해외 경력자 멘토링을 포함합니다."
                    className="w-full h-20 px-3 py-2 text-sm border rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>

            {/* 필드 관계 섹션 */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection('fieldRelations')}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm font-medium"
              >
                <span>필드 관계 ({fieldRelations.length})</span>
                {expandedSections.fieldRelations ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {expandedSections.fieldRelations && (
                <div className="p-3 space-y-3">
                  <p className="text-xs text-gray-500">
                    템플릿 필드와 Excel 컬럼의 관계를 정의합니다
                  </p>

                  {fieldRelations.map((relation, index) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-600">관계 #{index + 1}</span>
                        <button
                          onClick={() => removeFieldRelation(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={relation.targetField}
                        onChange={(e) => updateFieldRelation(index, 'targetField', e.target.value)}
                        placeholder="템플릿 필드 (예: 핵심 세미나)"
                        className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                      />

                      <input
                        type="text"
                        value={relation.sourceFields.join(', ')}
                        onChange={(e) => updateFieldRelation(index, 'sourceFields', e.target.value)}
                        placeholder="Excel 컬럼들 (쉼표로 구분)"
                        className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                      />

                      <select
                        value={relation.mergeStrategy || 'all'}
                        onChange={(e) => updateFieldRelation(index, 'mergeStrategy', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="all">모두 매핑</option>
                        <option value="concat">연결</option>
                        <option value="first">첫번째만</option>
                      </select>

                      <input
                        type="text"
                        value={relation.description || ''}
                        onChange={(e) => updateFieldRelation(index, 'description', e.target.value)}
                        placeholder="설명 (선택사항)"
                        className="w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  ))}

                  <button
                    onClick={addFieldRelation}
                    className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg border border-dashed border-blue-300"
                  >
                    <Plus className="w-4 h-4" />
                    필드 관계 추가
                  </button>
                </div>
              )}
            </div>

            {/* 동의어 섹션 */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleSection('synonyms')}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-sm font-medium"
              >
                <span>동의어 ({Object.keys(synonyms).length})</span>
                {expandedSections.synonyms ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              {expandedSections.synonyms && (
                <div className="p-3 space-y-3">
                  <p className="text-xs text-gray-500">
                    같은 의미의 다른 표현을 정의합니다
                  </p>

                  {Object.entries(synonyms).map(([key, values]) => (
                    <div key={key} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1.5">
                      <span className="text-sm font-medium">{key}</span>
                      <span className="text-gray-400">=</span>
                      <span className="text-sm text-gray-600 flex-1 truncate">
                        {values.join(', ')}
                      </span>
                      <button
                        onClick={() => removeSynonym(key)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newSynonymKey}
                      onChange={(e) => setNewSynonymKey(e.target.value)}
                      placeholder="기준 용어"
                      className="flex-1 px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="text"
                      value={newSynonymValues}
                      onChange={(e) => setNewSynonymValues(e.target.value)}
                      placeholder="동의어 (쉼표 구분)"
                      className="flex-1 px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={addSynonym}
                      className="px-2 py-1.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="border-t p-3 bg-gray-50">
            <button
              onClick={updateContext}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <Send className="w-4 h-4" />
              컨텍스트 적용
            </button>
          </div>
        </div>
      )}
    </>
  );
}
