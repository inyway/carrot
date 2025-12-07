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
exports.GenerateMappingResponseDto = exports.ColumnMappingDto = exports.GenerateMappingRequestDto = void 0;
const class_validator_1 = require("class-validator");
class GenerateMappingRequestDto {
    templateColumns;
    dataColumns;
    command;
}
exports.GenerateMappingRequestDto = GenerateMappingRequestDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayNotEmpty)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], GenerateMappingRequestDto.prototype, "templateColumns", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayNotEmpty)(),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], GenerateMappingRequestDto.prototype, "dataColumns", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], GenerateMappingRequestDto.prototype, "command", void 0);
class ColumnMappingDto {
    templateColumn;
    dataColumn;
    confidence;
    reason;
}
exports.ColumnMappingDto = ColumnMappingDto;
class GenerateMappingResponseDto {
    mappings;
}
exports.GenerateMappingResponseDto = GenerateMappingResponseDto;
//# sourceMappingURL=generate-mapping.dto.js.map