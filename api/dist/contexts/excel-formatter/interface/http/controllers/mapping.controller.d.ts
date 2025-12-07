import { MappingService } from '../../../application/services';
import { GenerateMappingRequestDto, GenerateMappingResponseDto } from '../dto';
export declare class MappingController {
    private readonly mappingService;
    constructor(mappingService: MappingService);
    generateMapping(dto: GenerateMappingRequestDto): Promise<GenerateMappingResponseDto>;
}
