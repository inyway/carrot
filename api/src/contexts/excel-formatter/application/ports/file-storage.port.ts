/**
 * 파일 저장소 Port (의존성 역전)
 * 템플릿 원본 파일을 외부 스토리지에 저장/조회/삭제
 */
export interface FileStoragePort {
  /**
   * 파일 업로드
   * @returns 접근 가능한 URL
   */
  uploadFile(buffer: Buffer, path: string, contentType: string): Promise<string>;

  /**
   * 파일 다운로드
   */
  downloadFile(path: string): Promise<Buffer>;

  /**
   * 파일 삭제
   */
  deleteFile(path: string): Promise<void>;
}

export const FILE_STORAGE_PORT = Symbol('FILE_STORAGE_PORT');
