"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExcelFormatterModule = void 0;
const common_1 = require("@nestjs/common");
const controllers_1 = require("./interface/http/controllers");
const services_1 = require("./application/services");
const adapters_1 = require("./infrastructure/adapters");
const ports_1 = require("./application/ports");
let ExcelFormatterModule = class ExcelFormatterModule {
};
exports.ExcelFormatterModule = ExcelFormatterModule;
exports.ExcelFormatterModule = ExcelFormatterModule = __decorate([
    (0, common_1.Module)({
        controllers: [controllers_1.MappingController],
        providers: [
            services_1.MappingService,
            {
                provide: ports_1.AI_MAPPING_PORT,
                useClass: adapters_1.GeminiAiMappingAdapter,
            },
        ],
        exports: [services_1.MappingService],
    })
], ExcelFormatterModule);
//# sourceMappingURL=excel-formatter.module.js.map