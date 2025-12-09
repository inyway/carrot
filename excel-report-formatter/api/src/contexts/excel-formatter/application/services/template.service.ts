import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { EXCEL_PARSER_PORT, TEMPLATE_REPOSITORY_PORT } from '../ports';
import type { ExcelParserPort, TemplateRepositoryPort, TemplateEntity } from '../ports';
import type { TemplateStructureVO, TemplateBlockVO } from '../../domain/value-objects';
import { BlockType } from '../../domain/value-objects';

export interface CreateTemplateServiceInput {
  companyId: string;
  name: string;
  description?: string;
  buffer: Buffer;
  fileName: string;
  fileUrl?: string;
}

export interface UpdateBlockDto {
  blockId: string;
  type?: BlockType;
  range?: string;
  config?: TemplateBlockVO['config'];
}

@Injectable()
export class TemplateService {
  constructor(
    @Inject(EXCEL_PARSER_PORT)
    private readonly excelParser: ExcelParserPort,
    @Inject(TEMPLATE_REPOSITORY_PORT)
    private readonly templateRepository: TemplateRepositoryPort,
  ) {}

  /**
   * 엑셀 파일을 파싱하여 템플릿 구조 추출
   */
  async parseExcelTemplate(
    buffer: Buffer,
    fileName: string,
  ): Promise<TemplateStructureVO> {
    return this.excelParser.parseTemplate(buffer, fileName);
  }

  /**
   * 템플릿 생성 (파싱 + DB 저장)
   */
  async createTemplate(input: CreateTemplateServiceInput): Promise<TemplateEntity> {
    const structure = await this.excelParser.parseTemplate(input.buffer, input.fileName);

    return this.templateRepository.create({
      companyId: input.companyId,
      name: input.name,
      description: input.description,
      fileName: input.fileName,
      fileUrl: input.fileUrl,
      structure,
    });
  }

  /**
   * 템플릿 조회
   */
  async getTemplate(id: string): Promise<TemplateEntity> {
    const template = await this.templateRepository.findById(id);
    if (!template) {
      throw new NotFoundException(`Template with id ${id} not found`);
    }
    return template;
  }

  /**
   * 회사별 템플릿 목록 조회
   */
  async getTemplatesByCompany(companyId: string): Promise<TemplateEntity[]> {
    return this.templateRepository.findByCompanyId(companyId);
  }

  /**
   * 전체 템플릿 목록 조회 (프론트엔드 호환)
   */
  async getAllTemplates(): Promise<TemplateEntity[]> {
    return this.templateRepository.findAll();
  }

  /**
   * 전체 템플릿 목록 조회 (회사 정보 포함)
   */
  async getAllTemplatesWithCompany(): Promise<TemplateEntity[]> {
    return this.templateRepository.findAllWithCompany();
  }

  /**
   * 템플릿 구조 업데이트
   */
  async updateTemplateStructure(
    id: string,
    structure: TemplateStructureVO,
  ): Promise<TemplateEntity> {
    return this.templateRepository.update(id, { structure });
  }

  /**
   * 템플릿 삭제
   */
  async deleteTemplate(id: string): Promise<void> {
    await this.templateRepository.delete(id);
  }

  /**
   * 시트 목록 조회
   */
  async getSheetNames(buffer: Buffer): Promise<string[]> {
    return this.excelParser.getSheetNames(buffer);
  }

  /**
   * 특정 시트의 데이터 추출
   */
  async extractSheetData(
    buffer: Buffer,
    sheetName: string,
  ): Promise<Array<Record<string, unknown>>> {
    return this.excelParser.extractSheetData(buffer, sheetName);
  }

  /**
   * 블록 타입 변경 (사용자가 UI에서 수정)
   */
  updateBlockType(
    structure: TemplateStructureVO,
    sheetIndex: number,
    blockId: string,
    newType: BlockType,
  ): TemplateStructureVO {
    const updatedSheets = [...structure.sheets];
    const sheet = updatedSheets[sheetIndex];

    if (!sheet) {
      throw new Error(`Sheet at index ${sheetIndex} not found`);
    }

    const updatedBlocks = sheet.blocks.map((block) => {
      if (block.blockId === blockId) {
        return { ...block, type: newType };
      }
      return block;
    });

    updatedSheets[sheetIndex] = { ...sheet, blocks: updatedBlocks };

    return { ...structure, sheets: updatedSheets };
  }

  /**
   * 블록 범위 수정
   */
  updateBlockRange(
    structure: TemplateStructureVO,
    sheetIndex: number,
    blockId: string,
    newRange: string,
  ): TemplateStructureVO {
    const updatedSheets = [...structure.sheets];
    const sheet = updatedSheets[sheetIndex];

    if (!sheet) {
      throw new Error(`Sheet at index ${sheetIndex} not found`);
    }

    const { startRow, endRow, startCol, endCol } = this.parseRange(newRange);

    const updatedBlocks = sheet.blocks.map((block) => {
      if (block.blockId === blockId) {
        return {
          ...block,
          range: newRange,
          startRow,
          endRow,
          startCol,
          endCol,
        };
      }
      return block;
    });

    updatedSheets[sheetIndex] = { ...sheet, blocks: updatedBlocks };

    return { ...structure, sheets: updatedSheets };
  }

  /**
   * 새 블록 추가
   */
  addBlock(
    structure: TemplateStructureVO,
    sheetIndex: number,
    type: BlockType,
    range: string,
    config?: TemplateBlockVO['config'],
  ): TemplateStructureVO {
    const updatedSheets = [...structure.sheets];
    const sheet = updatedSheets[sheetIndex];

    if (!sheet) {
      throw new Error(`Sheet at index ${sheetIndex} not found`);
    }

    const { startRow, endRow, startCol, endCol } = this.parseRange(range);
    const blockId = `block_${Date.now()}`;

    const newBlock: TemplateBlockVO = {
      blockId,
      type,
      range,
      startRow,
      endRow,
      startCol,
      endCol,
      cells: [],
      config,
    };

    updatedSheets[sheetIndex] = {
      ...sheet,
      blocks: [...sheet.blocks, newBlock],
    };

    return { ...structure, sheets: updatedSheets };
  }

  /**
   * 블록 삭제
   */
  removeBlock(
    structure: TemplateStructureVO,
    sheetIndex: number,
    blockId: string,
  ): TemplateStructureVO {
    const updatedSheets = [...structure.sheets];
    const sheet = updatedSheets[sheetIndex];

    if (!sheet) {
      throw new Error(`Sheet at index ${sheetIndex} not found`);
    }

    updatedSheets[sheetIndex] = {
      ...sheet,
      blocks: sheet.blocks.filter((b) => b.blockId !== blockId),
    };

    return { ...structure, sheets: updatedSheets };
  }

  /**
   * 범위 문자열 파싱 (예: "B3:D8")
   */
  private parseRange(range: string): {
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } {
    const parts = range.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid range format: ${range}`);
    }

    const [start, end] = parts;
    const startMatch = start.match(/([A-Z]+)(\d+)/);
    const endMatch = end.match(/([A-Z]+)(\d+)/);

    if (!startMatch || !endMatch) {
      throw new Error(`Invalid range format: ${range}`);
    }

    return {
      startRow: parseInt(startMatch[2]),
      endRow: parseInt(endMatch[2]),
      startCol: this.letterToColumnNumber(startMatch[1]),
      endCol: this.letterToColumnNumber(endMatch[1]),
    };
  }

  private letterToColumnNumber(letter: string): number {
    let result = 0;
    for (let i = 0; i < letter.length; i++) {
      result = result * 26 + (letter.charCodeAt(i) - 64);
    }
    return result;
  }
}
