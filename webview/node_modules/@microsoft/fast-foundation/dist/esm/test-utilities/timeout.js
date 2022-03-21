import { __awaiter } from "tslib";
/**
 * Timeout for use in async tets.
 */
export function timeout(timeout = 0) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            window.setTimeout(() => {
                resolve(void 0);
            }, timeout);
        });
    });
}
