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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MappingController = void 0;
const common_1 = require("@nestjs/common");
const services_1 = require("../../../application/services");
const dto_1 = require("../dto");
let MappingController = class MappingController {
    mappingService;
    constructor(mappingService) {
        this.mappingService = mappingService;
    }
    async generateMapping(dto) {
        const mappings = await this.mappingService.generateMapping(dto.templateColumns, dto.dataColumns, dto.command);
        return {
            mappings: mappings.map((m) => m.toJSON()),
        };
    }
};
exports.MappingController = MappingController;
__decorate([
    (0, common_1.Post)('generate'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.GenerateMappingRequestDto]),
    __metadata("design:returntype", Promise)
], MappingController.prototype, "generateMapping", null);
exports.MappingController = MappingController = __decorate([
    (0, common_1.Controller)('excel-formatter/mapping'),
    __metadata("design:paramtypes", [services_1.MappingService])
], MappingController);
//# sourceMappingURL=mapping.controller.js.map