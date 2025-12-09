'use client';

const LOADING_TEXT = 'LOADING';

export default function CubeLoader() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="loader-wrapper">
        {LOADING_TEXT.split('').map((char, index) => (
          <div key={index} className="loader-cube">
            <div className="loader-face loader-face-front">{char}</div>
            <div className="loader-face loader-face-back">{char}</div>
            <div className="loader-face loader-face-left">{char}</div>
            <div className="loader-face loader-face-right">{char}</div>
            <div className="loader-face loader-face-top"></div>
            <div className="loader-face loader-face-bottom"></div>
          </div>
        ))}
      </div>
    </div>
  );
}
