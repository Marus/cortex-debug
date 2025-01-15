import { SymbolFile } from '@common/types';

// Helper function to create a symbolFile object properly with required elements
export function defSymbolFile(file: string): SymbolFile {
    const ret: SymbolFile = {
        file: file,
        sections: [],
        sectionMap: {}
    };
    return ret;
}
