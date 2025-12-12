import { Injectable } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export interface HwpxCellInfo {
  rowIndex: number;
  colIndex: number;
  text: string;
  isHeader: boolean;
  colSpan: number;
  rowSpan: number;
}

export interface HwpxTableInfo {
  rowCount: number;
  colCount: number;
  cells: HwpxCellInfo[];
}

export interface HwpxTemplateInfo {
  fileName: string;
  tables: HwpxTableInfo[];
  sections: string[];
}

export interface CellMapping {
  excelColumn: string;
  hwpxRow: number;
  hwpxCol: number;
}

@Injectable()
export class HwpxParserAdapter {
  private readonly xmlParser: XMLParser;
  private readonly xmlBuilder: XMLBuilder;

  /**
   * XML 특수 문자 이스케이프
   * &, <, >, ", ' 를 XML 엔티티로 변환
   */
  private escapeXml(text: string): string {
    if (!text) return text;
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  constructor() {
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      trimValues: false,
    });

    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      format: false,
    });
  }

  /**
   * HWPX 템플릿 분석 - 표 구조 추출
   */
  async analyzeTemplate(buffer: Buffer, fileName: string): Promise<HwpxTemplateInfo> {
    const zip = new AdmZip(buffer);
    const sectionXml = zip.getEntry('Contents/section0.xml');

    if (!sectionXml) {
      throw new Error('HWPX 파일에서 section0.xml을 찾을 수 없습니다.');
    }

    const xmlContent = sectionXml.getData().toString('utf-8');
    const tables = this.extractTables(xmlContent);
    const sections = this.extractSectionHeaders(xmlContent);

    return {
      fileName,
      tables,
      sections,
    };
  }

  /**
   * XML에서 표(tbl) 구조 추출
   */
  private extractTables(xmlContent: string): HwpxTableInfo[] {
    const tables: HwpxTableInfo[] = [];

    // hp:tbl 태그 찾기 (정규식으로 처리)
    const tblMatches = xmlContent.match(/<hp:tbl[^>]*>[\s\S]*?<\/hp:tbl>/g);

    if (!tblMatches) {
      return tables;
    }

    for (const tblXml of tblMatches) {
      const tableInfo = this.parseTable(tblXml);
      if (tableInfo) {
        tables.push(tableInfo);
      }
    }

    return tables;
  }

  /**
   * 단일 표 파싱
   */
  private parseTable(tblXml: string): HwpxTableInfo | null {
    // rowCnt, colCnt 속성 추출
    const rowCntMatch = tblXml.match(/rowCnt="(\d+)"/);
    const colCntMatch = tblXml.match(/colCnt="(\d+)"/);

    const rowCount = rowCntMatch ? parseInt(rowCntMatch[1], 10) : 0;
    const colCount = colCntMatch ? parseInt(colCntMatch[1], 10) : 0;

    const cells: HwpxCellInfo[] = [];

    // hp:tr (행) 추출
    const trMatches = tblXml.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g);

    if (!trMatches) {
      return { rowCount, colCount, cells };
    }

    console.log('[HwpxParser] Parsing table: rowCount=', rowCount, 'colCount=', colCount);

    trMatches.forEach((trXml, rowIndex) => {
      // hp:tc (셀) 추출
      const tcMatches = trXml.match(/<hp:tc[^>]*>[\s\S]*?<\/hp:tc>/g);

      if (!tcMatches) return;

      let colOffset = 0;
      tcMatches.forEach((tcXml) => {
        // cellAddr 요소에서 colAddr, rowAddr 추출 (hp:cellAddr 태그 안에 있음)
        const cellAddrMatch = tcXml.match(/<hp:cellAddr\s+colAddr="(\d+)"\s+rowAddr="(\d+)"\/>/);
        const colAddrMatch = cellAddrMatch ? cellAddrMatch : tcXml.match(/colAddr="(\d+)"/);
        const rowAddrMatch = cellAddrMatch ? { 1: cellAddrMatch[2] } : tcXml.match(/rowAddr="(\d+)"/);

        // cellSpan 요소에서 colSpan, rowSpan 추출
        const cellSpanMatch = tcXml.match(/<hp:cellSpan\s+colSpan="(\d+)"\s+rowSpan="(\d+)"\/>/);
        const colSpanMatch = cellSpanMatch ? cellSpanMatch : tcXml.match(/colSpan="(\d+)"/);
        const rowSpanMatch = cellSpanMatch ? { 1: cellSpanMatch[2] } : tcXml.match(/rowSpan="(\d+)"/);

        const colIndex = colAddrMatch ? parseInt(colAddrMatch[1], 10) : colOffset;
        const actualRowIndex = rowAddrMatch ? parseInt(rowAddrMatch[1] as string, 10) : rowIndex;
        const colSpan = colSpanMatch ? parseInt(colSpanMatch[1], 10) : 1;
        const rowSpan = rowSpanMatch ? parseInt(rowSpanMatch[1] as string, 10) : 1;

        // hp:t 태그에서 텍스트 추출
        const textMatches = tcXml.match(/<hp:t>([^<]*)<\/hp:t>/g);
        let text = '';
        if (textMatches) {
          text = textMatches
            .map((t) => t.replace(/<hp:t>|<\/hp:t>/g, ''))
            .join('')
            .trim();
        }

        // 헤더/라벨 셀 판별 - 개선된 로직
        // 1. borderFillIDRef 기반 판별
        const borderFillMatch = tcXml.match(/borderFillIDRef="(\d+)"/);
        const borderFillId = borderFillMatch ? parseInt(borderFillMatch[1], 10) : 0;

        // 2. 알려진 라벨 패턴 목록 (필드명)
        const knownLabelPatterns = [
          '성명', '성 명', '성  명', '생년월일', '성별', '성 별', '성  별', '연락처', '이메일', '거주지',
          '참여분야', '수행기관', '사업명', '참여기간', '국가', '직무',
          '희망직종', '희망직무', '구 분', '구분',
          '취업여부', '취업처', '취 업 처', '담당직무',
          '핵심 세미나', '전문가 컨설팅', '실전 모의면접',
          '1회', '2회', '3회', '4회', '5회', '6회', '7회',
          '1분기', '2분기', '3분기', '4분기',
          '해외취업', '사전참여여부',
        ];

        const trimmedText = text.trim();
        const normalizedText = trimmedText.replace(/\s+/g, '');

        // 라벨 텍스트 패턴 매칭
        const isLabelText = Boolean(trimmedText) && knownLabelPatterns.some(pattern =>
          trimmedText === pattern || normalizedText === pattern.replace(/\s+/g, '')
        );

        // 3. 섹션 제목 패턴 (예: "1. 신상정보", "2. 해외취업")
        const isSectionTitle = /^\d+\.\s*/.test(trimmedText) || trimmedText === '개인이력카드';

        // 4. 데이터 값 패턴 감지 (이메일, 전화번호, 날짜, 이름 등)
        const isEmailPattern = /@/.test(trimmedText);
        const isPhonePattern = /^\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}$/.test(trimmedText.replace(/\s/g, ''));
        const isDatePattern = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(trimmedText);
        const isNamePattern = /^[가-힣]{2,4}$/.test(trimmedText) && !isLabelText; // 한글 이름 2-4자 (라벨 제외)
        const isDataValue = isEmailPattern || isPhonePattern || isDatePattern || isNamePattern;

        // 5. 빈 셀 또는 "-" 만 있는 셀은 데이터 셀로 처리
        const isEmpty = !trimmedText || trimmedText === '-';

        // 최종 isHeader 판별 로직:
        // - 섹션 제목은 항상 헤더
        // - 데이터 값 패턴이면 데이터 셀 (isHeader=false)
        // - 빈 셀은 데이터 셀 (isHeader=false)
        // - 라벨 텍스트 패턴이면 헤더 (isHeader=true)
        // - borderFillId=9이면 헤더, borderFillId=10이면 데이터
        // - 그 외에는 borderFillId 기반 또는 기본값 false (데이터로 간주)
        let isHeader: boolean;

        if (isSectionTitle) {
          isHeader = true;
        } else if (isDataValue) {
          isHeader = false;
        } else if (isEmpty) {
          isHeader = false;  // 빈 셀은 데이터 영역
        } else if (isLabelText) {
          isHeader = true;
        } else if (borderFillId === 9 || borderFillId === 8 || borderFillId === 11) {
          isHeader = true;
        } else if (borderFillId === 10) {
          isHeader = false;
        } else {
          // borderFillId가 없거나 알 수 없는 값인 경우
          // 짧은 텍스트(필드명처럼 보임)면 헤더, 그 외엔 데이터
          isHeader = trimmedText.length > 0 && trimmedText.length <= 6 && !isDataValue;
        }

        // 디버깅: 성명, 생년월일 관련 셀 출력
        if (text && (text.includes('성') || text.includes('생년') || text.includes('백') || text.includes('1994'))) {
          console.log(`[HwpxParser] Cell [${actualRowIndex},${colIndex}]: text="${text}", borderFill=${borderFillId}, isHeader=${isHeader}, colSpan=${colSpan}`);
        }

        cells.push({
          rowIndex: actualRowIndex,
          colIndex,
          text,
          isHeader,
          colSpan,
          rowSpan,
        });

        colOffset = colIndex + colSpan;
      });
    });

    // 행 3, 4 주변의 모든 셀 출력 (성명, 생년월일이 있는 행)
    const relevantCells = cells.filter(c => c.rowIndex >= 3 && c.rowIndex <= 5);
    console.log('[HwpxParser] Cells in rows 3-5:');
    relevantCells.forEach(c => {
      console.log(`  [${c.rowIndex},${c.colIndex}] text="${c.text}" isHeader=${c.isHeader} colSpan=${c.colSpan}`);
    });

    return { rowCount, colCount, cells };
  }

  /**
   * 섹션 헤더 추출 (1. 신상정보, 2. 해외취업 등)
   */
  private extractSectionHeaders(xmlContent: string): string[] {
    const headers: string[] = [];
    const regex = /<hp:t>(\d+\.\s*[^<]+)<\/hp:t>/g;
    let match;

    while ((match = regex.exec(xmlContent)) !== null) {
      const header = match[1].trim();
      if (!headers.includes(header)) {
        headers.push(header);
      }
    }

    return headers;
  }

  /**
   * HWPX 템플릿에 데이터 채워서 새 HWPX 생성
   * 중요: 원본 버퍼를 복사하여 사용해야 함 (AdmZip이 버퍼를 직접 수정할 수 있음)
   */
  async fillTemplate(
    templateBuffer: Buffer,
    data: Record<string, string>,
    mappings: CellMapping[],
  ): Promise<Buffer> {
    // 원본 버퍼를 복사하여 사용 - AdmZip이 원본을 수정하는 것을 방지
    const bufferCopy = Buffer.from(templateBuffer);
    const zip = new AdmZip(bufferCopy);
    const sectionEntry = zip.getEntry('Contents/section0.xml');

    if (!sectionEntry) {
      throw new Error('HWPX 파일에서 section0.xml을 찾을 수 없습니다.');
    }

    let xmlContent = sectionEntry.getData().toString('utf-8');

    console.log(`[fillTemplate] Processing ${mappings.length} mappings for data row`);

    // 1. 먼저 모든 매핑 대상 셀을 빈 값으로 초기화 (템플릿 기존값 제거)
    const allCellPositions = new Set<string>();
    for (const mapping of mappings) {
      allCellPositions.add(`${mapping.hwpxRow}-${mapping.hwpxCol}`);
    }
    for (const pos of allCellPositions) {
      const [row, col] = pos.split('-').map(Number);
      xmlContent = this.replaceCellText(xmlContent, row, col, '');
    }

    // 2. 실제 데이터가 있는 셀만 값 입력
    for (const mapping of mappings) {
      const value = data[mapping.excelColumn] || '';
      if (value) {  // 빈 값이 아닐 때만 교체 (이미 초기화됨)
        if (mapping.hwpxRow <= 10) {
          console.log(`[fillTemplate] Mapping "${mapping.excelColumn}" → [${mapping.hwpxRow},${mapping.hwpxCol}] = "${value.substring(0, 20)}${value.length > 20 ? '...' : ''}"`);
        }
        xmlContent = this.replaceCellText(
          xmlContent,
          mapping.hwpxRow,
          mapping.hwpxCol,
          value,
        );
      }
    }

    // 수정된 XML을 ZIP에 업데이트
    zip.updateFile('Contents/section0.xml', Buffer.from(xmlContent, 'utf-8'));

    return zip.toBuffer();
  }

  /**
   * 특정 셀의 텍스트 교체
   * 개선: 속성 순서에 무관하게 cellAddr 추출
   */
  private replaceCellText(
    xmlContent: string,
    targetRow: number,
    targetCol: number,
    newText: string,
  ): string {
    let result = xmlContent;
    let replacedCount = 0;

    // hp:tc 태그들을 직접 순회하며 교체
    result = result.replace(
      /<hp:tc([^>]*)>([\s\S]*?)<\/hp:tc>/g,
      (tcMatch: string, tcAttrs: string, tcContent: string) => {
        // cellAddr에서 colAddr, rowAddr 추출 (속성 순서 무관)
        const colAddrMatch = tcContent.match(/colAddr="(\d+)"/);
        const rowAddrMatch = tcContent.match(/rowAddr="(\d+)"/);

        if (!colAddrMatch || !rowAddrMatch) {
          return tcMatch;  // 주소 정보 없으면 그대로 반환
        }

        const colAddr = parseInt(colAddrMatch[1], 10);
        const rowAddr = parseInt(rowAddrMatch[1], 10);

        // 대상 셀인지 확인
        if (rowAddr === targetRow && colAddr === targetCol) {
          replacedCount++;

          // XML 특수 문자 이스케이프 적용
          const escapedText = this.escapeXml(newText);

          // hp:t 태그의 내용을 교체 - 첫 번째 hp:t만 교체
          let replaced = false;
          const newContent = tcMatch.replace(
            /(<hp:t>)[^<]*(<\/hp:t>)/g,
            (tMatch: string, openTag: string, closeTag: string) => {
              if (!replaced) {
                replaced = true;
                return `${openTag}${escapedText}${closeTag}`;
              }
              return tMatch;
            },
          );

          // 디버그 로그
          if (targetRow <= 10) {
            console.log(`[replaceCellText] ✓ Replaced [${targetRow},${targetCol}] with "${newText.substring(0, 30)}${newText.length > 30 ? '...' : ''}"`);
          }

          return newContent;
        }

        return tcMatch;
      },
    );

    // 디버그 로그 (첫 10개 매핑만)
    if (replacedCount === 0 && (targetRow <= 10 || targetCol <= 5)) {
      console.log(`[replaceCellText] WARNING: No cell found at [${targetRow},${targetCol}] for value "${newText.substring(0, 20)}..."`);
    }

    return result;
  }

  /**
   * 다수의 데이터로 여러 HWPX 파일 일괄 생성 → ZIP으로 묶기
   */
  async generateBulk(
    templateBuffer: Buffer,
    dataRows: Array<Record<string, string>>,
    mappings: CellMapping[],
    fileNameColumn?: string,
  ): Promise<Buffer> {
    const outputZip = new AdmZip();

    console.log(`[generateBulk] Total rows to process: ${dataRows.length}`);
    console.log(`[generateBulk] Mappings count: ${mappings.length}`);

    // 처음 3개 행의 "성명" 값 확인
    for (let j = 0; j < Math.min(3, dataRows.length); j++) {
      const sampleRow = dataRows[j];
      console.log(`[generateBulk] Row ${j} - 성명: "${sampleRow['성명']}", 생년월일: "${sampleRow['생년월일']}"`);
    }

    // 원본 템플릿 버퍼를 한 번만 읽어서 재사용
    // 중요: 각 행마다 새로운 버퍼 복사본을 만들어야 함
    const templateBytes = new Uint8Array(templateBuffer);

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      // 처음 5개와 마지막 1개 행에 대해 디버깅
      if (i < 5 || i === dataRows.length - 1) {
        console.log(`[generateBulk] Processing row ${i}: 성명="${row['성명']}", 생년월일="${row['생년월일']}"`);
      }

      // 각 행마다 새로운 버퍼 복사본 생성 (매우 중요!)
      const rowTemplateBuffer = Buffer.from(templateBytes);
      const hwpxBuffer = await this.fillTemplate(rowTemplateBuffer, row, mappings);

      // 파일명 결정 (이름 컬럼 사용 또는 성명 컬럼 또는 순번)
      let fileName = `output_${i + 1}.hwpx`;
      // 1. fileNameColumn이 지정된 경우
      if (fileNameColumn && row[fileNameColumn]) {
        const safeName = row[fileNameColumn].replace(/[/\\?%*:|"<>]/g, '_');
        fileName = `${safeName}.hwpx`;
      }
      // 2. 기본적으로 '성명' 컬럼 사용
      else if (row['성명']) {
        const safeName = row['성명'].replace(/[/\\?%*:|"<>]/g, '_');
        fileName = `${safeName}.hwpx`;
      }

      outputZip.addFile(fileName, hwpxBuffer);
    }

    return outputZip.toBuffer();
  }

  /**
   * HWPX 파일 유효성 검사
   */
  isValidHwpx(buffer: Buffer): boolean {
    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries().map((e) => e.entryName);

      // 필수 파일 존재 여부 확인
      return (
        entries.includes('Contents/section0.xml') &&
        entries.includes('META-INF/manifest.xml')
      );
    } catch {
      return false;
    }
  }
}
