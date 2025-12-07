"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiAiMappingAdapter = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const value_objects_1 = require("../../domain/value-objects");
let GeminiAiMappingAdapter = class GeminiAiMappingAdapter {
    configService;
    apiKey;
    apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
    constructor(configService) {
        this.configService = configService;
        this.apiKey = this.configService.get('GEMINI_API_KEY');
        if (!this.apiKey) {
            console.warn('GEMINI_API_KEY is not set');
        }
    }
    async generateMappings(templateColumns, dataColumns, command) {
        if (!this.apiKey) {
            throw new common_1.HttpException('GEMINI_API_KEY is not configured', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
        const prompt = this.buildPrompt(templateColumns, dataColumns, command);
        try {
            const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text: prompt }],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.2,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 2048,
                    },
                }),
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new common_1.HttpException(`Gemini API error: ${response.status} - ${errorText}`, common_1.HttpStatus.BAD_GATEWAY);
            }
            const data = await response.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textContent) {
                throw new common_1.HttpException('No response from Gemini', common_1.HttpStatus.BAD_GATEWAY);
            }
            return this.parseResponse(textContent);
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException(`Failed to call Gemini API: ${error.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    buildPrompt(templateColumns, dataColumns, command) {
        return `당신은 엑셀 데이터 매핑 전문가입니다.
템플릿 컬럼과 데이터 컬럼을 매핑해주세요.

템플릿 컬럼 (보고서 양식):
${templateColumns.map((c, i) => `${i + 1}. ${c}`).join('\n')}

데이터 컬럼 (원본 데이터):
${dataColumns.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${command ? `사용자 요청: ${command}\n` : ''}

각 템플릿 컬럼에 대해 가장 적합한 데이터 컬럼을 매핑해주세요.
매핑이 불가능한 경우 null로 표시하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "mappings": [
    {
      "templateColumn": "템플릿 컬럼명",
      "dataColumn": "매핑된 데이터 컬럼명 또는 null",
      "confidence": 0.0-1.0 사이의 신뢰도,
      "reason": "매핑 이유 (한국어로 간단히)"
    }
  ]
}`;
    }
    parseResponse(textContent) {
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new common_1.HttpException('Could not parse JSON from Gemini response', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            const mappings = parsed.mappings || [];
            return mappings.map((m) => value_objects_1.ColumnMappingVO.create({
                templateColumn: m.templateColumn,
                dataColumn: m.dataColumn,
                confidence: m.confidence,
                reason: m.reason,
            }));
        }
        catch {
            throw new common_1.HttpException('Invalid JSON in Gemini response', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.GeminiAiMappingAdapter = GeminiAiMappingAdapter;
exports.GeminiAiMappingAdapter = GeminiAiMappingAdapter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GeminiAiMappingAdapter);
//# sourceMappingURL=gemini-ai-mapping.adapter.js.map