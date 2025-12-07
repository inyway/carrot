'use client';

import { useState, useCallback, useEffect, useRef, ReactNode } from 'react';

interface ResizableDividerProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  initialRightWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
}

export default function ResizableDivider({
  leftPanel,
  rightPanel,
  initialRightWidth = 420,
  minRightWidth = 320,
  maxRightWidth = 600,
}: ResizableDividerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rightWidth, setRightWidth] = useState(initialRightWidth);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const newRightWidth = containerRect.right - e.clientX;

      if (newRightWidth >= minRightWidth && newRightWidth <= maxRightWidth) {
        setRightWidth(newRightWidth);
      }
    },
    [isDragging, minRightWidth, maxRightWidth]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
      {/* 왼쪽 패널 */}
      <div className="flex-1 overflow-auto">
        {leftPanel}
      </div>

      {/* 리사이즈 핸들 */}
      <div
        onMouseDown={handleMouseDown}
        className={`
          w-2 flex-shrink-0 relative cursor-col-resize
          flex items-center justify-center
          bg-gray-200 hover:bg-teal-200 transition-colors
          ${isDragging ? 'bg-teal-300' : ''}
          group
        `}
      >
        {/* 핸들 그립 아이콘 */}
        <div className="absolute inset-y-0 flex items-center justify-center">
          <div className={`
            flex flex-col gap-1
            ${isDragging ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'}
            transition-opacity
          `}>
            <div className="w-1 h-1 rounded-full bg-gray-500" />
            <div className="w-1 h-1 rounded-full bg-gray-500" />
            <div className="w-1 h-1 rounded-full bg-gray-500" />
            <div className="w-1 h-1 rounded-full bg-gray-500" />
            <div className="w-1 h-1 rounded-full bg-gray-500" />
          </div>
        </div>
      </div>

      {/* 오른쪽 패널 */}
      <div
        style={{ width: rightWidth }}
        className="flex-shrink-0 border-l border-gray-200 overflow-hidden"
      >
        {rightPanel}
      </div>
    </div>
  );
}
