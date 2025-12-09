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

        // 헤더/라벨 셀 판별
        // 1. borderFillIDRef 기반 판별
        const borderFillMatch = tcXml.match(/borderFillIDRef="(\d+)"/);
        const borderFillId = borderFillMatch ? parseInt(borderFillMatch[1], 10) : 0;

        // borderFillIDRef 값:
        // 9 = 라벨 셀 (회색 배경)
        // 10 = 데이터 셀 (흰색 배경)
        // 8, 11 = 섹션 헤더
        // 6, 7 = 제목/빈 셀
        const isBorderHeader = borderFillId === 9 || borderFillId === 8 || borderFillId === 11;
        const isBorderData = borderFillId === 10; // 명시적으로 데이터 셀

        // 2. 텍스트 내용 기반 라벨 판별 (필드명 패턴)
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
        const isLabelText = Boolean(text) && knownLabelPatterns.some(pattern =>
          text.trim() === pattern || text.trim().replace(/\s+/g, '') === pattern.replace(/\s+/g, '')
        );

        // borderFillIDRef=10이면 무조건 데이터 셀, 그렇지 않으면 라벨 판별
        const isHeader: boolean = isBorderData ? false : (isBorderHeader || isLabelText);

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
   */
  async fillTemplate(
    templateBuffer: Buffer,
    data: Record<string, string>,
    mappings: CellMapping[],
  ): Promise<Buffer> {
    const zip = new AdmZip(templateBuffer);
    const sectionEntry = zip.getEntry('Contents/section0.xml');

    if (!sectionEntry) {
      throw new Error('HWPX 파일에서 section0.xml을 찾을 수 없습니다.');
    }

    let xmlContent = sectionEntry.getData().toString('utf-8');

    // 매핑에 따라 셀 값 교체
    for (const mapping of mappings) {
      const value = data[mapping.excelColumn] || '';
      xmlContent = this.replaceCellText(
        xmlContent,
        mapping.hwpxRow,
        mapping.hwpxCol,
        value,
      );
    }

    // 수정된 XML을 ZIP에 업데이트
    zip.updateFile('Contents/section0.xml', Buffer.from(xmlContent, 'utf-8'));

    return zip.toBuffer();
  }

  /**
   * 특정 셀의 텍스트 교체
   */
  private replaceCellText(
    xmlContent: string,
    targetRow: number,
    targetCol: number,
    newText: string,
  ): string {
    // 단계적으로 파싱하여 정확한 위치 찾기
    let trIndex = 0;
    let result = xmlContent;

    // hp:tr 태그들을 순회
    result = result.replace(
      /<hp:tr>([\s\S]*?)<\/hp:tr>/g,
      (trMatch, trContent) => {
        const currentRow = trIndex++;

        // 현재 행이 대상 행이 아니면 그대로 반환
        // rowAddr를 사용하여 실제 행 인덱스 확인
        let processedContent = trContent;

        processedContent = trContent.replace(
          /<hp:tc([^>]*)>([\s\S]*?)<\/hp:tc>/g,
          (tcMatch: string, tcAttrs: string, tcContent: string) => {
            // rowAddr와 colAddr 추출
            const rowAddrMatch = tcAttrs.match(/rowAddr="(\d+)"/);
            const colAddrMatch = tcContent.match(/colAddr="(\d+)"/);

            if (!colAddrMatch) return tcMatch;

            const rowAddr = rowAddrMatch ? parseInt(rowAddrMatch[1], 10) : currentRow;
            const colAddr = parseInt(colAddrMatch[1], 10);

            // 대상 셀인지 확인
            if (rowAddr === targetRow && colAddr === targetCol) {
              // hp:t 태그의 내용을 교체
              return tcMatch.replace(
                /(<hp:t>)[^<]*(<\/hp:t>)/g,
                (tMatch: string, openTag: string, closeTag: string, offset: number, fullString: string) => {
                  // 첫 번째 hp:t 태그만 교체
                  if (fullString.indexOf(tMatch) === offset) {
                    return `${openTag}${newText}${closeTag}`;
                  }
                  return tMatch;
                },
              );
            }

            return tcMatch;
          },
        );

        return `<hp:tr>${processedContent}</hp:tr>`;
      },
    );

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

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const hwpxBuffer = await this.fillTemplate(templateBuffer, row, mappings);

      // 파일명 결정 (이름 컬럼 사용 또는 순번)
      let fileName = `output_${i + 1}.hwpx`;
      if (fileNameColumn && row[fileNameColumn]) {
        const safeName = row[fileNameColumn].replace(/[/\\?%*:|"<>]/g, '_');
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
